import {initTRPC, TRPCError} from '@trpc/server';
import type {Context} from './context';
import {customJwtPayload} from './routers';
import {UserRoleTypes} from '@prisma/client';
import {verifyActionToken} from '../db/actionTokens';

export const t = initTRPC.context<Context>().create({
  sse: {
    maxDurationMs: 5 * 60 * 1_000, // 5 minutes
    ping: {
      enabled: true,
      intervalMs: 3_000,
    },
    client: {
      reconnectAfterInactivityMs: 5_000,
    },
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

const isAdmin = (user: customJwtPayload) => {
  return user.roles.includes(UserRoleTypes.ADMIN);
};

const validateUser = (user: string | null | customJwtPayload): customJwtPayload => {
  if (!user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
    });
  } else if (typeof user === 'string') {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: user,
    });
  } else if (!user.exp) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Token expired',
    });
  } else if (user.exp < Date.now() / 1000) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Token expired',
    });
  } else if (!user.discordId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'User not linked to discord',
    });
  }
  return user;
};

export const authProcedure = t.procedure.use(async function isAuthed(opts) {
  const user = validateUser(opts.ctx.user);

  return opts.next({
    ctx: {
      user: user,
      isAdmin: isAdmin(user),
    },
  });
});

export const adminProcedure = t.procedure.use(async function isAuthed(opts) {
  const user = validateUser(opts.ctx.user);

  if (!isAdmin(user)) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
    });
  }

  return opts.next({
    ctx: {
      user: user,
      isAdmin: true,
    },
  });
});

export const tokenProcedure = t.procedure.use(async function isActionToken(opts) {
  const tokenHeader = opts.ctx.req?.headers.get('X-Action-Token');

  if (!tokenHeader) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Action token is required',
    });
  }

  // Pass the user context when verifying the token
  const currentUser = opts.ctx.user;
  const result = await verifyActionToken(tokenHeader, currentUser);

  if (typeof result === 'string') {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: result,
    });
  }

  // Check if we have a payload with synthetic user
  if ('payload' in result && result.syntheticUser) {
    // For tokens that use synthetic users, we need to add this info to the context
    const isAdminAction = Array.isArray(result.payload.userRole)
      ? result.payload.userRole.includes(UserRoleTypes.ADMIN)
      : result.payload.userRole === UserRoleTypes.ADMIN;

    return opts.next({
      ctx: {
        ...opts.ctx,
        actionToken: result.payload,
        syntheticUser: result.syntheticUser,
        isAdmin: isAdminAction,
      },
    });
  } else {
    // Standard token without synthetic user
    const payload = 'payload' in result ? result.payload : result;
    const isAdminAction = Array.isArray(payload.userRole)
      ? payload.userRole.includes(UserRoleTypes.ADMIN)
      : payload.userRole === UserRoleTypes.ADMIN;

    return opts.next({
      ctx: {
        ...opts.ctx,
        actionToken: payload,
        isAdmin: isAdminAction,
      },
    });
  }
});

// Add this union procedure
export const adminOrTokenProcedure = t.procedure.use(async function isAdminOrToken(opts) {
  // Try token authentication first
  const tokenHeader = opts.ctx.req?.headers.get('X-Action-Token');

  if (tokenHeader) {
    // Verify the token is valid
    const result = await verifyActionToken(tokenHeader, opts.ctx.user);

    if (typeof result === 'string') {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: result,
      });
    }

    // Check for synthetic user
    if ('payload' in result && result.syntheticUser) {
      if (
        !result.payload.userRole ||
        (Array.isArray(result.payload.userRole) &&
          !result.payload.userRole.includes(UserRoleTypes.ADMIN)) ||
        result.payload.userRole !== UserRoleTypes.ADMIN
      ) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Not an admin token',
        });
      }

      return opts.next({
        ctx: {
          ...opts.ctx,
          actionToken: result.payload,
          syntheticUser: result.syntheticUser,
          isAdmin: true,
        },
      });
    } else {
      // Standard token without synthetic user
      const payload = 'payload' in result ? result.payload : result;

      if (
        !payload.userRole ||
        (Array.isArray(payload.userRole) && !payload.userRole.includes(UserRoleTypes.ADMIN)) ||
        payload.userRole !== UserRoleTypes.ADMIN
      ) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Not an admin token',
        });
      }

      return opts.next({
        ctx: {
          ...opts.ctx,
          actionToken: payload,
          isAdmin: true,
        },
      });
    }
  }

  // Fall back to regular admin authentication
  const user = validateUser(opts.ctx.user);

  if (!isAdmin(user)) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Admin privileges required',
    });
  }

  return opts.next({
    ctx: {
      user: user,
      isAdmin: true,
    },
  });
});

import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import { customJwtPayload } from "./routers";
import { UserRoleTypes } from "@prisma/client";

// export const t = initTRPC.context<Context>().create({
const t = initTRPC.context<Context>().create({
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

const validateUser = (
  user: string | null | customJwtPayload
): customJwtPayload => {
  if (!user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
    });
  } else if (typeof user === "string") {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: user,
    });
  } else if (!user.exp) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Token expired",
    });
  } else if (user.exp < Date.now() / 1000) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Token expired",
    });
  } else if (!user.discordId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "User not linked to discord",
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
      code: "UNAUTHORIZED",
    });
  }

  return opts.next({
    ctx: {
      user: user,
      isAdmin: true,
    },
  });
});

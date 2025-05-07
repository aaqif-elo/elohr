import jwt from 'jsonwebtoken';
import {randomUUID} from 'crypto';
import {db} from '.';
import {AssociatedObjectType, UserRoleTypes} from '@prisma/client';
import {getRandomUserWithRole} from './users'; // Import the new function

export interface ActionTokenPayload {
  action: string;
  params: Record<string, string>;
  exp: number; // Expiration timestamp
  jti: string; // JWT ID - for one-time use validation
  userRole?: UserRoleTypes | UserRoleTypes[]; // Required role for this action
  requiresLogin: boolean; // Whether this action requires authentication
}

export interface TokenOptions {
  expirationHours?: number;
  userRole?: UserRoleTypes | UserRoleTypes[];
  requiresLogin?: boolean;
  associatedObject?: {
    type: AssociatedObjectType;
    id: string;
  };
}

const DEFAULT_EXPIRATION_HOURS = 24 * 7; // 1 week

export async function generateActionToken(
  action: string,
  params: Record<string, string>,
  options: TokenOptions = {}
): Promise<{token: string; tokenId: string}> {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET not set');
  }

  // Create unique ID for this token
  const tokenId = randomUUID();

  // Extract and use options with defaults
  const expirationHours = options.expirationHours ?? DEFAULT_EXPIRATION_HOURS;
  const requiresLogin = options.requiresLogin ?? false; // Default to false if not specified
  const userRole = options.userRole; // Optional role requirement
  const associatedObject = options.associatedObject;

  // Calculate expiration time
  const expirationMs = expirationHours * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + expirationMs);

  // Create JWT payload
  const payload: ActionTokenPayload = {
    action,
    params,
    exp: Math.floor(expiresAt.getTime() / 1000),
    jti: tokenId,
    requiresLogin,
    ...(userRole && {userRole}),
  };

  // Sign the token
  const token = jwt.sign(payload, process.env.JWT_SECRET);

  // Store token metadata in database
  await db.actionToken.create({
    data: {
      id: tokenId,
      token,
      action,
      expiresAt,
      used: false,
      ...(associatedObject && {
        associatedObject: {
          type: associatedObject.type,
          id: associatedObject.id,
        },
      }),
    },
  });

  return {token, tokenId};
}

// New method to update a token with message ID
export async function updateTokenMessageId(tokenId: string, messageId: string): Promise<void> {
  await db.actionToken.update({
    where: {id: tokenId},
    data: {messageId},
  });
}

// New method to delete action tokens by associated object
export async function deleteActionTokensByObject(
  objectType: AssociatedObjectType,
  objectId: string
): Promise<void> {
  await db.actionToken.deleteMany({
    where: {
      associatedObject: {
        type: objectType,
        id: objectId,
      },
    },
  });
}

export async function verifyActionToken(
  token: string,
  currentUser?: {roles?: UserRoleTypes[]; dbId?: string} | null
): Promise<
  | ActionTokenPayload
  | string
  | {payload: ActionTokenPayload; syntheticUser?: {id: string; roles: UserRoleTypes[]}}
> {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET not set');
  }

  try {
    // Verify token signature and expiration
    const payload = jwt.verify(token, process.env.JWT_SECRET) as ActionTokenPayload;

    // Check if token has been used
    const tokenRecord = await db.actionToken.findFirst({
      where: {id: payload.jti},
    });

    if (!tokenRecord || tokenRecord.used) {
      return `Token has already been used or does not exist!`;
    }

    let currentUserHasRole = payload.userRole ? false : true; // Default to true if no role is specified
    let syntheticUser: {id: string; roles: UserRoleTypes[]} | null = null;

    if (payload.userRole) {
      if (currentUser) {
        // Check if the user has the required role(s)
        const requiredRoles = Array.isArray(payload.userRole)
          ? payload.userRole
          : [payload.userRole];

        currentUserHasRole = requiredRoles.some(role => currentUser?.roles?.includes(role));
      }
    }

    if (payload.requiresLogin) {
      if (!currentUser) {
        return `Token requires login!`;
      } else if (!currentUserHasRole) {
        return `User does not have required role for this action!`;
      }
    } else if (payload.userRole) {
      if (!currentUserHasRole) {
        // Get a random user with the required role(s)
        syntheticUser = await getRandomUserWithRole(payload.userRole);

        if (syntheticUser) {
          console.log(
            `Using synthetic user (ID: ${syntheticUser.id}) with role permissions for action token`
          );
          // Create a synthetic user context with the roles we need
          currentUserHasRole = true; // User has the required role(s)
        } else {
          return `Invalid role provided for action token!`;
        }
      }
    }

    // Only mark token as used if all validation passes
    await db.actionToken.update({
      where: {id: payload.jti},
      data: {used: true, usedAt: new Date()},
    });

    // Return the payload and synthetic user if applicable
    return syntheticUser ? {payload, syntheticUser} : payload;
  } catch (error) {
    console.error('Action token verification failed:', error);
    if (error instanceof jwt.JsonWebTokenError) {
      return `Invalid token!`;
    } else if (error instanceof jwt.TokenExpiredError) {
      return `Token has expired!`;
    } else {
      return `Token verification failed!`;
    }
  }
}

export async function getMessageIdUsingObject(
  objectType: AssociatedObjectType,
  objectId: string
): Promise<string | null> {
  const token = await db.actionToken.findFirst({
    where: {
      associatedObject: {
        type: objectType,
        id: objectId,
      },
    },
    select: {
      messageId: true,
    },
  });

  return token?.messageId || null;
}

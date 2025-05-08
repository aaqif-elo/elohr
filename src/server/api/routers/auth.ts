import { wrap } from "@typeschema/valibot";
import { nullish, string } from "valibot";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { getUserByDiscordId, getUserById, ONE_MONTH_IN_MS } from "../../db";
import jwt, { JwtPayload } from "jsonwebtoken";
import { UserRoleTypes } from "@prisma/client";

export interface customJwtPayload extends JwtPayload {
  discordId: string;
  dbId: string;
  roles: UserRoleTypes[];
}

const { sign, verify } = jwt;

interface AuthAttemptPayload {
  discordUserId: string;
  dateTime: Date;
}

let msToAdd = ONE_MONTH_IN_MS;
if (process.env.JWT_EXP_IN_MS) {
  const parsed = parseInt(process.env.JWT_EXP_IN_MS);
  if (!isNaN(parsed)) {
    msToAdd = parsed;
  }
}

export const generateJWTFromUserId = async (userId: string) => {
  const user = await getUserById(userId);
  if (!user) {
    return null;
  }
  return await generateJWTFromUserDiscordId(user.discordInfo.id);
};

export const generateJWTFromUserDiscordId = async (discordId: string) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET not set");
  }
  const userWithAttendance = await getUserByDiscordId(discordId, true);
  if (!userWithAttendance) {
    return null;
  }

  const payload: customJwtPayload = {
    exp: Math.floor((Date.now() + msToAdd) / 1000),
    discordId: discordId,
    dbId: userWithAttendance.user.id,
    roles: userWithAttendance.user.roles,
  };
  const jwt = sign(payload, process.env.JWT_SECRET);
  return { userWithAttendance, jwt };
};

const getUserDiscordIdFromValidJWT = (jwt?: string | null) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET not set");
  }

  if (!jwt) {
    return null;
  }

  try {
    const decoded = verify(jwt, process.env.JWT_SECRET);
    if (!decoded) {
      return null;
    }

    const exp = (decoded as customJwtPayload).exp;

    if (!exp) {
      return null;
    }

    if (exp < Date.now() / 1000) {
      return null;
    }

    const userId: string = (decoded as customJwtPayload).discordId;

    if (!userId) {
      return null;
    }

    return userId;
  } catch (e) {
    console.error("Error verifying JWT:", e);
    return null;
  }
};

export const authRouter = createTRPCRouter({
  validateJWT: publicProcedure
    .input(wrap(nullish(string())))
    .query(async ({ input: jwt }) => {
      return getUserDiscordIdFromValidJWT(jwt) !== null;
    }),
  loginWithStoredJWT: publicProcedure
    .input(wrap(string()))
    .query(async ({ input: jwt }) => {
      try {
        const userId = getUserDiscordIdFromValidJWT(jwt);

        if (!userId) {
          return null;
        }

        const userFromDb = await getUserByDiscordId(userId, true);

        if (!userFromDb) {
          return null;
        }

        return userFromDb;
      } catch (e) {
        return null;
      }
    }),
});

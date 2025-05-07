import { wrap } from "@typeschema/valibot";
import { nullish, string } from "valibot";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { createHmac } from "crypto";
import { getUserByDiscordId, getUserById, ONE_MONTH_IN_MS } from "../../db";
import jwt, { JwtPayload } from "jsonwebtoken";
import { UserRoleTypes } from "@prisma/client";

export interface customJwtPayload extends JwtPayload {
  discordId: string;
  dbId: string;
  roles: UserRoleTypes[];
}

const { sign, verify } = jwt;

// 30 Seconds
const msToAuthAttemptExpiration = 30 * 1000;

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

const generateJWTFromUserDiscordId = async (discordId: string) => {
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

const hashToAuthAttempt: Record<string, AuthAttemptPayload> = {};

setInterval(() => {
  const now = new Date();
  Object.keys(hashToAuthAttempt).forEach((hash) => {
    const authAttempt = hashToAuthAttempt[hash];
    if (
      now.getTime() - authAttempt.dateTime.getTime() >
      msToAuthAttemptExpiration
    ) {
      delete hashToAuthAttempt[hash];
    }
  });
}, 1000);

const getUserDiscordIdFromValidJWT = (jwt?: string | null) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET not set");
  }

  if (!jwt) {
    return null;
  }

  try {
    console.log("Verifying JWT:", jwt);
    console.log("JWT_SECRET:", process.env.JWT_SECRET);
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
  generateAuthHash: publicProcedure
    .input(wrap(string()))
    .query(async ({ input: discordUserId }) => {
      if (!process.env.HASHING_KEY) {
        throw new Error("HASHING_KEY not set");
      }
      if (!process.env.FRONTEND_URL) {
        throw new Error("FRONTEND_URL not set");
      }

      console.log("input", discordUserId);

      const randomSalt =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);

      const timestamp = new Date().getTime();

      const hash = createHmac("sha256", process.env.HASHING_KEY)
        .update(discordUserId + timestamp.toString() + randomSalt.toString())
        .digest("hex");

      hashToAuthAttempt[hash] = {
        discordUserId,
        dateTime: new Date(),
      };

      const url =
        process.env.NODE_ENV === "production"
          ? process.env.FRONTEND_URL
          : "http://localhost:" + process.env.PORT;

      return `${url}/?hash=${hash}`;
    }),
  loginWithHash: publicProcedure
    .input(wrap(string()))
    .query(async ({ input: hash }) => {
      const authAttempt = hashToAuthAttempt[hash];

      if (!authAttempt) {
        throw new Error("Invalid hash");
      }

      const userWithAttendance = await getUserByDiscordId(
        authAttempt.discordUserId,
        true
      );
      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET not set");
      }

      const payload: customJwtPayload = {
        exp: Math.floor((Date.now() + msToAdd) / 1000),
        discordId: authAttempt.discordUserId,
        dbId: userWithAttendance.user.id,
        roles: userWithAttendance.user.roles,
      };
      const jwt = sign(payload, process.env.JWT_SECRET);

      return { userWithAttendance, jwt };
    }),
  validateJWT: publicProcedure
    .input(wrap(nullish(string())))
    .query(async ({ input: jwt }) => {
      return getUserDiscordIdFromValidJWT(jwt) !== null;
    }),
  loginWithStoredJWT: publicProcedure
    .input(wrap(string()))
    .query(async ({ input: jwt }) => {
      try {
        console.log("Logging in with stored JWT:", jwt);
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

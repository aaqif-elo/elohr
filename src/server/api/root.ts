import {
  adminRouter,
  attendanceRouter,
  authRouter,
  recordingsRouter,
} from "./routers";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  attendance: attendanceRouter,
  admin: adminRouter,
  recordings: recordingsRouter,
});

export type AppRouter = typeof appRouter;

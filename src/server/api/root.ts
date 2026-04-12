import {
  adminRouter,
  attendanceRouter,
  authRouter,
  holidaysRouter,
  leavesRouter,
  recordingsRouter,
} from "./routers";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  attendance: attendanceRouter,
  admin: adminRouter,
  holidays: holidaysRouter,
  leaves: leavesRouter,
  recordings: recordingsRouter,
});

export type AppRouter = typeof appRouter;

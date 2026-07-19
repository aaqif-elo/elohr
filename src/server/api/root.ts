import {
  adminRouter,
  attendanceRouter,
  authRouter,
  holidaysRouter,
  recordingsRouter,
} from "./routers";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  attendance: attendanceRouter,
  admin: adminRouter,
  holidays: holidaysRouter,
  recordings: recordingsRouter,
});

export type AppRouter = typeof appRouter;

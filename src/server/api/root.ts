import {
  actionsRouter,
  adminRouter,
  attendanceRouter,
  authRouter,
  holidaysRouter,
  leavesRouter,
} from './routers';
import {createTRPCRouter} from './trpc';

export const appRouter = createTRPCRouter({
  auth: authRouter,
  attendance: attendanceRouter,
  admin: adminRouter,
  holidays: holidaysRouter,
  leaves: leavesRouter,
  actions: actionsRouter,
});

export type AppRouter = typeof appRouter;

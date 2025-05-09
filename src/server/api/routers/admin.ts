import { adminProcedure, createTRPCRouter } from "../trpc";
import { getAllEmployeesWithAttendance, getUserById } from "../../db";
import { parseAsync, object, pipe, string, isoTimestamp } from "valibot";

export const adminRouter = createTRPCRouter({
  getForEveryoneAttendance: adminProcedure
    .input((data) =>
      parseAsync(
        object({
          date: pipe(string(), isoTimestamp()),
        }),
        data
      )
    )
    .query(async (opts) => {
      const userId = opts.ctx.user.dbId;
      if (!userId || !opts.ctx.isAdmin) return null;

      const dateString = opts.input.date;
      let dateFilter: Date | undefined = undefined;

      const validatedDate = new Date(dateString);
      if (validatedDate.toString() !== "Invalid Date") {
        dateFilter = validatedDate;
      }

      if (!dateFilter) return null;

      return getAllEmployeesWithAttendance(dateFilter);
    }),
  // Update the getUser endpoint to use the new procedure
  getUser: adminProcedure
    .input((data) =>
      parseAsync(
        object({
          userId: string(),
        }),
        data
      )
    )
    .query(async (opts) => {
      // Allow access either through normal admin login or through token
      const user = await getUserById(opts.input.userId);
      return user;
    }),
});

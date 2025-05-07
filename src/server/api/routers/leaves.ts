import {adminOrTokenProcedure, authProcedure, createTRPCRouter} from '../trpc';
import {createLeaveRequest, cancelLeaveRequest, reviewLeaveRequest, getLeaveById} from '../../db';
import {object, string, isoTimestamp, pipe, parseAsync, array, optional, boolean} from 'valibot';
import {TRPCError} from '@trpc/server';

export const leavesRouter = createTRPCRouter({
  // Request a new leave
  requestLeave: authProcedure
    .input(data =>
      parseAsync(
        object({
          dates: array(pipe(string(), isoTimestamp())),
          reason: optional(string()),
        }),
        data
      )
    )
    .mutation(async opts => {
      const userId = opts.ctx.user.dbId;
      if (!userId) throw new Error('User not authenticated');

      // Convert string dates to Date objects
      const datesToSave = opts.input.dates.map(date => new Date(date));

      // Create the leave request
      return createLeaveRequest(userId, datesToSave, opts.input.reason);
    }),

  // Cancel an existing leave request
  cancelLeave: authProcedure
    .input(data =>
      parseAsync(
        object({
          date: pipe(string(), isoTimestamp()),
        }),
        data
      )
    )
    .mutation(async opts => {
      const userId = opts.ctx.user.dbId;
      if (!userId) throw new Error('User not authenticated');

      const date = new Date(opts.input.date);
      return cancelLeaveRequest(userId, date);
    }),

  // Get leave by ID
  getById: adminOrTokenProcedure
    .input(data =>
      parseAsync(
        object({
          leaveId: string(),
        }),
        data
      )
    )
    .query(async opts => {
      // Admin permission check should be done in the UI
      const leave = await getLeaveById(opts.input.leaveId);
      if (!leave) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Leave request not found',
        });
      }

      return leave;
    }),

  // Review (approve/reject) a leave request
  reviewLeave: adminOrTokenProcedure
    .input(data =>
      parseAsync(
        object({
          leaveId: string(),
          approved: optional(boolean()),
        }),
        data
      )
    )
    .mutation(async opts => {
      // Get admin ID from context using synthetic user if available
      const adminId = opts.ctx.syntheticUser?.id || opts.ctx.user?.dbId;

      if (!adminId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin not authenticated',
        });
      }

      // Process the leave approval/rejection
      const approved = opts.input.approved ?? true;
      const leave = await reviewLeaveRequest(opts.input.leaveId, approved, adminId);

      if (!leave) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Leave request not found',
        });
      }

      return leave;
    }),
});

import { adminProcedure, authProcedure, createTRPCRouter } from "../trpc";
import {
  createLeaveRequest,
  cancelLeaveRequest,
  getLeaveById,
  getDiscordIdsFromUserIds,
  updateLeaveWithMessageId,
  getLeavesForUserOnDate
} from "../../db";
import {
  object,
  string,
  isoTimestamp,
  pipe,
  parseAsync,
  array,
  optional,
  boolean,
} from "valibot";
import { TRPCError } from "@trpc/server";
import { 
  sendLeaveRequestNotification, 
  deleteLeaveRequestMessage 
} from "../../services/discord/services";
import { discordClient } from "../../services/discord";

export const leavesRouter = createTRPCRouter({
  // Request a new leave
  requestLeave: authProcedure
    .input((data) =>
      parseAsync(
        object({
          dates: array(pipe(string(), isoTimestamp())),
          reason: optional(string()),
        }),
        data
      )
    )
    .mutation(async (opts) => {
      const userId = opts.ctx.user.dbId;
      if (!userId) throw new Error("User not authenticated");

      // Convert string dates to Date objects
      const datesToSave = opts.input.dates.map((date) => new Date(date));

      // Create the leave request
      const leave = await createLeaveRequest(
        userId,
        datesToSave,
        opts.input.reason
      );

      // Get Discord ID for the user
      const userDiscordId = (await getDiscordIdsFromUserIds([userId]))[0]
        ?.discordId;
        
      if (userDiscordId && discordClient.isReady()) {
        // Send notification to admin channel
        const result = await sendLeaveRequestNotification(discordClient, leave, userDiscordId);
        
        // If notification sent successfully, store the message ID
        if (result.success && result.messageId) {
          await updateLeaveWithMessageId(leave.id, result.messageId);
        }
      }

      return leave;
    }),

  // Cancel an existing leave request
  cancelLeave: authProcedure
    .input((data) =>
      parseAsync(
        object({
          date: pipe(string(), isoTimestamp()),
        }),
        data
      )
    )
    .mutation(async (opts) => {
      const userId = opts.ctx.user.dbId;
      if (!userId) throw new Error("User not authenticated");
      
      const date = new Date(opts.input.date);
      
      // First, get all leave requests for this user on this date
      const leaves = await getLeavesForUserOnDate(userId, date);
      
      // Delete Discord messages for each leave request
      if (discordClient.isReady()) {
        for (const leave of leaves) {
          if (leave.messageId) {
            await deleteLeaveRequestMessage(discordClient, leave.messageId);
          }
        }
      }
      
      // Now cancel the leave request(s)
      return cancelLeaveRequest(userId, date);
    }),

  // Get leave by ID
  getById: adminProcedure
    .input((data) =>
      parseAsync(
        object({
          leaveId: string(),
        }),
        data
      )
    )
    .query(async (opts) => {
      // Admin permission check should be done in the UI
      const leave = await getLeaveById(opts.input.leaveId);
      if (!leave) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Leave request not found",
        });
      }

      return leave;
    }),
});

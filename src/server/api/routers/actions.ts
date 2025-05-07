import {adminProcedure, createTRPCRouter, publicProcedure} from '../trpc';
import {wrap} from '@typeschema/valibot';
import {object, string, record, optional, number, enum_, boolean} from 'valibot';
import {generateActionToken, getMessageIdUsingObject, verifyActionToken} from '../../db';
import {TRPCError} from '@trpc/server';
import {UserRoleTypes, AssociatedObjectType} from '@prisma/client';
import {updateTokenMessageId, deleteActionTokensByObject} from '../../db/actionTokens';

export enum UrlActions {
  APPROVE_LEAVE = 'approve-leave',
  REJECT_LEAVE = 'reject-leave',
}

// Clean action token schema using Valibot
const actionValues = {
  [UrlActions.APPROVE_LEAVE]: UrlActions.APPROVE_LEAVE,
  [UrlActions.REJECT_LEAVE]: UrlActions.REJECT_LEAVE,
};

// Create object mapping for AssociatedObjectType enum values
const objectTypeValues = {
  [AssociatedObjectType.LEAVE_REQUEST]: AssociatedObjectType.LEAVE_REQUEST,
  // Add other object types here as needed
};

// Define interface that matches the schema structure
interface ActionUrlInput {
  action: UrlActions;
  params: Record<string, string>;
  expirationHours?: number;
  requiresLogin?: boolean;
  userRole?: string;
  associatedObject?: {
    type: AssociatedObjectType;
    id: string;
  };
}

const cleanActionSchema = object({
  action: enum_(actionValues),
  params: record(string(), string()),
  expirationHours: optional(number()),
  requiresLogin: optional(boolean()),
  userRole: optional(string()), // We'll convert this to UserRoleTypes in the handler
  associatedObject: optional(
    object({
      type: enum_(objectTypeValues),
      id: string(),
    })
  ),
});

export const actionsRouter = createTRPCRouter({
  generateActionUrl: adminProcedure
    .input(wrap(cleanActionSchema))
    .mutation(async ({input}: {input: ActionUrlInput}) => {
      if (!process.env.FRONTEND_URL) {
        throw new Error('FRONTEND_URL not set');
      }

      // Convert string role to UserRoleTypes if provided
      let userRole: UserRoleTypes | undefined;
      if (
        input.userRole &&
        Object.values(UserRoleTypes).includes(input.userRole as UserRoleTypes)
      ) {
        userRole = input.userRole as UserRoleTypes;
      }

      // Generate the token and capture tokenId
      const {token, tokenId} = await generateActionToken(input.action, input.params, {
        expirationHours: input.expirationHours,
        requiresLogin: input.requiresLogin,
        userRole,
        associatedObject: input.associatedObject,
      });

      // Create URL with token
      const baseUrl =
        process.env.NODE_ENV === 'production'
          ? process.env.FRONTEND_URL
          : 'http://localhost:' + process.env.PORT;

      // Return both the URL and the tokenId
      return {
        token: `${baseUrl}/?actionToken=${encodeURIComponent(token)}`,
        tokenId,
      };
    }),

  validateActionToken: publicProcedure.input(wrap(string())).query(async ({input, ctx}) => {
    // Pass the current user context to verification
    const result = await verifyActionToken(input, ctx.user);

    if (typeof result === 'string') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: result,
      });
    }

    // Extract the payload, regardless of whether it includes a synthetic user
    const payload = 'payload' in result ? result.payload : result;

    return {
      action: payload.action,
      params: payload.params,
      syntheticUser: 'payload' in result ? result.syntheticUser : null,
    };
  }),

  // New endpoint to update message ID
  updateMessageId: adminProcedure
    .input(
      wrap(
        object({
          tokenId: string(),
          messageId: string(),
        })
      )
    )
    .mutation(async ({input}) => {
      await updateTokenMessageId(input.tokenId, input.messageId);
      return {success: true};
    }),

  // New endpoint to delete tokens by object
  deleteTokensByObject: adminProcedure
    .input(
      wrap(
        object({
          objectType: enum_(objectTypeValues),
          objectId: string(),
        })
      )
    )
    .mutation(async ({input}) => {
      await deleteActionTokensByObject(input.objectType, input.objectId);
      return {success: true};
    }),
  getMessageIdByAssociatedObject: adminProcedure
    .input(
      wrap(
        object({
          objectType: enum_(objectTypeValues),
          objectId: string(),
        })
      )
    )
    .query(async ({input}) => {
      return getMessageIdUsingObject(input.objectType, input.objectId);
    }),
});

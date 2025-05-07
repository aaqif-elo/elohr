// import toast from 'solid-toast';
// import {api} from './api';
// import {getUser} from '../store';
// import {UserRoleTypes} from '@prisma/client';
// import {UrlActions} from '../server/api/routers';

// // Split each handler into prepare (gets action info) and execute (performs action)
// export type ActionInfo = {
//   message: string;
//   execute: () => Promise<void>;
// };

// export type ActionHandler = (params: Record<string, string>) => Promise<ActionInfo>;

// // Registry of all URL action handlers
// const actionHandlers: Record<string, ActionHandler> = {};

// /**
//  * Register a handler for a specific URL action
//  * @param actionName The name of the action parameter in the URL
//  * @param handler The function to handle the action
//  */
// function registerActionHandler(actionName: string, handler: ActionHandler) {
//   actionHandlers[actionName] = handler;
// }

// type PrepareUrlActionResult =
//   | {
//       found: true;
//       actionInfo: ActionInfo;
//     }
//   | {
//       found: false;
//     };

// /**
//  * Process any URL actions present in the provided search parameters
//  * @param searchParams The search parameters from the URL
//  * @returns Information about the action to be processed
//  */
// export async function prepareUrlAction(
//   searchParams: Record<string, string>
// ): Promise<PrepareUrlActionResult> {
//   // Check if there are any registered actions in the URL
//   const actions = Object.keys(actionHandlers).filter(action => searchParams[action] !== undefined);

//   if (actions.length === 0) {
//     return {found: false};
//   }

//   try {
//     // Take the first action and prepare it (usually there should only be one)
//     const actionKey = actions[0];
//     const actionInfo = await actionHandlers[actionKey](searchParams);

//     return {
//       found: true,
//       actionInfo,
//     };
//   } catch (error) {
//     console.error('Error preparing URL action:', error);
//     if (error instanceof Error) {
//       toast.error(`Action preparation failed: ${error.message}`);
//     } else {
//       toast.error(`Action preparation failed: Unknown error`);
//     }
//     throw error;
//   }
// }

// // Add at the beginning of the file:
// export async function prepareUrlActionToken(token: string): Promise<PrepareUrlActionResult> {
//   try {
//     const actionData = await api.actions.validateActionToken.query(token);

//     // Set token in the API headers for subsequent calls
//     api.setHeaders({
//       'X-Action-Token': token,
//     });

//     // Get the handler for this action
//     const handler = actionHandlers[actionData.action];
//     if (!handler) {
//       toast.error(`Unknown action: ${actionData.action}`);
//       return {found: false};
//     }

//     // Execute the handler with the params from the token
//     const actionInfo = await handler(actionData.params);

//     return {
//       found: true,
//       actionInfo,
//     };
//   } catch (error) {
//     console.error('Error processing action token:', error);
//     if (error instanceof Error) {
//       toast.error(`Action token error: ${error.message}`);
//     } else if (typeof error === 'string') {
//       toast.error(`Action token error: ${error}`);
//     } else {
//       toast.error(`Action token error: Unknown error`);
//     }

//     return {found: false};
//   } finally {
//     // Clear the token header after the operation
//     api.clearHeader('X-Action-Token');
//   }
// }

// const prepareLeaveAction = async (leaveId: string, approved: boolean): Promise<ActionInfo> => {
//   if (!leaveId) {
//     throw new Error('No leave ID provided');
//   }

//   // Check if user is admin
//   const user = getUser();
//   if (!user?.roles.includes(UserRoleTypes.ADMIN)) {
//     toast.error('You do not have permission to manage leave requests');
//     throw new Error('Permission denied');
//   }

//   // Get leave details for better messaging
//   const leave = await api.leaves.getById.query({leaveId});
//   const leaveUser = await api.admin.getUser.query({userId: leave.userId});

//   const action = approved ? 'Approving' : 'Rejecting';
//   const userName = leaveUser?.name || 'employee';

//   // Prepare message and execute function
//   return {
//     message: `${action} leave request for ${userName}...`,
//     execute: async () => {
//       // Process approval
//       const updatedLeave = await api.leaves.reviewLeave.mutate({
//         leaveId,
//         approved,
//       });

//       if (!updatedLeave) {
//         throw new Error('Failed to update leave request');
//       }

//       let dateStr = '';
//       if (leave.dates.length > 1) {
//         const sortedDates = leave.dates.sort(
//           (a, b) => new Date(a).getTime() - new Date(b).getTime()
//         );
//         const startDate = new Date(sortedDates[0]).toLocaleDateString();
//         const endDate = new Date(sortedDates[sortedDates.length - 1]).toLocaleDateString();
//         dateStr = `from ${startDate} to ${endDate}`;
//       } else {
//         dateStr = `on ${new Date(leave.dates[0]).toLocaleDateString()}`;
//       }

//       toast.success(
//         `Successfully ${approved ? 'approved' : 'rejected'} leave request for ${leaveUser?.name} ${dateStr}`
//       );
//     },
//   };
// };

// // Register leave approval/rejection handlers
// registerActionHandler(UrlActions.APPROVE_LEAVE, async params => {
//   const leaveId = params[UrlActions.APPROVE_LEAVE];
//   return prepareLeaveAction(leaveId, true);
// });

// registerActionHandler(UrlActions.REJECT_LEAVE, async params => {
//   const leaveId = params[UrlActions.REJECT_LEAVE];
//   return prepareLeaveAction(leaveId, false);
// });

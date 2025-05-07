// import {addAnnouncement, COMMON_ERRORS} from '../../../server/db';
// import {ValidatedEvent} from '../../..//server/middleware/payload.middleware';
// import {getRemoteCommitHash} from '../../../lib/git';

// export async function POST(announcementRequest: ValidatedEvent) {
//   const body = announcementRequest.locals.body;
//   try {
//     const gitCommit = await getRemoteCommitHash(body.gitRepo, body.gitBranch);
//     await addAnnouncement({
//       ...body,
//       gitCommit: gitCommit.commitHash,
//       announcement: gitCommit.description,
//     });
//     return new Response(null, {status: 201});
//   } catch (err) {
//     console.error(err);
//     if (err instanceof Error) {
//       if (err.message === COMMON_ERRORS.DUPLICATE_ENTRY) {
//         return new Response(null, {status: 409});
//       }
//     }
//     return new Response(null, {status: 500});
//   }
// }

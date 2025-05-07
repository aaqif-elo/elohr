import {APIEvent, FetchEvent} from '@solidjs/start/server';
import {object, optional, string, parse, ValiError, pipe, regex, custom} from 'valibot';

const tokenRoutes = new Set(['/api/announcements/deployment']);

const announcementSchema = object({
  channelId: optional(
    pipe(
      string(),
      regex(/^\d+$/, 'channelId must be a numeric string representing a Discord Channel ID')
    )
  ),
  gitBranch: string(),
  gitRepo: pipe(
    string(),
    custom(value => {
      if (typeof value !== 'string') {
        return false;
      }
      const httpUrlPattern = /^https?:\/\/.+\.git$/;
      const sshUrlPattern = /^git@.+:.+\.git$/;
      return httpUrlPattern.test(value) || sshUrlPattern.test(value);
    }, 'gitRepo must be a valid HTTP(S) URL or SSH Git URL ending with .git')
  ),
  announcement: optional(string()),
});

const Announcement = announcementSchema['~types']?.input!;

export interface ValidatedEvent extends APIEvent {
  locals: {
    body: typeof Announcement;
  };
}

export const validatePayload = async (event: FetchEvent) => {
  try {
    const urlObj = new URL(event.request.url);

    if (tokenRoutes.has(urlObj.pathname)) {
      console.log('Token route', urlObj.pathname);
      const body = parse(announcementSchema, await event.request.json());
      event.locals.body = body;
      console.log(body);
    }
  } catch (e) {
    console.log('Error', e);
    if (e instanceof ValiError) {
      let errorMessage = '';

      e.issues.forEach(issue => {
        errorMessage += `${issue.path[0].key}: ${issue.message}` + '\n';
      });

      return new Response(errorMessage, {status: 400});
    }

    if (e instanceof Error) {
      return new Response(e.message, {status: 400});
    }

    return new Response('Unhandled Error', {status: 500});
  }
};

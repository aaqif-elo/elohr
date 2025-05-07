import type {APIEvent} from '@solidjs/start/server';
import {fetchRequestHandler} from '@trpc/server/adapters/fetch';
import {createContext} from '../../../server/api/context';
import {appRouter} from '../../../server/api/root';

const handler = (event: APIEvent) =>
  // adapts tRPC to fetch API style requests
  fetchRequestHandler({
    // the endpoint handling the requests
    endpoint: '/api/trpc',
    // the request object
    req: event.request,
    // the router for handling the requests
    router: appRouter,
    // any arbitrary data that should be available to all actions
    createContext,
  });

export const GET = handler;
export const POST = handler;

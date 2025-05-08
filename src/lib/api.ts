import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  loggerLink,
  splitLink,
} from "@trpc/client";
import type { AppRouter } from "../server/api/root";
import { LOCAL_STORAGE_KEY } from "./auth";
import { EventSourcePolyfill } from "event-source-polyfill";

const getBaseUrl = () => {
  if (typeof window !== "undefined") return "";
  // replace example.com with your actual production url
  if (process.env.NODE_ENV === "production" && process.env.FRONTEND_URL) {
    console.log(process.env.FRONTEND_URL);
    return process.env.FRONTEND_URL;
  }
  console.log(process.env.PORT);
  return `http://localhost:${process.env.PORT ?? 3000}`;
};

// Create a custom headers store
const customHeaders: Record<string, string> = {};

// Create the base client
export const api = createTRPCClient<AppRouter>({
  links: [
    loggerLink({
      enabled: () => false,
    }),
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({
        url: `${getBaseUrl()}/api/trpc`,
        EventSource: EventSourcePolyfill,
        eventSourceOptions: async () => {
          return {
            headers: {
              Authorization: `Bearer ${
                localStorage.getItem(LOCAL_STORAGE_KEY) || ""
              }`,
              ...customHeaders,
            },
          };
        },
      }),
      false: httpBatchLink({
        url: `${getBaseUrl()}/api/trpc`,
        headers() {
          return {
            Authorization: `Bearer ${
              localStorage.getItem(LOCAL_STORAGE_KEY) || ""
            }`,
            ...customHeaders,
          };
        },
      }),
    }),
  ],
});

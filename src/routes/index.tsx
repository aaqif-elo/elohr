import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";
import toast from "solid-toast";
import FullScreenLoader from "~/components/FullScreenLoader";
import UnauthenticatedHome from "~/components/UnauthenticatedHome";
import { api } from "~/lib/api";
import { LOCAL_STORAGE_KEY, loginWithStoredJWT } from "~/lib/auth";
import {setAttendance, setUser} from '~/store';
// import {prepareUrlAction, prepareUrlActionToken} from '~/lib/urlActionHandlers';

export default function Home() {
  const [searchParams] = useSearchParams();
  const [loggingIn, setLoggingIn] = createSignal(false);
  const [actionMessage, setActionMessage] = createSignal("");
  const navigate = useNavigate();

  // Unified action processing function
  const processAllUrlActions = async () => {
    const hasActionToken = typeof searchParams.actionToken === "string";

    try {
      // Step 1: Process action token if present
      if (hasActionToken) {
        const token = searchParams.actionToken as string;
        // const tokenResp = await prepareUrlActionToken(token);

        // if (tokenResp.found) {
        //   setActionMessage(tokenResp.actionInfo.message);
        //   await tokenResp.actionInfo.execute();
        // }
      }

      // Step 2: Process other URL parameters
      const params: Record<string, string> = {};
      Object.entries(searchParams).forEach(([key, value]) => {
        if (key !== "hash" && key !== "actionToken" && value !== undefined) {
          params[key] = Array.isArray(value) ? value.join(",") : String(value);
        }
      });

      if (Object.keys(params).length > 0) {
        // const urlResp = await prepareUrlAction(params);
        // if (urlResp.found) {
        //   setActionMessage(urlResp.actionInfo.message);
        //   await urlResp.actionInfo.execute();
        // }
      }

      // Step 3: Clear all action parameters from URL
      const url = new URL(window.location.href);
      if (hasActionToken) {
        url.searchParams.delete("actionToken");
      }
      Object.keys(params).forEach((key) => {
        url.searchParams.delete(key);
      });
      window.history.replaceState({}, "", url);
    } catch (error) {
      console.error("Error processing URL actions:", error);
      if (error instanceof Error) {
        toast.error(`Action failed: ${error.message}`);
      } else {
        toast.error("Action processing failed");
      }
    } finally {
      // Navigate to home after all processing is complete
      if (localStorage.getItem(LOCAL_STORAGE_KEY)) {
        navigate("/home");
      } else {
        setLoggingIn(false);
      }
    }
  };

  onMount(async () => {
    // Anything inside onMount runs only in the browser, never on the server.

    // Case 1: Hash exists - process login first
    if (typeof searchParams.hash === "string") {
      console.log("Hash is", searchParams.hash);
      setLoggingIn(true);

      try {
        const loginPayload = await api.auth.loginWithHash.query(
          searchParams.hash
        );

        if (loginPayload.jwt) {
          localStorage.setItem(LOCAL_STORAGE_KEY, loginPayload.jwt);
        }

        const { user, attendance } = loginPayload.userWithAttendance;
        setUser(user);
        if (attendance) {
          setAttendance(attendance);
        }

        toast.success("Successfully logged in!");

        // After login, process all URL actions at once
        await processAllUrlActions();
      } catch (err) {
        console.error(err);
        toast.error(
          `Login failed: ${
            err instanceof Error ? err.message : "Unknown error"
          }`
        );
        setLoggingIn(false);
      }
    }
    // Case 2: No hash, but might have actions to process
    else {
      const storedAuthJwt = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedAuthJwt) {
        setLoggingIn(true);
        const loggedIn = await loginWithStoredJWT(storedAuthJwt);

        if (loggedIn) {
          toast.success("Successfully logged in!");
          await processAllUrlActions();
        } else {
          toast.error("Login failed: Your session has expired or is invalid");
          setLoggingIn(false);
        }
      } else {
        // Check if there are URL actions requiring no auth
        if (
          searchParams.actionToken ||
          Object.keys(searchParams).some((key) => key !== "hash")
        ) {
          setLoggingIn(true);
          await processAllUrlActions();
        } else {
          // No stored token or actions, just hide the loader
          setLoggingIn(false);
        }
      }
    }
  });
  console.log("Logging in:", loggingIn());
  return (
    <main class="flex h-3/4 flex-col items-center justify-center">
      <Show
        when={!loggingIn()}
        fallback={
          <FullScreenLoader loaderText={actionMessage() || "Logging in..."} />
        }
      >
        <UnauthenticatedHome />
      </Show>
    </main>
  );
}

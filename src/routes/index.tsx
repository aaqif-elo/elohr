import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";
import toast from "solid-toast";
import FullScreenLoader from "../components/FullScreenLoader";
import UnauthenticatedHome from "../components/UnauthenticatedHome";
import { api } from "../lib/api";
import { LOCAL_STORAGE_KEY, loginWithStoredJWT } from "../lib/auth";

export default function Home() {
  const [searchParams] = useSearchParams();
  const [loggingIn, setLoggingIn] = createSignal(false);
  const [actionMessage, setActionMessage] = createSignal("");
  const navigate = useNavigate();

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
    const token = searchParams.token;

    if (typeof token === "string") {
      setLoggingIn(true);
      const isValid = await api.auth.validateJWT.query(token);
      if (!isValid) {
        toast.error("Login failed: Invalid or expired token");
        setLoggingIn(false);
        return;
      }
      // validate + fetch user
      const userWithAttendance = await loginWithStoredJWT(token);
      if (userWithAttendance) {
        localStorage.setItem(LOCAL_STORAGE_KEY, token);

        toast.success("Successfully logged in!");
        await processAllUrlActions();
      } else {
        toast.error("Login failed: Invalid or expired token");
        setLoggingIn(false);
      }
    } else {
      // your existing stored-JWT / actionToken / no-auth flow
      const storedAuthJwt = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedAuthJwt) {
        setLoggingIn(true);
        const ok = await loginWithStoredJWT(storedAuthJwt);
        if (ok) {
          toast.success("Successfully logged in!");
          await processAllUrlActions();
        } else {
          toast.error("Login failed: Session expired or invalid");
          setLoggingIn(false);
        }
      } else if (
        searchParams.actionToken ||
        Object.keys(searchParams).some((k) => k !== "token")
      ) {
        setLoggingIn(true);
        await processAllUrlActions();
      } else {
        setLoggingIn(false);
      }
    }
  });

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

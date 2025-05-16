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
  const navigate = useNavigate();

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
        navigate("/home");
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
          navigate("/home");
        } else {
          toast.error("Login failed: Session expired or invalid");
          setLoggingIn(false);
        }
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
          <FullScreenLoader loaderText={"Logging in..."} />
        }
      >
        <UnauthenticatedHome />
      </Show>
    </main>
  );
}

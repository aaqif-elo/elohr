import { setAttendance, setUser } from "../store";
import { api } from "./api";

export const LOCAL_STORAGE_KEY = "authJWT";

export function getStoredAuthToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? "";
}

export function hasStoredAuthToken(): boolean {
  return Boolean(getStoredAuthToken());
}

export const loginWithStoredJWT = async (storedAuthJwt: string) => {
  try {
    const trpcUser = await api.auth.loginWithStoredJWT.query(storedAuthJwt);
    if (trpcUser) {
      const { user, attendance } = trpcUser;
      setUser(user);
      if (attendance) {
        setAttendance(attendance);
      }
      return true;
    }
    // localStorage.removeItem(LOCAL_STORAGE_KEY);
    return false;
  } catch (err) {
    console.error(err);
    // localStorage.removeItem(LOCAL_STORAGE_KEY);
    return false;
  }
};

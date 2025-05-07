import { setAttendance, setUser } from "../store";
import { api } from "./api";

export const LOCAL_STORAGE_KEY = "authJWT";

export const loginWithStoredJWT = async (storedAuthJwt: string) => {
  try {
    console.log("Logging in with stored JWT:", storedAuthJwt);
    console.log("api", api);
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

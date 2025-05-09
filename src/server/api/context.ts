import {FetchCreateContextFnOptions} from '@trpc/server/adapters/fetch';
import {verifyAndDecodeToken} from '../middleware/auth.middlewares';

export async function createContext({req}: FetchCreateContextFnOptions) {
  function getUserFromHeader() {
    const auth = req.headers.get('Authorization');
    if (!auth) return null;
    try {
      const user = verifyAndDecodeToken(auth);
      if (typeof user === 'string') return null;
      return user;
    } catch {
      // invalid or expired → treat as “not logged in”
      return null;
    }
  }

  const user = getUserFromHeader();
  return {
    user,
    req,
  };
}
export type Context = Awaited<ReturnType<typeof createContext>>;

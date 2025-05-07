import {FetchCreateContextFnOptions} from '@trpc/server/adapters/fetch';
import {verifyAndDecodeToken} from '../middleware/auth.middlewares';

export async function createContext({req}: FetchCreateContextFnOptions) {
  function getUserFromHeader() {
    if (req.headers.get('Authorization')) {
      const user = verifyAndDecodeToken(req.headers.get('Authorization'));
      if (typeof user === 'string') {
        return null;
      }
      return user;
    }
    return null;
  }

  const user = getUserFromHeader();
  return {
    user,
    req, // Include the request object so tokenProcedure can access headers
  };
}
export type Context = Awaited<ReturnType<typeof createContext>>;

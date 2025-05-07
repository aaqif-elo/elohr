import jwt from 'jsonwebtoken';
import {FetchEvent} from '@solidjs/start/server';
import {customJwtPayload} from '../api/routers';

const tokenRoutes = new Set([
  '/api/announcements/deployment',
  '/api/trpc/attendance.getLatestAttendance',
]);

export const verifyAndDecodeToken = (token?: string | null): string | customJwtPayload => {
  if (!token) return 'No token';

  const bearerToken = token.split(' ')[1];

  if (!bearerToken) return 'No token';

  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not set');

  const decoded = jwt.verify(bearerToken, process.env.JWT_SECRET);

  if (!decoded) return 'Invalid token';

  if (typeof decoded === 'string') return decoded;

  return decoded as customJwtPayload;
};

export const validateToken = async (event: FetchEvent) => {
  try {
    const urlObj = new URL(event.request.url);

    if (tokenRoutes.has(urlObj.pathname)) {
      const token = event.request.headers.get('Authorization');
      const decoded = verifyAndDecodeToken(token);

      if (typeof decoded === 'string') {
        return new Response(decoded, {status: 401});
      }
    }
  } catch (e) {
    console.log('Error', e);
    if (e instanceof Error) {
      return new Response(e.message, {status: 400});
    }

    return new Response('Unhandled Error', {status: 500});
  }
};

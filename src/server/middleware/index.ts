import {createMiddleware} from '@solidjs/start/middleware';
import {validateToken} from './auth.middlewares';
import {validatePayload} from './payload.middleware';
import {requestLogger} from './logging.middlewares';

export default createMiddleware({
  onRequest: [requestLogger, validateToken, validatePayload],
});

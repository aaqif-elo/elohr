import {RouteSectionProps, useLocation, useNavigate} from '@solidjs/router';
import {createRenderEffect, createSignal, JSX, on, onMount, Show} from 'solid-js';
import toast from 'solid-toast';
import {api} from '~/lib/api';
import {LOCAL_STORAGE_KEY, loginWithStoredJWT} from '~/lib/auth';
import {getUser} from '~/store';
import FullScreenLoader from './FullScreenLoader';

export function AuthGuard(props: RouteSectionProps): JSX.Element {
  const [isAuthenticated, setIsAuthenticated] = createSignal(false);
  const navigate = useNavigate();
  const location = useLocation();

  onMount(() => {
    async function performAuthCheck() {
      try {
        const storedAuthJwt = localStorage.getItem(LOCAL_STORAGE_KEY);

        if (!storedAuthJwt) {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          toast.error('Authentication required. Please login.');
          navigate('/');
          return;
        }

        const auth = await api.auth.validateJWT.query(storedAuthJwt);

        if (auth) {
          const user = getUser();
          if (!user) {
            const loggedIn = await loginWithStoredJWT(storedAuthJwt);
            if (loggedIn) {
              setIsAuthenticated(true);
            } else {
              toast.error('Your session has expired. Please login again.');
              navigate('/');
            }
          } else {
            setIsAuthenticated(true);
          }
        } else {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          toast.error('Invalid authentication. Please login again.');
          navigate('/');
        }
      } catch (error) {
        console.error('Authentication error:', error);
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        toast.error(
          `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        navigate('/');
      }
    }

    createRenderEffect(on(() => location.pathname, performAuthCheck));
  });

  return (
    <>
      <Show when={isAuthenticated()} fallback={<FullScreenLoader loaderText="Authenticating..." />}>
        {props.children}
      </Show>
    </>
  );
}

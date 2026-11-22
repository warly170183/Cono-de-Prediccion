import { auth } from './firebase.ts';

/**
 * Añade el ID token de Firebase a las llamadas same-origin a /api/*
 * para que el servidor pueda autorizar los endpoints de escritura.
 */
const originalFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const isApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
    const user = auth.currentUser;
    if (isApi && user) {
      const token = await user.getIdToken();
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      return originalFetch(input, { ...init, headers });
    }
  } catch {
    /* sin token: se envía la petición tal cual */
  }
  return originalFetch(input, init);
};

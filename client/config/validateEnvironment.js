export function validateBuildEnvironment(env) {
  const mock = env.VITE_USE_MOCK
  if (mock !== undefined && !['', 'true', 'false'].includes(mock)) {
    throw new Error('VITE_USE_MOCK must be "false" for the real API or explicitly "true" for a demo build.')
  }
  if (mock === 'true') return

  if (typeof env.VITE_API_URL !== 'string' || !env.VITE_API_URL.trim()) {
    throw new Error('VITE_API_URL is required for a real API build. Set it to the backend HTTPS origin (for example, https://your-api.onrender.com), then rebuild. Use VITE_USE_MOCK=true only for an explicit demo.')
  }

  let url
  try { url = new URL(env.VITE_API_URL) } catch {
    throw new Error('VITE_API_URL must be an absolute backend URL, such as https://your-api.onrender.com.')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('VITE_API_URL must contain only the backend origin, without credentials, /api, another path, a query, or a fragment.')
  }

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('VITE_API_URL must use HTTPS for deployment. HTTP is allowed only for localhost, 127.0.0.1, or [::1] during local testing.')
  }
}

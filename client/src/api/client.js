import axios from 'axios'
import { formatApiError } from '../utils/apiErrors'
import { createAuthSessionStore, shouldExpireSession, usesAccountSession } from '../utils/authSession'

export const isMockMode = import.meta.env.VITE_USE_MOCK === 'true'
export const authSession = createAuthSessionStore(isMockMode)

const apiClient = axios.create({
  baseURL: isMockMode ? '' : (import.meta.env.VITE_API_URL || '').trim(),
  timeout: 90000,
})

if (isMockMode) {
  apiClient.defaults.adapter = async (config) => {
    const { default: mockApiAdapter } = await import('../mocks/mockApi')
    return mockApiAdapter(config)
  }
}

apiClient.interceptors.request.use((config) => {
  const token = usesAccountSession(config) ? authSession.get() : null

  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = 'Bearer ' + token
    config.accountSessionToken = token
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (shouldExpireSession(error, authSession.get())) {
      authSession.clear()

      if (window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }

    return Promise.reject(error)
  },
)

export function getApiErrorMessage(error, fallback, language = typeof document === 'undefined' ? 'en' : document.documentElement.lang) {
  return formatApiError(error, fallback, language)
}

export default apiClient

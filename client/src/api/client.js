import axios from 'axios'
import { formatApiError } from '../utils/apiErrors'
import { createAuthSessionStore, createSessionRotationGate, shouldExpireAfterRotation, tokenForAccountRequest } from '../utils/authSession'

export const isMockMode = import.meta.env.VITE_USE_MOCK === 'true'
export const authSession = createAuthSessionStore(isMockMode)
export const sessionRotation = createSessionRotationGate()

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
  const token = tokenForAccountRequest(config, authSession.get())

  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = 'Bearer ' + token
    config.accountSessionToken = token
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (await shouldExpireAfterRotation(error, () => authSession.get(), sessionRotation)) {
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

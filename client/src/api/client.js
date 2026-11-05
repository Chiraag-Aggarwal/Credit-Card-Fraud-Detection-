import axios from 'axios'
import mockApiAdapter from '../mocks/mockApi'
import { formatApiError } from '../utils/apiErrors'

export const TOKEN_STORAGE_KEY = 'fraud-dashboard-token'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
})

if (import.meta.env.VITE_USE_MOCK === 'true') {
  apiClient.defaults.adapter = mockApiAdapter
}

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = 'Bearer ' + token
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY)

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

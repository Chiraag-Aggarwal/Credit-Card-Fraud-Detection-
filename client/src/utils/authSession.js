export function createAuthSessionStore(mock = false, getStorage = () => globalThis.localStorage) {
  const key = mock ? 'fraud-dashboard-token-mock' : 'fraud-dashboard-token-real'
  let memoryToken = null
  let storageDisabled = false
  return {
    key,
    get() {
      try {
        const storage = storageDisabled ? null : getStorage()
        if (storage) memoryToken = storage.getItem(key)
      } catch { storageDisabled = true }
      return memoryToken
    },
    set(token) {
      memoryToken = token
      try { getStorage()?.setItem(key, token) } catch { storageDisabled = true }
    },
    clear() {
      memoryToken = null
      try { getStorage()?.removeItem(key) } catch { storageDisabled = true }
    },
  }
}

export function usesAccountSession(config) {
  const pathname = new URL(config.url || '/', 'http://local.invalid').pathname.replace(/\/+$/, '')
  return !['/api/auth/login', '/api/auth/register', '/api/payments/verify'].includes(pathname)
}

export function shouldExpireSession(error, currentToken) {
  return error?.response?.status === 401 && Boolean(currentToken) &&
    error.config?.accountSessionToken === currentToken && usesAccountSession(error.config)
}

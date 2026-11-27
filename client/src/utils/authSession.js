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
  return !['/api/auth/login', '/api/auth/register', '/api/auth/recover', '/api/payments/verify'].includes(pathname)
}

export function shouldExpireSession(error, currentToken) {
  return error?.response?.status === 401 && Boolean(currentToken) &&
    error.config?.accountSessionToken === currentToken && usesAccountSession(error.config)
}

export function createSessionRotationGate() {
  const pending = new Map()
  return {
    begin(token) {
      if (!token || pending.has(token)) throw new Error('An account security update is already in progress.')
      let settle
      const promise = new Promise((resolve) => { settle = resolve })
      pending.set(token, promise)
      return () => {
        if (pending.get(token) === promise) pending.delete(token)
        settle()
      }
    },
    wait(token) { return pending.get(token) || Promise.resolve() },
  }
}

export function tokenForAccountRequest(config, currentToken) {
  if (!usesAccountSession(config)) return null
  return typeof config.pinnedAccountSessionToken === 'string' ? config.pinnedAccountSessionToken : currentToken
}

export async function shouldExpireAfterRotation(error, currentToken, rotationGate) {
  if (error?.response?.status !== 401 || !error.config?.accountSessionToken || !usesAccountSession(error.config)) return false
  // Polling can reject the old token while a password change is issuing its replacement.
  // The password-change request itself must never wait on the operation it completes.
  if (!error.config.sessionRotationRequest) await rotationGate.wait(error.config.accountSessionToken)
  return shouldExpireSession(error, currentToken())
}

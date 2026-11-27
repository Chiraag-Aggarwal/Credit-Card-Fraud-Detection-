export function recoveryCodesFromResponse(data) {
  const codes = data?.recoveryCodes
  if (!Array.isArray(codes) || codes.length !== 8 || new Set(codes).size !== codes.length ||
      codes.some((code) => typeof code !== 'string' || !/^[a-zA-Z0-9-]{32,100}$/.test(code))) {
    throw new Error('The server did not return a complete set of recovery codes.')
  }
  return [...codes]
}

export function saveAccountSession(data, session, setUser) {
  if (typeof data?.token !== 'string' || !data.token || !data.user?.id ||
      typeof data.user.email !== 'string' || typeof data.user.name !== 'string') {
    throw new Error('The server returned an incomplete sign-in response.')
  }
  session.set(data.token)
  setUser(data.user)
  return data.user
}

export async function revokeAccountSession(api, session, clearUser, { all = false, mock = false } = {}) {
  const originalToken = session.get()
  if (originalToken && !mock) {
    try {
      await api.post(all ? '/api/auth/logout-all' : '/api/auth/logout', undefined, { pinnedAccountSessionToken: originalToken })
    } catch (error) {
      // An expired or already revoked token is no longer a usable server session.
      if (error?.response?.status !== 401) throw error
    }
  }
  // A delayed logout must never clear a newer sign-in from this tab or another tab.
  if (session.get() === originalToken || !session.get()) {
    session.clear()
    clearUser()
    return true
  }
  return false
}

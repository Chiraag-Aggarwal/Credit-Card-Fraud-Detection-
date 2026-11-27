import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import apiClient, { authSession, isMockMode, sessionRotation } from '../api/client'
import { revokeAccountSession, saveAccountSession } from '../utils/accountSecurity'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const syncSession = (event) => {
      if (event.key === authSession.key || event.key === null) window.location.reload()
    }
    window.addEventListener('storage', syncSession)
    return () => window.removeEventListener('storage', syncSession)
  }, [])

  useEffect(() => {
    let active = true
    const token = authSession.get()

    if (!token) {
      setLoading(false)
      return () => {
        active = false
      }
    }

    apiClient
      .get('/api/auth/me')
      .then(({ data }) => {
        if (active && authSession.get() === token) setUser(data.user)
      })
      .catch(() => {
        if (active && authSession.get() === token) setUser(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const login = useCallback(async (credentials) => {
    const { data } = await apiClient.post('/api/auth/login', {
      email: credentials.email,
      password: credentials.password,
    })
    return saveAccountSession(data, authSession, setUser)
  }, [])

  const register = useCallback(async (details) => {
    const { data } = await apiClient.post('/api/auth/register', {
      name: details.name,
      email: details.email,
      password: details.password,
    })
    saveAccountSession(data, authSession, setUser)
    return data
  }, [])

  const logout = useCallback((all = false) => revokeAccountSession(
    apiClient, authSession, () => setUser(null), { all, mock: isMockMode },
  ), [])

  const clearLocalSession = useCallback(() => {
    authSession.clear()
    setUser(null)
  }, [])

  const changePassword = useCallback(async (details) => {
    const previousToken = authSession.get()
    const finishRotation = sessionRotation.begin(previousToken)
    try {
      const { data } = await apiClient.post('/api/auth/change-password', details, {
        pinnedAccountSessionToken: previousToken, sessionRotationRequest: true,
      })
      if (authSession.get() !== previousToken) {
        throw new Error('Your session changed. Sign in again with your new password.')
      }
      return saveAccountSession(data, authSession, setUser)
    } finally {
      finishRotation()
    }
  }, [])

  const updateProfile = useCallback(async (details) => {
    const previousToken = authSession.get()
    const { data } = await apiClient.patch('/api/auth/me', {
      name: details.name,
      email: details.email,
      ...(details.currentPassword ? { currentPassword: details.currentPassword } : {}),
    }, { pinnedAccountSessionToken: previousToken })
    if (!data?.user?.id || typeof data.user.name !== 'string' || typeof data.user.email !== 'string') {
      throw new Error('The server returned an incomplete profile response.')
    }
    if (authSession.get() === previousToken) setUser(data.user)
    return data.user
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout, clearLocalSession, updateProfile, changePassword }),
    [user, loading, login, register, logout, clearLocalSession, updateProfile, changePassword],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.')
  }

  return context
}

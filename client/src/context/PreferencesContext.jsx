import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_OPTIONS,
  PREFERENCES_STORAGE_KEY,
  readPreferences,
  writePreferences,
} from '../utils/preferences'

const PreferencesContext = createContext(null)

export function PreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState(readPreferences)
  const [storageAvailable, setStorageAvailable] = useState(true)

  useLayoutEffect(() => {
    const root = document.documentElement
    root.lang = preferences.language
    root.dataset.mode = preferences.mode
    root.dataset.theme = preferences.theme
    root.dataset.fontSize = preferences.fontSize
    root.dataset.fontFamily = preferences.fontFamily
    root.style.colorScheme = preferences.mode
  }, [preferences])

  useEffect(() => {
    setStorageAvailable(writePreferences(preferences))
  }, [preferences])

  useEffect(() => {
    function syncPreferences(event) {
      if (event.key === PREFERENCES_STORAGE_KEY || event.key === null) {
        setPreferences(readPreferences())
      }
    }
    window.addEventListener('storage', syncPreferences)
    return () => window.removeEventListener('storage', syncPreferences)
  }, [])

  const setPreference = useCallback((key, value) => {
    if (!PREFERENCE_OPTIONS[key]?.includes(value)) return
    setPreferences((current) => (current[key] === value ? current : { ...current, [key]: value }))
  }, [])

  const setLanguage = useCallback((value) => setPreference('language', value), [setPreference])
  const setMode = useCallback((value) => setPreference('mode', value), [setPreference])
  const setTheme = useCallback((value) => setPreference('theme', value), [setPreference])
  const setFontSize = useCallback((value) => setPreference('fontSize', value), [setPreference])
  const setFontFamily = useCallback((value) => setPreference('fontFamily', value), [setPreference])
  const resetPreferences = useCallback(() => setPreferences({ ...DEFAULT_PREFERENCES }), [])
  const t = useCallback(
    (english, hindi = english) => (preferences.language === 'hi' ? hindi : english),
    [preferences.language],
  )

  const value = useMemo(() => ({
    ...preferences,
    setLanguage,
    setMode,
    setTheme,
    setFontSize,
    setFontFamily,
    resetPreferences,
    storageAvailable,
    t,
    locale: preferences.language === 'hi' ? 'hi-IN' : 'en-IN',
  }), [preferences, setLanguage, setMode, setTheme, setFontSize, setFontFamily, resetPreferences, storageAvailable, t])

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences() {
  const context = useContext(PreferencesContext)
  if (!context) throw new Error('usePreferences must be used within a PreferencesProvider.')
  return context
}

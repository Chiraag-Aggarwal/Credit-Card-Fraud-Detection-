export const PREFERENCES_STORAGE_KEY = 'fraud-dashboard.preferences.v1'

export const DEFAULT_PREFERENCES = Object.freeze({
  language: 'en',
  mode: 'light',
  theme: 'lavender',
  fontSize: 'medium',
  fontFamily: 'system',
})

export const PREFERENCE_OPTIONS = Object.freeze({
  language: ['en', 'hi'],
  mode: ['light', 'dark'],
  theme: ['lavender', 'mint', 'ocean', 'rose'],
  fontSize: ['small', 'medium', 'large'],
  fontFamily: ['system', 'serif', 'rounded'],
})

export function normalizePreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return Object.fromEntries(
    Object.entries(DEFAULT_PREFERENCES).map(([key, fallback]) => [
      key,
      PREFERENCE_OPTIONS[key].includes(source[key]) ? source[key] : fallback,
    ]),
  )
}

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readPreferences(storage = browserStorage()) {
  try {
    return normalizePreferences(JSON.parse(storage?.getItem(PREFERENCES_STORAGE_KEY) || 'null'))
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function writePreferences(preferences, storage = browserStorage()) {
  try {
    if (!storage) return false
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(normalizePreferences(preferences)))
    return true
  } catch {
    return false
  }
}

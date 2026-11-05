import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  normalizePreferences,
  readPreferences,
  writePreferences,
} from '../src/utils/preferences.js'

test('preferences survive a reload and do not overwrite authentication data', () => {
  const values = new Map([['fraud-dashboard-token', 'existing-session']])
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const preferences = { language: 'hi', mode: 'dark', theme: 'ocean', fontSize: 'large', fontFamily: 'serif' }
  assert.equal(writePreferences(preferences, storage), true)
  assert.deepEqual(readPreferences(storage), preferences)
  assert.equal(values.get('fraud-dashboard-token'), 'existing-session')
  assert.equal(values.size, 2)
})

test('corrupt or unavailable browser storage does not prevent app startup', () => {
  assert.deepEqual(readPreferences({ getItem: () => '{broken-json' }), DEFAULT_PREFERENCES)
  assert.deepEqual(readPreferences({ getItem: () => { throw new Error('Storage blocked') } }), DEFAULT_PREFERENCES)
  assert.deepEqual(readPreferences(null), DEFAULT_PREFERENCES)
  assert.equal(writePreferences(DEFAULT_PREFERENCES, { setItem: () => { throw new Error('Quota exceeded') } }), false)
  assert.equal(writePreferences(DEFAULT_PREFERENCES, null), false)
})

test('old or invalid saved settings keep valid choices and safely default unsupported values', () => {
  const normalized = normalizePreferences({
    language: 'hi', mode: 'unknown', theme: '<script>', fontSize: 300, fontFamily: 'serif', token: 'not-a-preference',
  })
  assert.deepEqual(normalized, { ...DEFAULT_PREFERENCES, language: 'hi', fontFamily: 'serif' })
  assert.deepEqual(normalizePreferences(['dark', 'hi']), DEFAULT_PREFERENCES)
  assert.deepEqual(normalizePreferences(null), DEFAULT_PREFERENCES)
  assert.equal(PREFERENCES_STORAGE_KEY, 'fraud-dashboard.preferences.v1')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { recoveryCodesFromResponse, revokeAccountSession, saveAccountSession } from '../src/utils/accountSecurity.js'
import { createAuthSessionStore, createSessionRotationGate, shouldExpireAfterRotation, shouldExpireSession, tokenForAccountRequest, usesAccountSession } from '../src/utils/authSession.js'

function memorySession(token = 'original-session') {
  const values = new Map()
  const session = createAuthSessionStore(false, () => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }))
  session.set(token)
  return { session, values }
}

const testCodes = Array.from({ length: 8 }, (_, index) => String(index).padStart(32, 'a'))

test('recovery codes are validated as a complete unique set and returned without sharing the response array', () => {
  const response = { recoveryCodes: [...testCodes] }
  const codes = recoveryCodesFromResponse(response)
  codes.pop()
  assert.equal(response.recoveryCodes.length, 8)
  for (const data of [{}, { recoveryCodes: testCodes.slice(0, 7) }, { recoveryCodes: Array(8).fill(testCodes[0]) }, { recoveryCodes: [...testCodes.slice(1), '<script>bad</script>'] }]) {
    assert.throws(() => recoveryCodesFromResponse(data), /complete set/)
  }
})

test('successful account session saves only the token, never recovery codes or credentials', () => {
  const { session, values } = memorySession()
  const user = { id: 'user-a', name: 'Account A', email: 'a@example.com', role: 'merchant' }
  let currentUser
  const saved = saveAccountSession({ token: 'new-session', user, recoveryCodes: testCodes }, session, (value) => { currentUser = value })
  assert.equal(saved, user)
  assert.equal(currentUser, user)
  assert.deepEqual([...values.values()], ['new-session'])
  assert.ok(testCodes.every((code) => ![...values.values()].includes(code)))
})

test('malformed sign-in or password-change response cannot overwrite a valid session', () => {
  const { session } = memorySession()
  for (const response of [null, { token: '' }, { token: 'new', user: {} }, { token: 123, user: { id: 'a', name: 'A', email: 'a@example.com' } }]) {
    assert.throws(() => saveAccountSession(response, session, () => assert.fail('Must not update the user')), /incomplete/)
    assert.equal(session.get(), 'original-session')
  }
})

test('logout waits for server revocation before discarding the current token', async () => {
  const { session } = memorySession()
  let finish
  let cleared = false
  const api = { post: (path) => {
    assert.equal(path, '/api/auth/logout')
    return new Promise((resolve) => { finish = resolve })
  } }
  const pending = revokeAccountSession(api, session, () => { cleared = true })
  assert.equal(session.get(), 'original-session')
  assert.equal(cleared, false)
  finish()
  assert.equal(await pending, true)
  assert.equal(session.get(), null)
  assert.equal(cleared, true)
})

test('failed logout keeps the session so the user can retry revocation', async () => {
  const { session } = memorySession()
  const error = new Error('Offline')
  await assert.rejects(revokeAccountSession({ post: async () => { throw error } }, session, () => assert.fail('Must not claim sign-out')), (actual) => actual === error)
  assert.equal(session.get(), 'original-session')
})

test('logout-all calls its endpoint and already revoked credentials can be discarded', async () => {
  const { session } = memorySession()
  let cleared = false
  await revokeAccountSession({ post: async (path) => {
    assert.equal(path, '/api/auth/logout-all')
    throw { response: { status: 401 } }
  } }, session, () => { cleared = true }, { all: true })
  assert.equal(cleared, true)
  assert.equal(session.get(), null)
})

test('late logout cannot discard a newer sign-in token', async () => {
  const { session } = memorySession()
  let finish
  const pending = revokeAccountSession({ post: () => new Promise((resolve) => { finish = resolve }) }, session, () => assert.fail('Must keep new user'))
  session.set('newer-session')
  finish()
  assert.equal(await pending, false)
  assert.equal(session.get(), 'newer-session')
})

test('logout pins the intended token even when a new sign-in happens before dispatch', async () => {
  const { session } = memorySession()
  const api = { post: async (url, body, config) => {
    session.set('different-account-token')
    assert.equal(tokenForAccountRequest({ ...config, url }, session.get()), 'original-session')
    assert.equal(body, undefined)
  } }
  assert.equal(await revokeAccountSession(api, session, () => assert.fail('Must keep newer account')), false)
  assert.equal(session.get(), 'different-account-token')
})

test('a polling 401 waits for password rotation and cannot expire its replacement token', async () => {
  const { session } = memorySession()
  const gate = createSessionRotationGate()
  const finish = gate.begin(session.get())
  const error = { response: { status: 401 }, config: { url: '/api/alerts/unread-count', accountSessionToken: session.get() } }
  let settled = false
  const pending = shouldExpireAfterRotation(error, () => session.get(), gate).then((result) => { settled = true; return result })
  await Promise.resolve()
  assert.equal(settled, false)
  session.set('replacement-token')
  finish()
  assert.equal(await pending, false)
  assert.equal(session.get(), 'replacement-token')
})

test('failed rotation releases deferred 401s and an invalid password-change session never deadlocks', async () => {
  const { session } = memorySession()
  const gate = createSessionRotationGate()
  const finish = gate.begin(session.get())
  const error = { response: { status: 401 }, config: { url: '/api/auth/change-password', accountSessionToken: session.get(), sessionRotationRequest: true } }
  assert.equal(await shouldExpireAfterRotation(error, () => session.get(), gate), true)
  const pending = shouldExpireAfterRotation({ ...error, config: { ...error.config, url: '/api/auth/me', sessionRotationRequest: false } }, () => session.get(), gate)
  finish()
  assert.equal(await pending, true)
  assert.equal(await shouldExpireAfterRotation({ response: { status: 503 }, config: error.config }, () => session.get(), gate), false)
})

test('public recovery never attaches or expires an unrelated signed-in account', () => {
  for (const url of ['/api/auth/recover', '/api/auth/recover/', 'https://api.example.com/api/auth/recover?from=login']) {
    const config = { url, accountSessionToken: 'current' }
    assert.equal(usesAccountSession(config), false)
    assert.equal(shouldExpireSession({ response: { status: 401 }, config }, 'current'), false)
  }
  assert.equal(usesAccountSession({ url: '/api/auth/recovery-codes' }), true)
  assert.equal(usesAccountSession({ url: '/api/auth/change-password' }), true)
})

test('mock sign-out stays local and does not claim a real server operation', async () => {
  const { session } = memorySession('mock-token')
  assert.equal(await revokeAccountSession({ post: () => assert.fail('No real request in mock mode') }, session, () => {}, { mock: true }), true)
  assert.equal(session.get(), null)
})

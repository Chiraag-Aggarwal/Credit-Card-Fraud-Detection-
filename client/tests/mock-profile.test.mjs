import assert from 'node:assert/strict'
import { test } from 'node:test'

const stored = new Map()
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
}

let moduleSequence = 0
async function freshAdapter() {
  return (await import(`../src/mocks/mockApi.js?profile-test=${++moduleSequence}`)).default
}

function request(adapter, method, url, body, token) {
  return adapter({ method, url, data: body ? JSON.stringify(body) : undefined, headers: token ? { Authorization: `Bearer ${token}` } : {} })
}

async function register(adapter, email = 'merchant@example.com') {
  const response = await request(adapter, 'post', '/api/auth/register', { name: 'Demo Merchant', email, password: 'demo-password' })
  return response.data
}

test('mock mode never pretends to provide real recovery or session security', async () => {
  stored.clear()
  const adapter = await freshAdapter()
  for (const endpoint of ['recover', 'security', 'recovery-codes', 'change-password', 'logout', 'logout-all']) {
    await assert.rejects(request(adapter, endpoint === 'security' ? 'get' : 'post', '/api/auth/' + endpoint, { currentPassword: 'must-not-store', recoveryCode: 'must-not-store' }), (error) => error.response.status === 503 && error.response.data.error.code === 'SECURITY_UNAVAILABLE_IN_MOCK')
  }
  assert.doesNotMatch([...stored.values()].join(''), /must-not-store/)
})

test('mock profile retains its stable identity, new email, and name after a reload', async () => {
  stored.clear()
  const adapter = await freshAdapter()
  const session = await register(adapter)
  const response = await request(adapter, 'patch', '/api/auth/me', { name: '  Updated Name ', email: 'NEW@EXAMPLE.COM' }, session.token)
  assert.deepEqual(response.data.user, { ...session.user, name: 'Updated Name', email: 'new@example.com' })
  const reloaded = await freshAdapter()
  const current = await request(reloaded, 'get', '/api/auth/me', undefined, session.token)
  assert.deepEqual(current.data.user, response.data.user)
  const login = await request(reloaded, 'post', '/api/auth/login', { email: 'new@example.com', password: 'anything-long' })
  assert.equal(login.data.user.id, session.user.id)
  assert.equal(login.data.user.name, 'Updated Name')
  assert.doesNotMatch([...stored.values()].join(''), /demo-password|anything-long/)
})

test('duplicate emails and privileged fields cannot change another demo account', async () => {
  stored.clear()
  const adapter = await freshAdapter()
  const first = await register(adapter)
  const second = await register(adapter, 'other@example.com')
  await assert.rejects(request(adapter, 'patch', '/api/auth/me', { name: 'Changed', email: second.user.email }, first.token), (error) => error.response.status === 409)
  for (const field of ['id', 'role', 'password']) {
    await assert.rejects(request(adapter, 'patch', '/api/auth/me', { name: 'Changed', email: 'new@example.com', [field]: 'forbidden' }, first.token), (error) => error.response.status === 422)
  }
  assert.deepEqual((await request(adapter, 'get', '/api/auth/me', undefined, second.token)).data.user, second.user)
  assert.deepEqual((await request(adapter, 'get', '/api/auth/me', undefined, first.token)).data.user, first.user)
})

test('mock profile requires authentication and valid fields', async () => {
  stored.clear()
  const adapter = await freshAdapter()
  const session = await register(adapter)
  await assert.rejects(request(adapter, 'patch', '/api/auth/me', { name: 'Updated', email: 'new@example.com' }), (error) => error.response.status === 401)
  for (const body of [{ name: '', email: 'valid@example.com' }, { name: 'Valid', email: 'invalid' }, { name: 'x'.repeat(121), email: 'valid@example.com' }, { name: 'Valid' }]) {
    await assert.rejects(request(adapter, 'patch', '/api/auth/me', body, session.token), (error) => error.response.status === 422)
  }
})

test('older mock email tokens still resolve the edited profile after refresh', async () => {
  stored.clear()
  const adapter = await freshAdapter()
  const token = 'mock-token-' + encodeURIComponent('legacy@example.com')
  const original = (await request(adapter, 'get', '/api/auth/me', undefined, token)).data.user
  await request(adapter, 'patch', '/api/auth/me', { name: 'Legacy Updated', email: 'edited@example.com' }, token)
  const reloaded = await freshAdapter()
  const current = (await request(reloaded, 'get', '/api/auth/me', undefined, token)).data.user
  assert.equal(current.id, original.id)
  assert.equal(current.name, 'Legacy Updated')
  assert.equal(current.email, 'edited@example.com')
})

test('demo checkout accepts the dashboard INR payload and returns no real checkout URL', async () => {
  stored.clear()
  const adapter = await freshAdapter()
  const session = await register(adapter)
  const response = await request(adapter, 'post', '/api/payments/checkout-session', { amount: 1, currency: 'inr', mode: 'normal' }, session.token)
  assert.equal(response.status, 200)
  assert.deepEqual(response.data, { url: '/' })
  const status = await request(adapter, 'get', '/api/payments/status', undefined, session.token)
  assert.equal(status.data.enabled, false)
  assert.equal(status.data.mode, 'disabled')
  await assert.rejects(request(adapter, 'get', '/api/payments/status'), (error) => error.response.status === 401)
})

test('mock review decisions keep flagged filtering and unread counts consistent', async () => {
  stored.clear()
  const adapter = await freshAdapter()
  const session = await register(adapter)
  const before = await request(adapter, 'get', '/api/alerts/unread-count', undefined, session.token)
  const queue = await request(adapter, 'get', '/api/transactions?flagged=true&limit=100', undefined, session.token)
  const item = queue.data.items.find((transaction) => !transaction.reviewDecision)
  const reviewed = await request(adapter, 'patch', `/api/transactions/${item.id}/review`, { decision: 'legit' }, session.token)
  assert.equal(reviewed.data.isFlagged, false)
  const after = await request(adapter, 'get', '/api/transactions?flagged=true&limit=100', undefined, session.token)
  assert.equal(after.data.items.some((transaction) => transaction.id === item.id), false)
  assert.equal((await request(adapter, 'get', '/api/alerts/unread-count', undefined, session.token)).data.count, before.data.count - 1)
  const confirmed = await request(adapter, 'patch', `/api/transactions/${item.id}/review`, { decision: 'confirmed_fraud' }, session.token)
  assert.equal(confirmed.data.isFlagged, true)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createAuthSessionStore, shouldExpireSession, usesAccountSession } from '../src/utils/authSession.js'
import { createCheckoutSessionStore, captureCheckoutLocation } from '../src/utils/checkoutSession.js'
import { normalizePaymentStatus } from '../src/utils/paymentStatus.js'
import { scoringReasonText, sourceText } from '../src/utils/transactionDisplay.js'
import { passwordValidation } from '../src/utils/passwordValidation.js'

function storageFixture() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}

test('mock and real sign-ins cannot consume or erase one another', () => {
  const storage = storageFixture()
  const mock = createAuthSessionStore(true, () => storage)
  const real = createAuthSessionStore(false, () => storage)
  mock.set('mock-token')
  assert.equal(real.get(), null)
  real.set('real-token')
  mock.clear()
  assert.equal(real.get(), 'real-token')
  assert.equal(createAuthSessionStore(false, () => storage).get(), 'real-token')
})

test('blocked storage and write-only failures still allow sign-in and sign-out', () => {
  for (const getStorage of [
    () => { throw new Error('Storage blocked') },
    () => ({ getItem: () => 'old-session', setItem: () => { throw new Error('Quota exceeded') }, removeItem: () => { throw new Error('Blocked') } }),
  ]) {
    const session = createAuthSessionStore(false, getStorage)
    session.set('new-session')
    assert.equal(session.get(), 'new-session')
    session.clear()
    assert.equal(session.get(), null)
  }
})

test('only a 401 from the current account session expires sign-in', () => {
  const error = { response: { status: 401 }, config: { url: '/api/transactions', accountSessionToken: 'current' } }
  assert.equal(shouldExpireSession(error, 'current'), true)
  assert.equal(shouldExpireSession(error, 'newer-session'), false)
  assert.equal(shouldExpireSession(error, null), false)
  for (const url of ['/api/auth/login', '/api/auth/register', '/api/payments/verify']) {
    assert.equal(usesAccountSession({ url }), false)
    assert.equal(usesAccountSession({ url, baseURL: '/backend' }), false)
    assert.equal(shouldExpireSession({ ...error, config: { ...error.config, url } }, 'current'), false)
  }
  assert.equal(shouldExpireSession({ ...error, response: { status: 403 } }, 'current'), false)
})

const origin = 'https://merchant.example'
const checkout = `${origin}/checkout?order_id=order_123&key_id=rzp_test_example&amount=100&currency=INR&mode=test&session_token=secret-checkout-token`

test('checkout stores its bearer token per order and refresh restores it without URL exposure', () => {
  const storage = storageFixture()
  const sessions = createCheckoutSessionStore(() => storage)
  const clean = sessions.prepare(checkout, origin)
  assert.equal(clean, '/checkout?order_id=order_123')
  assert.doesNotMatch(clean, /secret|session_token|key_id/)
  const restored = createCheckoutSessionStore(() => storage).read('order_123')
  assert.equal(restored.sessionToken, 'secret-checkout-token')
  assert.equal(restored.mode, 'test')
  assert.equal(sessions.read('order_another'), null)
  sessions.clear('order_123')
  assert.equal(createCheckoutSessionStore(() => storage).read('order_123'), null)
})

test('checkout accepts live mode only with a matching live key and rejects other destinations', () => {
  const sessions = createCheckoutSessionStore(() => storageFixture())
  const live = checkout.replace('rzp_test_', 'rzp_live_').replace('mode=test', 'mode=live')
  sessions.prepare(live, origin)
  assert.equal(sessions.read('order_123').mode, 'live')
  sessions.prepare(checkout.replace('&mode=test', ''), origin)
  assert.equal(sessions.read('order_123').mode, 'test')
  for (const target of [checkout.replace(origin, 'https://other.example'), checkout.replace('/checkout?', '/login?'), checkout.replace('mode=test', 'mode=live'), checkout.replace('amount=100', 'amount=-100'), checkout.replace('session_token=secret-checkout-token', 'session_token=')]) {
    assert.throws(() => sessions.prepare(target, origin))
  }
})

test('direct checkout links replace browser history before checkout loads, even for invalid links', () => {
  const sessions = createCheckoutSessionStore(() => storageFixture())
  for (const href of [checkout, checkout.replace('amount=100', 'amount=bad')]) {
    let replaced = ''
    const browser = { location: { href, pathname: '/checkout' }, history: { state: { existing: true }, replaceState: (state, title, url) => { assert.deepEqual(state, { existing: true }); replaced = url } } }
    captureCheckoutLocation(browser, sessions)
    assert.doesNotMatch(replaced, /secret|session_token/)
    assert.ok(replaced.startsWith('/checkout'))
  }
})

test('checkout survives blocked storage within the current tab and rejects corrupt saved sessions', () => {
  const sessions = createCheckoutSessionStore(() => { throw new Error('Storage blocked') })
  assert.equal(sessions.prepare(checkout, origin), '/checkout?order_id=order_123')
  assert.equal(sessions.read('order_123').sessionToken, 'secret-checkout-token')
  assert.equal(createCheckoutSessionStore(() => ({ getItem: () => '{broken' })).read('order_123'), null)
})

test('unavailable or malformed payment status cannot enable checkout', () => {
  for (const response of [null, {}, { provider: 'razorpay', mode: 'disabled', enabled: true }, { provider: 'razorpay', mode: 'test', enabled: false }, { provider: 'razorpay', mode: 'test', enabled: 'true' }]) {
    assert.equal(normalizePaymentStatus(response).enabled, false)
  }
  for (const mode of ['test', 'live']) assert.equal(normalizePaymentStatus({ provider: 'razorpay', mode, enabled: true }).mode, mode)
})

test('review copy distinguishes a model outage from unsupported payment data in both languages', () => {
  const pending = { scoringStatus: 'pending_review' }
  const english = (en) => en
  const hindi = (en, hi) => hi
  assert.match(scoringReasonText({ ...pending, scoringReason: 'model_unavailable' }, english), /Model unavailable/)
  assert.match(scoringReasonText({ ...pending, scoringReason: 'unsupported_payment_features' }, english), /cannot be scored/)
  assert.doesNotMatch(scoringReasonText(pending, english), /unavailable/)
  assert.match(scoringReasonText({ ...pending, scoringReason: 'unsupported_payment_features' }, hindi), /मैन्युअल समीक्षा/)
  assert.equal(scoringReasonText({ scoringStatus: 'scored' }, english), '')
  assert.equal(sourceText('razorpay', english, 'test'), 'Razorpay (test)')
  assert.equal(sourceText('razorpay', english, 'live'), 'Razorpay (live)')
})

test('password bounds count Unicode characters and UTF-8 bytes without trimming', () => {
  assert.equal(passwordValidation('😀'.repeat(4)), 'too_short')
  assert.equal(passwordValidation('😀'.repeat(8)), null)
  assert.equal(passwordValidation('😀'.repeat(19)), 'too_long')
  assert.equal(passwordValidation('x'.repeat(72)), null)
  assert.equal(passwordValidation('x'.repeat(73)), 'too_long')
  assert.equal(passwordValidation(' '.repeat(8)), null)
})

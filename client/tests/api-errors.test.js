import test from 'node:test'
import assert from 'node:assert/strict'
import { formatApiError } from '../src/utils/apiErrors.js'

test('rate limit guidance preserves retry delay in both languages', () => {
  const error = { response: { status: 429, headers: { 'retry-after': '37' } } }
  assert.match(formatApiError(error, 'Fallback'), /37 seconds/)
  assert.match(formatApiError(error, 'फिर कोशिश करें', 'hi'), /37 सेकंड/)
})
test('profile conflicts and validation errors are translated, English API detail is preserved', () => {
  const error = { response: { status: 409, data: { error: { code: 'EMAIL_EXISTS', message: 'This email is already in use.' } } } }
  assert.equal(formatApiError(error, 'Fallback'), 'This email is already in use.')
  assert.match(formatApiError(error, 'फिर कोशिश करें', 'hi'), /दूसरा ईमेल/)
  assert.equal(formatApiError(new Error('Network failure'), 'Try again'), 'Try again')
})

test('a displayed API error can switch languages without changing the error or making another request', () => {
  const error = { response: { status: 401, data: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } } } }
  assert.equal(formatApiError(error, 'Try again', 'en'), 'Invalid email or password.')
  assert.match(formatApiError(error, 'फिर कोशिश करें', 'hi'), /ईमेल या पासवर्ड/)
  assert.equal(formatApiError(error, 'Try again', 'en'), 'Invalid email or password.')
  assert.equal(error.response.data.error.message, 'Invalid email or password.')
})

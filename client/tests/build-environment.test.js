import assert from 'node:assert/strict'
import test from 'node:test'
import { validateBuildEnvironment } from '../config/validateEnvironment.js'

test('real builds require an API origin; demo builds must opt in explicitly', () => {
  for (const env of [{}, { VITE_USE_MOCK: 'false' }, { VITE_API_URL: '   ' }]) {
    assert.throws(() => validateBuildEnvironment(env), /VITE_API_URL is required/)
  }
  assert.doesNotThrow(() => validateBuildEnvironment({ VITE_USE_MOCK: 'true' }))
  assert.throws(() => validateBuildEnvironment({ VITE_USE_MOCK: 'TRUE' }), /VITE_USE_MOCK must be/)
})

test('HTTPS deployment origins and local HTTP test origins build successfully', () => {
  for (const url of ['https://merchant-api.onrender.com', 'https://api.example.com/', 'http://localhost:5000', 'http://127.0.0.1:5018', 'http://[::1]:5000']) {
    assert.doesNotThrow(() => validateBuildEnvironment({ VITE_API_URL: url, VITE_USE_MOCK: 'false' }))
  }
})

test('public HTTP, relative paths, and misleading loopback names cannot build', () => {
  for (const url of ['http://api.example.com', 'http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'http://0.0.0.0:5000', 'ftp://api.example.com', '/api', 'api.example.com']) {
    assert.throws(() => validateBuildEnvironment({ VITE_API_URL: url }), /VITE_API_URL must/)
  }
})

test('API paths and credentials are rejected without exposing their values', () => {
  for (const url of ['https://api.example.com/api', 'https://api.example.com?token=secret', 'https://api.example.com/#fragment', 'https://user:secret@api.example.com']) {
    assert.throws(() => validateBuildEnvironment({ VITE_API_URL: url }), (error) => {
      assert.match(error.message, /VITE_API_URL must contain only the backend origin/)
      assert.doesNotMatch(error.message, /secret/)
      return true
    })
  }
})

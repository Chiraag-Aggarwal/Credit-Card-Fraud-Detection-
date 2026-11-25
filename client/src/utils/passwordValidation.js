export function passwordValidation(password) {
  if (Array.from(password).length < 8) return 'too_short'
  if (new TextEncoder().encode(password).length > 72) return 'too_long'
  return null
}

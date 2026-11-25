export function normalizePaymentStatus(data) {
  const enabled = data?.provider === 'razorpay' && data.enabled === true && ['test', 'live'].includes(data.mode)
  return {
    provider: 'razorpay', enabled, mode: enabled ? data.mode : 'disabled',
    reason: typeof data?.reason === 'string' ? data.reason : null,
  }
}

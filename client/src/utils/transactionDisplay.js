export function riskText(risk, t) {
  return ({ LOW: t('LOW', 'कम'), MEDIUM: t('MEDIUM', 'मध्यम'), HIGH: t('HIGH', 'उच्च'), UNSCORED: t('UNSCORED', 'स्कोर नहीं') })[risk] || t('UNSCORED', 'स्कोर नहीं')
}
export function formatTime(value, locale) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
export function formatAmount(amount, currency, locale) {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(amount) }
  catch { return Number(amount || 0).toFixed(2) + ' ' + String(currency || 'usd').toUpperCase() }
}
export function formatProbability(value, locale) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)
}
export function sourceText(source, t) {
  if (source === 'razorpay') return 'Razorpay'
  if (source === 'stripe') return t('Stripe (legacy)', 'Stripe (पुराना)')
  return t('Simulated', 'सिमुलेटेड')
}
export function statusText(status, t) {
  return status === 'pending_review' ? t('Pending review', 'समीक्षा बाकी') : t('Scored', 'स्कोर किया गया')
}

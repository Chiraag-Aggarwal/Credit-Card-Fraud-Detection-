const hindiMessages = {
  EMAIL_EXISTS: 'इस ईमेल से खाता पहले से मौजूद है। दूसरा ईमेल इस्तेमाल करें।',
  INVALID_CREDENTIALS: 'ईमेल या पासवर्ड सही नहीं है। फिर से जाँचें।',
  UNAUTHORIZED: 'कृपया दोबारा साइन इन करें।',
  VALIDATION_ERROR: 'दी गई जानकारी सही नहीं है। फ़ॉर्म के सभी फ़ील्ड जाँचें।',
  ML_UNAVAILABLE: 'मॉडल सेवा अभी उपलब्ध नहीं है। थोड़ी देर बाद फिर कोशिश करें।',
  NOT_FOUND: 'यह लेनदेन नहीं मिला। सूची फिर से लोड करें।',
  NOT_SCORED: 'इस लेनदेन का मॉडल स्कोर नहीं है, इसलिए कारण नहीं दिखाए जा सकते।',
  PAYMENTS_UNAVAILABLE: 'टेस्ट भुगतान की सेवा अभी तैयार नहीं है।',
  LIVE_PAYMENTS_DISABLED: 'इस डेमो में असली भुगतान बंद हैं।',
  PAYMENT_PROVIDER_ERROR: 'भुगतान सेवा से जवाब नहीं मिला। दोबारा भुगतान करने से पहले डैशबोर्ड जाँचें।',
  INVALID_CHECKOUT_SESSION: 'भुगतान लिंक अमान्य है या उसकी समय सीमा समाप्त हो गई है। नया टेस्ट भुगतान शुरू करें।',
  CHECKOUT_EXPIRED: 'भुगतान लिंक की समय सीमा समाप्त हो गई है। नया भुगतान शुरू करें।',
  INVALID_PAYMENT_SIGNATURE: 'भुगतान की पुष्टि नहीं हो सकी। डैशबोर्ड जाँचें।',
  INVALID_PAYMENT: 'यह भुगतान दिए गए ऑर्डर का नहीं है।',
  PAYMENT_NOT_CAPTURED: 'भुगतान की पुष्टि अभी बाकी है। दोबारा भुगतान करने से पहले डैशबोर्ड जाँचें।',
  PAYMENT_MISMATCH: 'भुगतान की जानकारी ऑर्डर से मेल नहीं खाती।',
}

export function formatApiError(error, fallback, language = 'en') {
  const hindi = language === 'hi'
  const status = error?.response?.status
  if (status === 429) {
    const retryAfter = Number(error.response.headers?.['retry-after'])
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return hindi ? `बहुत ज़्यादा अनुरोध किए गए हैं। ${retryAfter} सेकंड बाद फिर कोशिश करें।` : `Too many requests. Please wait ${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'}, then try again.`
    }
    return hindi ? 'बहुत ज़्यादा अनुरोध किए गए हैं। थोड़ी देर बाद फिर कोशिश करें।' : 'Too many requests. Please wait a moment, then try again.'
  }
  const body = error?.response?.data?.error
  if (hindi && body) {
    if (hindiMessages[body.code]) return hindiMessages[body.code]
    if (status === 422 || status === 400) return hindiMessages.VALIDATION_ERROR
    if (status === 401) return hindiMessages.UNAUTHORIZED
    if (status === 403) return 'आपको यह काम करने की अनुमति नहीं है।'
    if (status === 409) return 'यह बदलाव अभी सेव नहीं हो सका। जानकारी जाँचकर फिर कोशिश करें।'
    if (status >= 500) return 'सेवा अभी उपलब्ध नहीं है। थोड़ी देर बाद फिर कोशिश करें।'
    return fallback
  }
  return typeof body?.message === 'string' && body.message ? body.message : fallback
}

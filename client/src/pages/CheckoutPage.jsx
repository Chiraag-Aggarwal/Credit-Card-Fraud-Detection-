import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import apiClient, { getApiErrorMessage } from '../api/client'
import Icon from '../components/Icon'
import QuickPreferences from '../components/QuickPreferences'
import { usePreferences } from '../context/PreferencesContext'

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true)
      return
    }
    const existing = document.querySelector(`script[src="${CHECKOUT_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = CHECKOUT_SCRIPT
    script.onload = () => resolve(true)
    script.onerror = () => {
      script.remove()
      resolve(false)
    }
    document.body.appendChild(script)
  })
}

export default function CheckoutPage() {
  const { t, locale, language } = usePreferences()
  const [params] = useSearchParams()
  const [scriptReady, setScriptReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [paid, setPaid] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const orderId = params.get('order_id')
  const keyId = params.get('key_id')
  const amount = Number(params.get('amount'))
  const currency = params.get('currency') || 'INR'
  const sessionToken = params.get('session_token')
  const validSession = Boolean(orderId && keyId && sessionToken && Number.isFinite(amount) && amount > 0)

  useEffect(() => {
    let mounted = true
    loadRazorpayScript().then((ready) => {
      if (mounted) {
        setScriptReady(ready)
        setIsLoading(false)
      }
    })
    return () => { mounted = false }
  }, [])

  function openCheckout() {
    if (!validSession || !scriptReady || busy) return
    setBusy(true)
    setError(null)
    try {
      const checkout = new window.Razorpay({
        key: keyId,
        order_id: orderId,
        amount,
        currency,
        name: 'Fraud Detection Demo',
        description: 'Razorpay test payment',
        theme: { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c3aed' },
        handler: async (response) => {
          try {
            await apiClient.post('/api/payments/verify', {
              sessionToken,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature,
            })
            setPaid(true)
          } catch (verificationError) {
            setError({ kind: 'verification', cause: verificationError })
          } finally {
            setBusy(false)
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      })
      checkout.on('payment.failed', (event) => {
        setError({ kind: 'provider', message: event.error?.description })
        setBusy(false)
      })
      checkout.open()
    } catch {
      setError({ kind: 'launch' })
      setBusy(false)
    }
  }

  let formattedAmount = '—'
  if (Number.isFinite(amount) && amount > 0) {
    try {
      formattedAmount = new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100)
    } catch {
      formattedAmount = `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`
    }
  }
  const errorMessage = error?.kind === 'verification'
    ? getApiErrorMessage(error.cause, t('We could not confirm this payment. Please check the dashboard before retrying.', 'भुगतान की पुष्टि नहीं हो सकी। फिर कोशिश करने से पहले डैशबोर्ड जाँचें।'), language)
    : error?.kind === 'provider'
      ? t(error.message || 'The test payment did not complete. You can try again.', 'टेस्ट भुगतान पूरा नहीं हुआ। आप फिर कोशिश कर सकते हैं।')
      : error ? t('Checkout could not open. Refresh this page and try again.', 'भुगतान की विंडो नहीं खुल सकी। पेज रीफ़्रेश करके फिर कोशिश करें।') : ''

  return (
    <main className="auth-page">
      <div className="auth-toolbar flex flex-wrap items-center justify-between gap-4">
        <Link className="flex items-center gap-3 font-bold" to="/"><Icon name="shield" size={28} />{t('Fraud Detection', 'धोखाधड़ी की पहचान')}</Link>
        <QuickPreferences />
      </div>
      <section className="ui-card checkout-card mx-auto w-full max-w-xl p-6 sm:p-9">
        <span className="accent-icon mb-5 inline-flex"><Icon name={paid ? 'check' : 'lock'} size={28} /></span>
        <p className="eyebrow">{t('Razorpay test checkout', 'Razorpay टेस्ट भुगतान')}</p>
        <h1 className="mt-2 text-3xl font-bold">{paid ? t('Test payment confirmed', 'टेस्ट भुगतान की पुष्टि हो गई') : t('Complete demo payment', 'डेमो भुगतान पूरा करें')}</h1>
        {paid ? (
          <div aria-live="polite" className="mt-4 space-y-5" role="status">
            <p className="text-muted text-sm leading-relaxed">{t('Razorpay confirmed the test payment. The backend has sent the transaction to the fraud model.', 'Razorpay ने टेस्ट भुगतान की पुष्टि कर दी। बैकएंड ने लेन-देन को धोखाधड़ी जाँचने वाले मॉडल तक भेज दिया है।')}</p>
            <Link className="ui-button ui-button-primary w-full" to="/">{t('Return to dashboard', 'डैशबोर्ड पर वापस जाएँ')}<Icon name="arrow" size={18} /></Link>
          </div>
        ) : (
          <>
            <div className="checkout-total my-6 rounded-2xl border p-5" style={{ borderColor: 'var(--border)' }}>
              <p className="text-muted text-sm">{t('Amount', 'राशि')}</p>
              <p className="mt-1 text-3xl font-bold">{formattedAmount}</p>
              <p className="text-muted mt-3 text-xs leading-relaxed">{t('Test mode simulates a payment. No real money is moved.', 'टेस्ट मोड में भुगतान का अभ्यास होता है। असली पैसे नहीं कटते।')}</p>
            </div>
            {!validSession && <p className="status-error mt-4 text-sm" role="alert">{t('This checkout link is incomplete or expired. Return to the dashboard and start again.', 'यह भुगतान लिंक अधूरा है या इसकी अवधि समाप्त हो गई है। डैशबोर्ड से फिर शुरू करें।')}</p>}
            {isLoading && <p className="text-muted mt-5 text-sm" role="status">{t('Loading Razorpay checkout…', 'Razorpay भुगतान लोड हो रहा है…')}</p>}
            {!isLoading && !scriptReady && <p className="status-notice mt-5 text-sm" role="alert">{t('Razorpay checkout could not load. Check your internet connection and refresh this page.', 'Razorpay भुगतान लोड नहीं हो सका। इंटरनेट जाँचें और पेज रीफ़्रेश करें।')}</p>}
            {errorMessage && <p className="status-error mt-5 text-sm" role="alert">{errorMessage}</p>}
            <button className="ui-button ui-button-primary mt-6 w-full" disabled={!validSession || !scriptReady || busy} onClick={openCheckout} type="button">
              <Icon name="lock" size={18} />{busy ? t('Waiting for payment…', 'भुगतान का इंतज़ार है…') : t('Continue to secure test checkout', 'सुरक्षित टेस्ट भुगतान पर जाएँ')}
            </button>
            <Link className="text-muted mt-5 block text-center text-sm font-medium underline underline-offset-4" to="/">{t('Cancel and return', 'रद्द करें और वापस जाएँ')}</Link>
          </>
        )}
      </section>
    </main>
  )
}

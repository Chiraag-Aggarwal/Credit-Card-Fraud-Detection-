import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import FormField from '../components/FormField'
import Icon from '../components/Icon'
import { getApiErrorMessage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../context/PreferencesContext'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  const { login } = useAuth()
  const { t, language } = usePreferences()
  const location = useLocation()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: '' }))
    setServerError(null)
  }

  function validate() {
    const nextErrors = {}
    const email = form.email.trim()
    if (!email) nextErrors.email = ['Enter your email address.', 'अपना ईमेल पता लिखें।']
    else if (!emailPattern.test(email)) nextErrors.email = ['Enter a valid email address.', 'सही ईमेल पता लिखें।']
    if (!form.password) nextErrors.password = ['Enter your password.', 'अपना पासवर्ड लिखें।']
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setServerError(null)
    if (!validate()) return
    setSubmitting(true)
    try {
      await login({ email: form.email.trim(), password: form.password })
      const destination = location.state?.from?.pathname || '/'
      navigate(destination, { replace: true })
    } catch (error) {
      setServerError(error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <p className="eyebrow">{t('Welcome back', 'फिर से स्वागत है')}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight">{t('Sign in', 'लॉगिन करें')}</h2>
      <p className="text-muted mt-3 text-sm leading-relaxed">{t('Enter your account details to open your dashboard.', 'डैशबोर्ड खोलने के लिए अपने खाते की जानकारी लिखें।')}</p>
      <form aria-busy={submitting} className="mt-7 space-y-5" noValidate onSubmit={handleSubmit}>
        {serverError && <p aria-live="polite" className="status-error" role="alert">{getApiErrorMessage(serverError, t('We could not sign you in. Check your details and try again.', 'लॉगिन नहीं हो सका। अपनी जानकारी जाँचकर फिर कोशिश करें।'), language)}</p>}
        <FormField autoComplete="email" error={errors.email && t(...errors.email)} id="email" label={t('Email address', 'ईमेल पता')} onChange={updateField} placeholder="you@example.com" type="email" value={form.email} />
        <FormField autoComplete="current-password" error={errors.password && t(...errors.password)} id="password" label={t('Password', 'पासवर्ड')} onChange={updateField} placeholder={t('Your password', 'अपना पासवर्ड')} type="password" value={form.password} />
        <button className="ui-button ui-button-primary w-full" disabled={submitting} type="submit">{submitting ? t('Signing in…', 'लॉगिन हो रहा है…') : t('Sign in', 'लॉगिन करें')}<Icon name="arrow" size={18} /></button>
      </form>
      <p className="text-muted mt-6 text-sm">{t('New to the dashboard?', 'पहली बार आए हैं?')}{' '}<Link className="font-semibold underline underline-offset-4" to="/register">{t('Create an account', 'नया खाता बनाएँ')}</Link></p>
    </AuthShell>
  )
}

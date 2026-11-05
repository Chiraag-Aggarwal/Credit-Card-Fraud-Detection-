import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import FormField from '../components/FormField'
import Icon from '../components/Icon'
import { getApiErrorMessage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../context/PreferencesContext'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function RegisterPage() {
  const { register } = useAuth()
  const { t, language } = usePreferences()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' })
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
    if (!form.name.trim()) nextErrors.name = ['Enter your name.', 'अपना नाम लिखें।']
    if (!email) nextErrors.email = ['Enter your email address.', 'अपना ईमेल पता लिखें।']
    else if (!emailPattern.test(email)) nextErrors.email = ['Enter a valid email address.', 'सही ईमेल पता लिखें।']
    if (!form.password) nextErrors.password = ['Create a password.', 'पासवर्ड बनाएँ।']
    else if (form.password.length < 8) nextErrors.password = ['Use at least 8 characters.', 'कम से कम 8 अक्षर या अंक लिखें।']
    if (!form.confirmPassword) nextErrors.confirmPassword = ['Confirm your password.', 'पासवर्ड फिर से लिखें।']
    else if (form.confirmPassword !== form.password) nextErrors.confirmPassword = ['The passwords do not match.', 'दोनों पासवर्ड एक जैसे नहीं हैं।']
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setServerError(null)
    if (!validate()) return
    setSubmitting(true)
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password })
      navigate('/', { replace: true })
    } catch (error) {
      setServerError(error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <p className="eyebrow">{t('Get started', 'शुरुआत करें')}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight">{t('Create your account', 'अपना खाता बनाएँ')}</h2>
      <p className="text-muted mt-3 text-sm leading-relaxed">{t('Your workspace for understanding payment risk.', 'भुगतान से जुड़े जोखिम समझने के लिए आपका कार्यक्षेत्र।')}</p>
      <form aria-busy={submitting} className="mt-7 space-y-4" noValidate onSubmit={handleSubmit}>
        {serverError && <p aria-live="polite" className="status-error" role="alert">{getApiErrorMessage(serverError, t('We could not create your account. Please try again.', 'आपका खाता नहीं बन सका। कृपया फिर कोशिश करें।'), language)}</p>}
        <FormField autoComplete="name" error={errors.name && t(...errors.name)} id="name" label={t('Full name', 'पूरा नाम')} onChange={updateField} placeholder={t('Your name', 'आपका नाम')} value={form.name} />
        <FormField autoComplete="email" error={errors.email && t(...errors.email)} id="email" label={t('Email address', 'ईमेल पता')} onChange={updateField} placeholder="you@example.com" type="email" value={form.email} />
        <FormField autoComplete="new-password" error={errors.password && t(...errors.password)} id="password" label={t('Password', 'पासवर्ड')} minLength={8} onChange={updateField} placeholder={t('At least 8 characters', 'कम से कम 8 अक्षर या अंक')} type="password" value={form.password} />
        <FormField autoComplete="new-password" error={errors.confirmPassword && t(...errors.confirmPassword)} id="confirmPassword" label={t('Confirm password', 'पासवर्ड फिर लिखें')} onChange={updateField} placeholder={t('Enter your password again', 'अपना पासवर्ड फिर से लिखें')} type="password" value={form.confirmPassword} />
        <button className="ui-button ui-button-primary w-full" disabled={submitting} type="submit">{submitting ? t('Creating account…', 'खाता बन रहा है…') : t('Create account', 'खाता बनाएँ')}<Icon name="arrow" size={18} /></button>
      </form>
      <p className="text-muted mt-6 text-sm">{t('Already registered?', 'पहले से खाता है?')}{' '}<Link className="font-semibold underline underline-offset-4" to="/login">{t('Sign in', 'लॉगिन करें')}</Link></p>
    </AuthShell>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import apiClient, { getApiErrorMessage, isMockMode } from '../api/client'
import AuthShell from '../components/AuthShell'
import FormField from '../components/FormField'
import SlowRequestHint from '../components/SlowRequestHint'
import { usePreferences } from '../context/PreferencesContext'
import { passwordValidation } from '../utils/passwordValidation'

export default function RecoverAccountPage() {
  const { t, language } = usePreferences()
  const [form, setForm] = useState({ email: '', recoveryCode: '', newPassword: '', confirmPassword: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)

  function edit(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: null }))
    setServerError(null)
  }

  async function resetPassword(event) {
    event.preventDefault()
    const next = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = ['Enter a valid email address.', 'सही ईमेल पता लिखें।']
    if (!form.recoveryCode.trim()) next.recoveryCode = ['Enter one of your saved recovery codes.', 'अपने सुरक्षित रखे रिकवरी कोड में से एक लिखें।']
    const passwordError = passwordValidation(form.newPassword)
    if (passwordError) next.newPassword = passwordError === 'too_short' ? ['Use at least 8 characters.', 'कम से कम 8 अक्षर या अंक लिखें।'] : ['Use a shorter password (maximum 72 UTF-8 bytes).', 'छोटा पासवर्ड लिखें (अधिकतम 72 UTF-8 बाइट)।']
    if (form.newPassword !== form.confirmPassword || !form.confirmPassword) next.confirmPassword = ['The passwords do not match.', 'दोनों पासवर्ड एक जैसे नहीं हैं।']
    setErrors(next)
    setServerError(null)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await apiClient.post('/api/auth/recover', { email: form.email.trim(), recoveryCode: form.recoveryCode.trim(), newPassword: form.newPassword })
      setForm({ email: '', recoveryCode: '', newPassword: '', confirmPassword: '' })
      setComplete(true)
    } catch (error) {
      setServerError(error)
    } finally {
      setBusy(false)
    }
  }

  return <AuthShell>
    <p className="eyebrow">{t('Account recovery', 'खाता वापस पाएँ')}</p>
    <h2 className="mt-2 text-3xl font-bold tracking-tight">{t('Reset your password', 'पासवर्ड रीसेट करें')}</h2>
    {isMockMode ? <p className="status-notice mt-5">{t('Password recovery is available for real accounts only. Mock sign-in does not use a saved password.', 'पासवर्ड रिकवरी केवल असली खातों के लिए है। डेमो लॉगिन में सेव किया हुआ पासवर्ड उपयोग नहीं होता।')}</p> : complete ? <div className="mt-6 space-y-4">
      <p className="status-success" role="status">{t('Your password has been reset. All previous sessions are signed out. Sign in with your new password.', 'आपका पासवर्ड रीसेट हो गया है। सभी पुराने सेशन लॉग आउट हो गए हैं। नए पासवर्ड से लॉगिन करें।')}</p>
      <p className="text-muted text-sm">{t('The recovery code you used no longer works. Keep your remaining codes safe, or generate a new set in My profile.', 'उपयोग किया गया रिकवरी कोड अब काम नहीं करेगा। बाकी कोड सुरक्षित रखें या मेरी प्रोफ़ाइल में नया सेट बनाएँ।')}</p>
    </div> : <>
      <p className="text-muted mt-3 text-sm leading-6">{t('Enter your sign-in email and one unused recovery code. No email will be sent.', 'अपना लॉगिन ईमेल और एक ऐसा रिकवरी कोड लिखें जिसका अभी उपयोग नहीं हुआ है। कोई ईमेल नहीं भेजा जाएगा।')}</p>
      <form className="mt-6 space-y-4" onSubmit={resetPassword} noValidate aria-busy={busy}>
        {serverError && <p className="status-error" role="alert">{getApiErrorMessage(serverError, t('Could not reset your password. Check your connection and try again.', 'पासवर्ड रीसेट नहीं हो सका। इंटरनेट जाँचकर फिर कोशिश करें।'), language)}</p>}
        <fieldset disabled={busy} className="space-y-4">
          <FormField id="email" label={t('Email address', 'ईमेल पता')} autoComplete="email" type="email" value={form.email} onChange={edit} error={errors.email && t(...errors.email)} />
          <FormField id="recoveryCode" label={t('Recovery code', 'रिकवरी कोड')} autoComplete="off" value={form.recoveryCode} onChange={edit} error={errors.recoveryCode && t(...errors.recoveryCode)} />
          <FormField id="newPassword" label={t('New password', 'नया पासवर्ड')} autoComplete="new-password" type="password" value={form.newPassword} onChange={edit} error={errors.newPassword && t(...errors.newPassword)} />
          <FormField id="confirmPassword" label={t('Confirm new password', 'नया पासवर्ड फिर लिखें')} autoComplete="new-password" type="password" value={form.confirmPassword} onChange={edit} error={errors.confirmPassword && t(...errors.confirmPassword)} />
          <button className="ui-button ui-button-primary w-full" type="submit">{busy ? t('Resetting…', 'रीसेट हो रहा है…') : t('Reset password', 'पासवर्ड रीसेट करें')}</button>
        </fieldset>
        <SlowRequestHint busy={busy} />
      </form>
      <p className="text-muted mt-5 text-sm leading-6">{t('Without your password or a saved recovery code, we cannot restore access to your account.', 'पासवर्ड या सुरक्षित रखा रिकवरी कोड नहीं होने पर खाते की पहुँच वापस नहीं मिल सकती।')}</p>
    </>}
    <p className="mt-6"><Link className="font-semibold underline underline-offset-4" to="/login">{t('Back to sign in', 'लॉगिन पर वापस जाएँ')}</Link></p>
  </AuthShell>
}

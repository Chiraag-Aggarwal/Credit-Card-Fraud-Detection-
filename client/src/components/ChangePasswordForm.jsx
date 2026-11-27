import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../context/PreferencesContext'
import { getApiErrorMessage } from '../api/client'
import { passwordValidation } from '../utils/passwordValidation'
import FormField from './FormField'
import SlowRequestHint from './SlowRequestHint'

export default function ChangePasswordForm() {
  const { changePassword } = useAuth()
  const { t, language } = usePreferences()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  function edit(setter, field) {
    return (event) => {
      setter(event.target.value)
      setErrors((existing) => ({ ...existing, [field]: null }))
      setServerError(null)
      setSaved(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    const next = {}
    if (!currentPassword) next.current = ['Enter your current password.', 'अपना मौजूदा पासवर्ड लिखें।']
    else if (passwordValidation(currentPassword) === 'too_long') next.current = ['The current password is too long.', 'मौजूदा पासवर्ड बहुत लंबा है।']
    const invalid = passwordValidation(newPassword)
    if (invalid) next.password = invalid === 'too_short' ? ['Use at least 8 characters.', 'कम से कम 8 अक्षर या अंक लिखें।'] : ['Use a shorter password (maximum 72 UTF-8 bytes).', 'छोटा पासवर्ड लिखें (अधिकतम 72 UTF-8 बाइट)।']
    if (!confirmation || confirmation !== newPassword) next.confirm = ['The passwords do not match.', 'दोनों पासवर्ड एक जैसे नहीं हैं।']
    setErrors(next)
    setSaved(false)
    setServerError(null)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      setSaved(true)
    } catch (error) {
      setServerError(error)
    } finally {
      setBusy(false)
    }
  }

  return <section className="ui-card min-w-0 p-6 sm:p-8" aria-labelledby="password-heading">
    <h2 className="text-xl font-bold" id="password-heading">{t('Change password', 'पासवर्ड बदलें')}</h2>
    <p className="text-muted mt-2 text-sm leading-6">{t('Changing your password signs out your other sessions. This device stays signed in.', 'पासवर्ड बदलने से आपके दूसरे सेशन लॉग आउट हो जाएँगे। इस डिवाइस पर लॉगिन बना रहेगा।')}</p>
    <form className="mt-5 space-y-4" onSubmit={submit} noValidate aria-busy={busy}>
      {serverError && <p className="status-error" role="alert">{getApiErrorMessage(serverError, t('We could not confirm the password change. If the connection failed, try signing in with your new password.', 'पासवर्ड बदलाव की पुष्टि नहीं हो सकी। इंटरनेट बंद हुआ था तो अपने नए पासवर्ड से लॉगिन करके देखें।'), language)}</p>}
      {saved && <p className="status-success" role="status">{t('Password updated. Your other sessions have been signed out.', 'पासवर्ड बदल गया है। आपके दूसरे सेशन लॉग आउट हो गए हैं।')}</p>}
      <fieldset className="space-y-4" disabled={busy}>
        <FormField id="change-current-password" label={t('Current password', 'मौजूदा पासवर्ड')} type="password" autoComplete="current-password" value={currentPassword} onChange={edit(setCurrentPassword, 'current')} error={errors.current && t(...errors.current)} />
        <FormField id="change-new-password" label={t('New password', 'नया पासवर्ड')} type="password" autoComplete="new-password" value={newPassword} onChange={edit(setNewPassword, 'password')} error={errors.password && t(...errors.password)} />
        <FormField id="change-confirm-password" label={t('Confirm new password', 'नया पासवर्ड फिर लिखें')} type="password" autoComplete="new-password" value={confirmation} onChange={edit(setConfirmation, 'confirm')} error={errors.confirm && t(...errors.confirm)} />
        <button className="ui-button ui-button-primary" type="submit">{busy ? t('Updating password…', 'पासवर्ड बदल रहा है…') : t('Update password', 'पासवर्ड अपडेट करें')}</button>
      </fieldset>
      <SlowRequestHint busy={busy} />
    </form>
  </section>
}

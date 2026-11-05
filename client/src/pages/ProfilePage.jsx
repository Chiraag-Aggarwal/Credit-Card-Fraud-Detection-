import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../context/PreferencesContext'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function fieldsFor(user) {
  return { name: user?.name || '', email: user?.email || '' }
}

export default function ProfilePage() {
  const { user, updateProfile, logout } = useAuth()
  const navigate = useNavigate()
  const { t } = usePreferences()
  const [form, setForm] = useState(() => fieldsFor(user))
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  const initials = (user?.name || 'U').trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join('').toUpperCase()
  const isDirty = form.name.trim() !== (user?.name || '') || form.email.trim().toLowerCase() !== (user?.email || '')

  function edit(event) {
    const { name, value } = event.target
    setForm((previous) => ({ ...previous, [name]: value }))
    setErrors((previous) => ({ ...previous, [name]: false }))
    setStatus('')
  }

  function cancel() {
    setForm(fieldsFor(user))
    setErrors({})
    setStatus('')
  }

  async function save(event) {
    event.preventDefault()
    const details = { name: form.name.trim(), email: form.email.trim().toLowerCase() }
    const nextErrors = {
      name: !details.name || details.name.length > 120,
      email: details.email.length > 254 || !emailPattern.test(details.email),
    }
    setErrors(nextErrors)
    setStatus('')
    if (Object.values(nextErrors).some(Boolean)) return
    setSaving(true)
    try {
      const updated = await updateProfile(details)
      setForm(fieldsFor(updated))
      setStatus('saved')
    } catch (error) {
      const code = error?.response?.data?.error?.code
      setStatus(code === 'EMAIL_EXISTS' ? 'duplicate' : error?.response?.status === 429 ? 'limited' : 'failed')
    } finally {
      setSaving(false)
    }
  }

  const messages = {
    saved: t('Your profile has been updated.', 'आपकी प्रोफ़ाइल अपडेट हो गई है।'),
    duplicate: t('This email is already used by another account.', 'यह ईमेल पहले से किसी अन्य खाते में उपयोग हो रहा है।'),
    limited: t('Too many requests. Please wait a moment and try again.', 'बहुत अधिक अनुरोध हुए हैं। थोड़ा रुककर फिर कोशिश करें।'),
    failed: t('Your profile could not be saved. Please try again.', 'आपकी प्रोफ़ाइल सेव नहीं हो सकी। कृपया फिर कोशिश करें।'),
  }

  return (
    <div className="space-y-6">
      <header>
        <div>
          <p className="eyebrow">{t('Your account', 'आपका खाता')}</p>
          <h1 className="page-heading">{t('My profile', 'मेरी प्रोफ़ाइल')}</h1>
          <p className="text-muted mt-2 text-sm">{t('Keep your name and sign-in email up to date.', 'अपना नाम और लॉगिन ईमेल अपडेट रखें।')}</p>
        </div>
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[0.7fr_1.3fr]">
        <section aria-label={t('Profile summary', 'प्रोफ़ाइल सारांश')} className="ui-card flex min-w-0 flex-col items-center gap-4 p-6 text-center sm:p-8">
          <div aria-hidden="true" className="profile-avatar">{initials}</div>
          <div className="min-w-0 max-w-full">
            <h2 className="break-words text-2xl font-bold">{user?.name}</h2>
            <p className="text-muted mt-2 break-all">{user?.email}</p>
          </div>
          <span className="rounded-full border px-4 py-1 text-sm font-semibold">{user?.role === 'admin' ? t('Administrator', 'प्रशासक') : t('Merchant account', 'मर्चेंट खाता')}</span>
          <p className="text-muted max-w-sm text-sm leading-6">{t('Your profile name appears in the dashboard. Use your updated email the next time you sign in.', 'आपका नाम डैशबोर्ड पर दिखता है। अगली बार लॉगिन करते समय नया ईमेल उपयोग करें।')}</p>
          {import.meta.env.VITE_USE_MOCK === 'true' && (
            <p className="status-notice text-sm">{t('This is a demo profile stored in this browser. It does not change a real account.', 'यह इस ब्राउज़र में रखी डेमो प्रोफ़ाइल है। इससे असली खाता नहीं बदलता।')}</p>
          )}
          <button className="ui-button mt-auto" type="button" disabled={saving} onClick={() => { logout(); navigate('/login', { replace: true }) }}>{t('Log out', 'लॉग आउट करें')}</button>
        </section>

        <section className="ui-card min-w-0 p-6 sm:p-8">
          <h2 className="text-xl font-bold">{t('Edit personal details', 'अपनी जानकारी बदलें')}</h2>
          <p className="text-muted mt-2 text-sm">{t('Only you can edit these details while signed in.', 'लॉगिन करने पर केवल आप ही यह जानकारी बदल सकते हैं।')}</p>
          <form className="mt-6 space-y-5" noValidate onSubmit={save} aria-busy={saving}>
            {status && (
              <p className={status === 'saved' ? 'status-success' : 'status-error'} role={status === 'saved' ? 'status' : 'alert'} aria-live="polite">{messages[status]}</p>
            )}
            <div className="space-y-2">
              <label className="block text-sm font-semibold" htmlFor="profile-name">{t('Full name', 'पूरा नाम')}</label>
              <input autoComplete="name" className="field-input w-full" disabled={saving} id="profile-name" name="name" maxLength={120} required value={form.name} onChange={edit} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'profile-name-error' : undefined} />
              {errors.name && <p className="field-error" id="profile-name-error">{t('Enter a name between 1 and 120 characters.', '1 से 120 अक्षरों के बीच अपना नाम लिखें।')}</p>}
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-semibold" htmlFor="profile-email">{t('Email address', 'ईमेल पता')}</label>
              <input autoComplete="email" className="field-input w-full" disabled={saving} id="profile-email" name="email" maxLength={254} required type="email" value={form.email} onChange={edit} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'profile-email-error' : 'profile-email-help'} />
              {errors.email ? <p className="field-error" id="profile-email-error">{t('Enter a valid email address.', 'सही ईमेल पता लिखें।')}</p> : <p className="text-muted text-sm" id="profile-email-help">{t('Your password stays the same when you change your email.', 'ईमेल बदलने पर आपका पासवर्ड वही रहता है।')}</p>}
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <button className="ui-button ui-button-primary" type="submit" disabled={saving || !isDirty}>{saving ? t('Saving…', 'सेव हो रहा है…') : t('Save changes', 'बदलाव सेव करें')}</button>
              <button className="ui-button" type="button" onClick={cancel} disabled={saving || !isDirty}>{t('Cancel', 'रद्द करें')}</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}

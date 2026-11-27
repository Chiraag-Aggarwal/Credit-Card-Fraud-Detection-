import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../context/PreferencesContext'

export default function LogoutButton({ all = false, className = 'ui-button', children, disabled = false }) {
  const { logout, clearLocalSession } = useAuth()
  const { t } = usePreferences()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signOut() {
    setBusy(true)
    setFailed(false)
    try {
      const cleared = await logout(all)
      if (cleared) navigate('/login', { replace: true })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return <div className="min-w-0 space-y-2">
    <button className={className} type="button" onClick={signOut} disabled={disabled || busy}>
      {busy ? t('Signing out…', 'लॉग आउट हो रहा है…') : children || t('Log out', 'लॉग आउट करें')}
    </button>
    {failed && <div className="space-y-2">
      <p className="field-error text-sm" role="alert">{t('Could not confirm sign-out with the server. Check your connection and try again.', 'सर्वर पर लॉग आउट की पुष्टि नहीं हो सकी। इंटरनेट जाँचकर फिर कोशिश करें।')}</p>
      <button className="text-sm underline underline-offset-4" type="button" disabled={busy} onClick={() => { clearLocalSession(); navigate('/login', { replace: true, state: { logoutUnconfirmed: true } }) }}>{t('Clear this device only', 'केवल इस डिवाइस से हटाएँ')}</button>
    </div>}
  </div>
}

import { isMockMode } from '../api/client'
import { usePreferences } from '../context/PreferencesContext'
import ChangePasswordForm from './ChangePasswordForm'
import RecoveryCodeSettings from './RecoveryCodeSettings'
import LogoutButton from './LogoutButton'

export default function AccountSecurity() {
  const { t } = usePreferences()
  if (isMockMode) return <section className="ui-card p-6 sm:p-8">
    <h2 className="text-xl font-bold">{t('Account security', 'खाते की सुरक्षा')}</h2>
    <p className="status-notice mt-4">{t('Password changes, recovery codes and session revocation are available for real accounts only. Mock mode does not save passwords.', 'पासवर्ड बदलाव, रिकवरी कोड और सेशन रद्द करना केवल असली खातों में उपलब्ध है। डेमो मोड में पासवर्ड सेव नहीं होते।')}</p>
  </section>
  return <div className="space-y-5">
    <div className="grid min-w-0 gap-5 xl:grid-cols-2"><ChangePasswordForm /><RecoveryCodeSettings /></div>
    <section className="ui-card min-w-0 p-6 sm:p-8">
      <h2 className="text-xl font-bold">{t('Sign out everywhere', 'सभी डिवाइस से लॉग आउट करें')}</h2>
      <p className="text-muted my-4 text-sm leading-6">{t('End all active sessions, including this device. You will need your password to sign in again.', 'इस डिवाइस सहित सभी सक्रिय सेशन बंद करें। दोबारा लॉगिन करने के लिए पासवर्ड चाहिए होगा।')}</p>
      <LogoutButton all>{t('Sign out everywhere', 'सभी डिवाइस से लॉग आउट करें')}</LogoutButton>
    </section>
  </div>
}

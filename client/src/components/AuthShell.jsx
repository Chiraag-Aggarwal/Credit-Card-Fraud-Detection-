import Icon from './Icon'
import QuickPreferences from './QuickPreferences'
import { usePreferences } from '../context/PreferencesContext'

export default function AuthShell({ children }) {
  const { t } = usePreferences()
  return (
    <main className="auth-page">
      <div className="auth-toolbar flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Icon name="shield" size={30} />
          <div>
            <p className="font-bold">{t('Fraud Detection', 'धोखाधड़ी की पहचान')}</p>
            <p className="text-muted text-xs">{t('Payment risk console', 'भुगतान जोखिम की जानकारी')}</p>
          </div>
        </div>
        <QuickPreferences />
      </div>
      <div className="auth-shell">
        <section className="auth-intro">
          <p className="eyebrow">{t('A clearer view of every payment', 'हर भुगतान की साफ़ जानकारी')}</p>
          <h1>{t('Understand risk. Make informed decisions.', 'जोखिम समझें। सही निर्णय लें।')}</h1>
          <p className="text-muted leading-relaxed">{t('Follow transaction activity, understand model predictions and review suspicious payments in one place.', 'लेन-देन देखें, मॉडल के अनुमान समझें और संदिग्ध भुगतानों की जाँच एक ही जगह करें।')}</p>
          <div className="auth-art" aria-hidden="true">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">{t('Risk, made visible', 'जोखिम अब साफ़ दिखेगा')}</span>
              <span className="status-badge" data-risk="LOW"><Icon name="check" size={16} /></span>
            </div>
            <svg className="my-5 h-28 w-full" viewBox="0 0 400 110" fill="none">
              <path d="M0 90H400M0 55H400M0 20H400" stroke="var(--border)" />
              <path d="M2 90C20 86 28 68 45 74S75 82 95 58 120 80 145 55 165 65 190 40 215 50 245 30 270 44 300 22 340 36 365 12 385 25 398 8" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
            </svg>
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
              <span className="status-badge" data-risk="LOW">{t('Monitor', 'निगरानी')}</span>
              <span className="status-badge" data-risk="MEDIUM">{t('Analyse', 'विश्लेषण')}</span>
              <span className="status-badge" data-risk="HIGH">{t('Review', 'जाँच')}</span>
            </div>
          </div>
          <p className="text-muted text-xs leading-relaxed">{t('A student project for understanding payment fraud and machine learning.', 'भुगतान धोखाधड़ी और मशीन लर्निंग समझने के लिए बनाया गया छात्र प्रोजेक्ट।')}</p>
        </section>
        <section className="auth-form-panel">{children}</section>
      </div>
    </main>
  )
}

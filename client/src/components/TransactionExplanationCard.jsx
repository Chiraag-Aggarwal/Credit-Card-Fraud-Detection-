import { usePreferences } from '../context/PreferencesContext'
import { formatProbability } from '../utils/transactionDisplay'

export default function TransactionExplanationCard({ explanation }) {
  const { t, locale } = usePreferences()
  const isMock = String(explanation.modelVersion).toLowerCase().startsWith('mock')
  const factors = Array.isArray(explanation.topFactors) ? explanation.topFactors : []
  const maxImpact = Math.max(1, ...factors.map((factor) => Math.abs(Number(factor.impact) || 0)))
  return <section aria-labelledby="explanation-title" className="ui-card p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-muted text-xs font-semibold">{t('Explainable AI', 'समझने योग्य AI')}</p><h2 className="mt-1 text-lg font-bold" id="explanation-title">{t('Why the model gave this score', 'मॉडल ने यह स्कोर क्यों दिया')}</h2></div><span className="status-badge">{explanation.modelVersion}</span></div>
    <p className="mt-3 text-sm">{t('Fraud score:', 'धोखाधड़ी स्कोर:')} <strong>{formatProbability(explanation.fraudProbability, locale)}</strong>{' · '}{t('Review threshold:', 'समीक्षा सीमा:')} <strong>{formatProbability(explanation.threshold, locale)}</strong></p>
    {isMock ? <p className="notice notice-warning mt-3 text-xs">{t('Demo example only. Mock mode does not run the trained fraud model.', 'यह केवल डेमो उदाहरण है। मॉक मोड में प्रशिक्षित मॉडल नहीं चलता।')}</p> : <p className="text-muted mt-3 text-xs leading-6">{explanation.method === 'tree_shap' ? t('TreeSHAP shows which inputs pushed this score up or down.', 'TreeSHAP दिखाता है कि किन इनपुट ने स्कोर बढ़ाया या घटाया।') : t('Logistic regression coefficients show how model inputs changed the score.', 'लॉजिस्टिक रिग्रेशन के गुणांक दिखाते हैं कि इनपुट ने स्कोर कैसे बदला।')} {t('V features are anonymous dataset components, not proof of fraud.', 'V फीचर डेटासेट के गुमनाम घटक हैं, धोखाधड़ी का प्रमाण नहीं।')}</p>}
    <ul className="mt-4 grid gap-x-8 sm:grid-cols-2">
      {factors.map((factor) => { const raisesRisk = factor.direction === 'increases_risk'; return <li className="py-3" key={factor.feature}>
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{factor.feature}</p><p className="text-muted mt-1 text-xs">{t('Input value:', 'इनपुट मान:')} {Number(factor.value).toFixed(3)}</p></div><span className="status-badge" data-risk={raisesRisk ? 'HIGH' : 'LOW'}>{raisesRisk ? t('Raises risk', 'जोखिम बढ़ाता है') : t('Lowers risk', 'जोखिम घटाता है')}</span></div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-soft)' }} aria-hidden="true"><div className="h-full rounded-full" style={{ width: Math.min(100, Math.abs(Number(factor.impact) || 0) / maxImpact * 100) + '%', background: 'var(--accent)' }} /></div>
        <p className="text-muted mt-1 text-right text-xs">{factor.impact > 0 ? '+' : ''}{Number(factor.impact).toFixed(2)} {t('log-odds', 'लॉग-ऑड्स')}</p>
      </li> })}
    </ul>
  </section>
}

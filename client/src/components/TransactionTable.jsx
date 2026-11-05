import RiskBadge from './RiskBadge'
import { usePreferences } from '../context/PreferencesContext'
import { formatTime, formatAmount, formatProbability, sourceText, statusText } from '../utils/transactionDisplay'

export default function TransactionTable({ items, error, onRetry }) {
  const { t, locale } = usePreferences()
  return (
    <section className="ui-card recent-transactions min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5">
        <div><h2 className="text-lg font-bold">{t('Latest transactions', 'हाल के लेन-देन')}</h2><p className="text-muted mt-1 text-xs">{t('Newest 20 payments, refreshed every 5 seconds', 'नवीनतम 20 भुगतान, हर 5 सेकंड में अपडेट')}</p></div>
        <span className="status-badge">{items.length} {t('shown', 'दिखाए गए')}</span>
      </div>
      {error && <div className="notice notice-warning mx-5 mb-4 flex flex-wrap items-center justify-between gap-3" role="alert"><p className="text-sm">{error}</p><button className="ui-button" onClick={onRetry} type="button">{t('Retry', 'फिर कोशिश करें')}</button></div>}
      {items.length === 0 ? <div className="px-5 py-14 text-center"><p className="font-semibold">{t('No transactions yet - click Simulate', 'अभी कोई लेन-देन नहीं — सिमुलेट करें पर क्लिक करें')}</p><p className="text-muted mt-2 text-sm">{t('Simulate payments to populate this table with risk scores.', 'जोखिम स्कोर के साथ नमूना भुगतान देखने के लिए सिमुलेट करें।')}</p></div> : <>
        <div className="table-scroll hidden md:block" tabIndex={0} role="region" aria-label={t('Latest transactions table', 'हाल के लेन-देन की तालिका')}>
          <table className="data-table w-full min-w-[760px] text-left text-sm">
            <thead><tr>{[[ 'Time', 'समय'], ['Amount', 'राशि'], ['Probability', 'संभावना'], ['Risk', 'जोखिम'], ['Source', 'स्रोत'], ['Scoring status', 'स्कोर की स्थिति']].map(([en, hi]) => <th scope="col" key={en}>{t(en, hi)}</th>)}</tr></thead>
            <tbody>{items.map((item) => <tr key={item.id}>
              <td className="text-muted whitespace-nowrap">{formatTime(item.createdAt, locale)}</td>
              <td className="whitespace-nowrap font-semibold">{formatAmount(item.displayAmount, item.currency, locale)}</td>
              <td>{formatProbability(item.fraudProbability, locale)}</td>
              <td><RiskBadge risk={item.riskLabel} /></td>
              <td>{sourceText(item.source, t)}</td><td>{statusText(item.scoringStatus, t)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <ul className="mobile-transaction-list space-y-3 px-4 pb-4 md:hidden">
          {items.map((item) => <li className="transaction-mobile-card" key={item.id}>
            <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-bold">{formatAmount(item.displayAmount, item.currency, locale)}</p><p className="text-muted mt-1 text-xs">{formatTime(item.createdAt, locale)}</p></div><RiskBadge risk={item.riskLabel} /></div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted text-xs">{t('Fraud probability', 'धोखाधड़ी की संभावना')}</dt><dd className="mt-1 font-semibold">{formatProbability(item.fraudProbability, locale)}</dd></div><div><dt className="text-muted text-xs">{t('Source', 'स्रोत')}</dt><dd className="mt-1">{sourceText(item.source, t)}</dd></div></dl>
            <p className="text-muted mt-3 text-xs">{statusText(item.scoringStatus, t)}</p>
          </li>)}
        </ul>
      </>}
    </section>
  )
}

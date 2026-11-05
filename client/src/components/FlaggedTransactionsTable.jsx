import RiskBadge from './RiskBadge'
import { usePreferences } from '../context/PreferencesContext'
import { formatTime, formatAmount, formatProbability, sourceText, statusText } from '../utils/transactionDisplay'

function ReviewActions({ item, reviewingId, explainingId, onReview, onExplain }) {
  const { t } = usePreferences()
  const isReviewing = reviewingId === item.id
  return <div className="flex flex-wrap gap-2">
    <button className="ui-button text-xs" disabled={item.scoringStatus !== 'scored' || Boolean(explainingId) || Boolean(reviewingId)} onClick={() => onExplain(item.id)} type="button">{explainingId === item.id ? t('Explaining…', 'समझाया जा रहा है…') : t('Why this score?', 'यह स्कोर क्यों?')}</button>
    {item.reviewDecision ? <span role="status" className="status-badge">{isReviewing ? t('Saving…', 'सहेजा जा रहा है…') : item.reviewDecision === 'confirmed_fraud' ? t('Confirmed fraud', 'धोखाधड़ी की पुष्टि') : t('Marked legit', 'सही चिह्नित')}</span> : <>
      <button className="ui-button ui-button-danger text-xs" disabled={Boolean(reviewingId)} onClick={() => onReview(item.id, 'confirmed_fraud')} type="button">{t('Confirm fraud', 'धोखाधड़ी की पुष्टि')}</button>
      <button className="ui-button text-xs" disabled={Boolean(reviewingId)} onClick={() => onReview(item.id, 'legit')} type="button">{t('Mark legit', 'सही चिह्नित करें')}</button>
    </>}
  </div>
}

export default function FlaggedTransactionsTable({ items, reviewingId, explainingId, onReview, onExplain }) {
  const { t, locale } = usePreferences()
  const actions = { reviewingId, explainingId, onReview, onExplain }
  if (items.length === 0) return <div className="ui-card px-6 py-14 text-center"><p className="font-semibold">{t('No flagged transactions found', 'कोई चिह्नित लेन-देन नहीं मिला')}</p><p className="text-muted mt-2 text-sm">{t('Try changing the filters or check back later.', 'फ़िल्टर बदलें या बाद में दोबारा देखें।')}</p></div>
  return <section className="ui-card min-w-0 overflow-hidden">
    <div className="px-5 py-5"><h2 className="text-lg font-bold">{t('Review queue', 'समीक्षा सूची')}</h2><p className="text-muted mt-1 text-xs">{t('Check the model insight before recording a decision.', 'निर्णय दर्ज करने से पहले मॉडल का कारण देखें।')}</p></div>
    <div className="table-scroll hidden xl:block" tabIndex={0} role="region" aria-label={t('Flagged transactions table', 'चिह्नित लेन-देन की तालिका')}>
      <table className="data-table w-full min-w-[1100px] text-left text-sm">
        <thead><tr>{[['Transaction', 'लेन-देन'], ['Amount', 'राशि'], ['Probability', 'संभावना'], ['Risk', 'जोखिम'], ['Scoring status', 'स्कोर की स्थिति'], ['Review', 'समीक्षा']].map(([en, hi]) => <th scope="col" key={en}>{t(en, hi)}</th>)}</tr></thead>
        <tbody>{items.map((item) => <tr className="align-top" key={item.id}>
          <td><p className="whitespace-nowrap">{formatTime(item.createdAt, locale)}</p><p className="text-muted mt-1 text-xs">{sourceText(item.source, t)}</p></td>
          <td className="whitespace-nowrap font-semibold">{formatAmount(item.displayAmount, item.currency, locale)}</td>
          <td>{formatProbability(item.fraudProbability, locale)}</td><td><RiskBadge risk={item.riskLabel} /></td>
          <td>{statusText(item.scoringStatus, t)}{item.scoringStatus === 'pending_review' && <p className="notice notice-warning mt-2 max-w-64 text-xs">{t('Model unavailable - needs manual review', 'मॉडल उपलब्ध नहीं — मैन्युअल समीक्षा ज़रूरी है')}</p>}</td>
          <td><ReviewActions item={item} {...actions} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <ul className="mobile-transaction-list grid gap-4 px-4 pb-4 md:grid-cols-2 xl:hidden">
      {items.map((item) => <li className="transaction-mobile-card" key={item.id}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-bold">{formatAmount(item.displayAmount, item.currency, locale)}</p><p className="text-muted mt-1 text-xs">{formatTime(item.createdAt, locale)}</p></div><RiskBadge risk={item.riskLabel} /></div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted text-xs">{t('Fraud probability', 'धोखाधड़ी की संभावना')}</dt><dd className="mt-1 font-semibold">{formatProbability(item.fraudProbability, locale)}</dd></div><div><dt className="text-muted text-xs">{t('Source', 'स्रोत')}</dt><dd className="mt-1">{sourceText(item.source, t)}</dd></div></dl>
        <p className="text-muted my-3 text-xs">{statusText(item.scoringStatus, t)}</p>
        {item.scoringStatus === 'pending_review' && <p className="notice notice-warning mb-3 text-xs">{t('Model unavailable - needs manual review', 'मॉडल उपलब्ध नहीं — मैन्युअल समीक्षा ज़रूरी है')}</p>}
        <ReviewActions item={item} {...actions} />
      </li>)}
    </ul>
  </section>
}

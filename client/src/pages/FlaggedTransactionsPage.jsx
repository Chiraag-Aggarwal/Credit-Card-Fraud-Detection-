import { useCallback, useEffect, useState } from 'react'
import apiClient, { getApiErrorMessage } from '../api/client'
import FlaggedFilterBar from '../components/FlaggedFilterBar'
import FlaggedTransactionsTable from '../components/FlaggedTransactionsTable'
import TransactionExplanationCard from '../components/TransactionExplanationCard'

import { usePreferences } from '../context/PreferencesContext'
import useRequestScope from '../hooks/useRequestScope'
import { dateFilterBoundary } from '../utils/dateFilters'

const PAGE_SIZE = 20
const emptyFilters = { riskLabel: '', from: '', to: '' }

function LoadingRows() {
  const { t } = usePreferences()
  return <div aria-busy="true" className="ui-card space-y-3 p-5"><div className="skeleton-block h-5 w-48" />{[1,2,3,4].map((key) => <div className="skeleton-block h-12" key={key} />)}<span className="sr-only" role="status">{t('Loading flagged transactions', 'चिह्नित लेन-देन लोड हो रहे हैं')}</span></div>
}

export default function FlaggedTransactionsPage() {
  const { t, language } = usePreferences()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [filters, setFilters] = useState(emptyFilters)
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters)
  const [filterError, setFilterError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [reviewingId, setReviewingId] = useState('')
  const [explainingId, setExplainingId] = useState('')
  const [explanation, setExplanation] = useState(null)
  const [explanationError, setExplanationError] = useState('')

  const queries = useRequestScope()
  const reviews = useRequestScope()
  const explanations = useRequestScope()

  const loadTransactions = useCallback(async () => {
    const request = queries.begin()
    if (!request) return
    explanations.cancel()
    setExplainingId('')
    setExplanation(null)
    setExplanationError(null)
    setLoading(true)
    setError(null)
    try {
      const params = { page, limit: PAGE_SIZE, flagged: true }
      if (appliedFilters.riskLabel) params.riskLabel = appliedFilters.riskLabel
      if (appliedFilters.from) params.from = dateFilterBoundary(appliedFilters.from)
      if (appliedFilters.to) params.to = dateFilterBoundary(appliedFilters.to, true)
      const { data } = await apiClient.get('/api/transactions', { params, signal: request.signal })
      if (!request.isCurrent()) return
      setItems(data.items)
      setTotal(data.total)
      setLimit(data.limit > 0 ? data.limit : PAGE_SIZE)
    } catch (requestError) {
      if (request.isCurrent()) setError(requestError)
    } finally {
      if (request.isCurrent()) setLoading(false)
      request.finish()
    }
  }, [appliedFilters, page, queries, explanations])

  useEffect(() => { void loadTransactions() }, [loadTransactions])

  function updateFilter(name, value) {
    if (reviews.isPending()) return
    setFilters((current) => ({ ...current, [name]: value }))
    setFilterError(false)
  }

  function applyFilters(event) {
    event.preventDefault()
    if (reviews.isPending()) return
    if (filters.from && filters.to && filters.from > filters.to) {
      setFilterError(true)
      return
    }
    queries.cancel()
    setFilterError(false)
    setAppliedFilters({ ...filters })
    setPage(1)
  }

  function clearFilters() {
    if (reviews.isPending()) return
    queries.cancel()
    setFilters({ ...emptyFilters })
    setAppliedFilters({ ...emptyFilters })
    setFilterError(false)
    setPage(1)
  }

  function changePage(nextPage) {
    if (reviews.isPending() || loading || nextPage === page) return
    queries.cancel()
    explanations.cancel()
    setPage(nextPage)
  }

  async function reviewTransaction(id, decision) {
    if (reviews.isPending()) return
    const current = items.find((transaction) => transaction.id === id)
    if (!current) return
    const request = reviews.begin()
    if (!request) return
    explanations.cancel()
    setExplainingId('')
    setExplanation(null)
    setExplanationError(null)
    setActionError(null)
    setReviewingId(id)
    setItems((existing) => existing.map((transaction) => transaction.id === id ? { ...transaction, reviewDecision: decision } : transaction))
    try {
      const { data: updated } = await apiClient.patch(
        '/api/transactions/' + encodeURIComponent(id) + '/review', { decision },
        { signal: request.signal },
      )
      if (!request.isCurrent()) return
      if (updated.isFlagged === false) {
        setItems((existing) => existing.filter((transaction) => transaction.id !== id))
        setTotal((count) => Math.max(0, count - 1))
        // Refill the current page after removal so the next page cannot skip a row.
        if (items.length === 1 && page > 1) {
          setPage((currentPage) => currentPage - 1)
        } else {
          await loadTransactions()
        }
      } else {
        setItems((existing) => existing.map((transaction) => transaction.id === id ? updated : transaction))
      }
    } catch (requestError) {
      if (!request.isCurrent()) return
      setItems((existing) => existing.map((transaction) => transaction.id === id ? current : transaction))
      setActionError(requestError)
    } finally {
      if (request.isCurrent()) setReviewingId('')
      request.finish()
    }
  }

  async function explainTransaction(id) {
    if (reviews.isPending()) return
    if (explanation?.transactionId === id) {
      explanations.cancel()
      setExplanation(null)
      setExplanationError(null)
      return
    }
    const request = explanations.begin()
    if (!request) return
    setExplainingId(id)
    setExplanation(null)
    setExplanationError(null)
    try {
      const { data } = await apiClient.get(
        '/api/transactions/' + encodeURIComponent(id) + '/explanation',
        { signal: request.signal },
      )
      if (request.isCurrent()) setExplanation(data)
    } catch (requestError) {
      if (request.isCurrent()) setExplanationError(requestError)
    } finally {
      if (request.isCurrent()) setExplainingId('')
      request.finish()
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / limit))
  const firstResult = total === 0 ? 0 : (page - 1) * limit + 1
  const lastResult = Math.min(page * limit, total)

  const pendingOnPage = items.filter((item) => item.scoringStatus === 'pending_review').length
  return (
    <div className="page-stack">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-muted mb-2 text-sm">{t('Review queue', 'समीक्षा सूची')}</p><h1 className="page-heading">{t('Flagged transactions', 'चिह्नित लेन-देन')}</h1><p className="text-muted mt-2 max-w-2xl text-sm leading-6">{t('Review suspicious payments and record whether they are fraud or legitimate.', 'संदिग्ध भुगतानों की समीक्षा करें और सही या धोखाधड़ी का निर्णय दर्ज करें।')}</p></div>
        {!loading && <span className="status-badge">{total} {t('matching transactions', 'मिलते हुए लेन-देन')}</span>}
      </section>
      {!loading && pendingOnPage > 0 && <p className="notice notice-warning text-sm"><strong>{pendingOnPage} {t('on this page need manual review.', 'लेन-देन की इस पेज पर मैन्युअल समीक्षा ज़रूरी है।')}</strong>{' '}{t('The model was unavailable when these payments were scored.', 'इन भुगतानों का स्कोर बनाते समय मॉडल उपलब्ध नहीं था।')}</p>}
      <FlaggedFilterBar disabled={Boolean(reviewingId)} filters={filters} onApply={applyFilters} onChange={updateFilter} onClear={clearFilters} />
      {filterError && <p className="notice notice-warning text-sm" role="alert">{t('The end date must be on or after the start date.', 'अंतिम तिथि आरंभ तिथि से पहले नहीं हो सकती।')}</p>}
      {actionError && <p aria-live="polite" className="notice notice-error text-sm" role="alert">{getApiErrorMessage(actionError, t('Could not save this review decision.', 'समीक्षा का निर्णय सहेजा नहीं जा सका।'), language)}</p>}
      {loading ? <LoadingRows /> : error ? <section className="ui-card px-6 py-12 text-center" role="alert"><h2 className="text-lg font-bold">{t('Could not load flagged transactions', 'चिह्नित लेन-देन लोड नहीं हो सके')}</h2><p className="text-muted mt-2 text-sm">{getApiErrorMessage(error, t('Could not load flagged transactions.', 'चिह्नित लेन-देन लोड नहीं हो सके।'), language)}</p><button className="ui-button ui-button-primary mt-5" onClick={loadTransactions} type="button">{t('Retry', 'फिर कोशिश करें')}</button></section> : <>
        <div className="text-muted flex flex-wrap items-center justify-between gap-2 text-sm"><p>{t('Showing', 'दिखा रहे हैं')} {firstResult}–{lastResult} {t('of', '/')} {total}</p><p>{limit} {t('per page', 'प्रति पेज')}</p></div>
        <FlaggedTransactionsTable items={items} onReview={reviewTransaction} onExplain={explainTransaction} reviewingId={reviewingId} explainingId={explainingId} />
        {explanationError && <p aria-live="polite" className="notice notice-error text-sm" role="alert">{getApiErrorMessage(explanationError, t('Could not load the model explanation.', 'मॉडल का स्पष्टीकरण लोड नहीं हो सका।'), language)}</p>}
        {explanation && <TransactionExplanationCard explanation={explanation} />}
        <nav aria-label={t('Flagged transaction pages', 'चिह्नित लेन-देन के पेज')} className="flex flex-wrap items-center justify-between gap-3">
          <button className="ui-button" disabled={page <= 1 || loading || Boolean(reviewingId)} onClick={() => changePage(Math.max(1, page - 1))} type="button">{t('Previous', 'पिछला')}</button>
          <span aria-live="polite" className="text-muted text-sm">{t('Page', 'पेज')} {page} {t('of', '/')} {pageCount}</span>
          <button className="ui-button" disabled={page >= pageCount || loading || Boolean(reviewingId)} onClick={() => changePage(Math.min(pageCount, page + 1))} type="button">{t('Next', 'अगला')}</button>
        </nav>
      </>}
    </div>
  )
}

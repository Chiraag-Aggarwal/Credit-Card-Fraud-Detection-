import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import apiClient, { getApiErrorMessage } from '../api/client'
import DashboardError from '../components/DashboardError'
import DashboardSkeleton from '../components/DashboardSkeleton'
import KpiCard from '../components/KpiCard'
import RiskHistogramChart from '../components/RiskHistogramChart'
import ModelCard from '../components/ModelCard'
import TimeSeriesChart from '../components/TimeSeriesChart'
import TransactionTable from '../components/TransactionTable'
import { useAuth } from '../context/AuthContext'
import useRequestScope from '../hooks/useRequestScope'

import { usePreferences } from '../context/PreferencesContext'
const isMockMode = import.meta.env.VITE_USE_MOCK === 'true'

export default function DashboardPage() {
  const { t, locale, language } = usePreferences()
  const numberFormatter = new Intl.NumberFormat(locale)
  const navigate = useNavigate()
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [histogram, setHistogram] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [transactionError, setTransactionError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [period, setPeriod] = useState('24h')
  const [activeAction, setActiveAction] = useState('')

  const reads = useRequestScope()
  const actions = useRequestScope()

  const loadDashboard = useCallback(async () => {
    const request = reads.begin()
    if (!request) return
    setLoading(true)
    setError(null)
    try {
      const [statsResponse, histogramResponse, transactionsResponse] = await Promise.all([
        apiClient.get('/api/transactions/stats', { signal: request.signal }),
        apiClient.get('/api/transactions/score-histogram', { signal: request.signal }),
        apiClient.get('/api/transactions', { params: { page: 1, limit: 20 }, signal: request.signal }),
      ])
      if (!request.isCurrent()) return
      setStats(statsResponse.data)
      setHistogram(histogramResponse.data.bins)
      setTransactions(transactionsResponse.data.items)
      setTransactionError(null)
    } catch (requestError) {
      if (request.isCurrent()) setError(requestError)
    } finally {
      if (request.isCurrent()) setLoading(false)
      request.finish()
    }
  }, [reads])

  const refreshTransactions = useCallback(async () => {
    // A slow API must not accumulate overlapping five-second polling requests.
    if (reads.isPending() || actions.isPending()) return
    const request = reads.begin()
    if (!request) return
    try {
      const { data } = await apiClient.get('/api/transactions', {
        params: { page: 1, limit: 20 }, signal: request.signal,
      })
      if (!request.isCurrent()) return
      setTransactions(data.items)
      setTransactionError(null)
    } catch (requestError) {
      if (request.isCurrent()) setTransactionError(requestError)
    } finally { request.finish() }
  }, [reads, actions])

  useEffect(() => { void loadDashboard() }, [loadDashboard])
  useEffect(() => {
    const intervalId = window.setInterval(() => { void refreshTransactions() }, 5000)
    return () => window.clearInterval(intervalId)
  }, [refreshTransactions])

  async function simulateTransactions(count, mode, actionName) {
    if (actions.isPending()) return
    const request = actions.begin()
    if (!request) return
    setActionError(null)
    setActionNotice('')
    setActiveAction(actionName)
    try {
      await apiClient.post('/api/transactions/simulate', { count, mode }, { signal: request.signal })
      if (request.isCurrent()) await loadDashboard()
    } catch (requestError) {
      if (request.isCurrent()) setActionError(requestError)
    } finally {
      if (request.isCurrent()) setActiveAction('')
      request.finish()
    }
  }

  async function startCheckout() {
    if (actions.isPending()) return
    const request = actions.begin()
    if (!request) return
    setActionError(null)
    setActionNotice('')
    setActiveAction('checkout')
    try {
      const { data } = await apiClient.post('/api/payments/checkout-session', {
        amount: 1, currency: 'inr', mode: 'normal',
      }, { signal: request.signal })
      if (!request.isCurrent()) return
      if (isMockMode) {
        setActionNotice('complete')
        return
      }
      if (typeof data.url !== 'string' || !data.url) throw new Error('The checkout service did not return a redirect URL.')
      const checkoutUrl = new URL(data.url, window.location.origin)
      if (checkoutUrl.origin !== window.location.origin) throw new Error('The checkout service returned a URL for a different site.')
      navigate(checkoutUrl.pathname + checkoutUrl.search)
    } catch (requestError) {
      if (request.isCurrent()) setActionError(requestError)
    } finally {
      if (request.isCurrent()) setActiveAction('')
      request.finish()
    }
  }

  if (loading) return <DashboardSkeleton />
  if (error) return <DashboardError message={getApiErrorMessage(error, t('Please check the API connection and try again.', 'API कनेक्शन जाँचें और फिर कोशिश करें।'), language)} onRetry={loadDashboard} />

  const series = period === '24h' ? stats.series24h : stats.series30d
  const fraudRate = (Number(stats.fraudRate || 0) * 100).toFixed(1) + '%'
  const averageRisk = (Number(stats.avgProbability || 0) * 100).toFixed(1) + '%'
  const isBusy = Boolean(activeAction)

  return (
    <div className="page-stack">
      <section className="flex flex-col justify-between gap-5 2xl:flex-row 2xl:items-end">
        <div><p className="text-muted mb-2 text-sm">{user?.name ? t('Welcome back, ', 'फिर से स्वागत है, ') + user.name : t('Your payment risk console', 'आपका भुगतान जोखिम कंसोल')}</p><h1 className="page-heading">{t('Transaction overview', 'लेन-देन का अवलोकन')}</h1><p className="text-muted mt-2 max-w-2xl text-sm leading-6">{t('Monitor payment activity, review risk, and keep an eye on scoring health.', 'भुगतान गतिविधि, जोखिम और स्कोरिंग की स्थिति पर नज़र रखें।')}</p></div>
        <div className="flex flex-wrap gap-2">
          <button className="ui-button" disabled={isBusy} onClick={() => simulateTransactions(10, 'random', 'simulate')} type="button">{activeAction === 'simulate' ? t('Simulating…', 'सिमुलेट हो रहा है…') : t('Simulate 10 transactions', '10 लेन-देन सिमुलेट करें')}</button>
          <button className="ui-button ui-button-danger" disabled={isBusy} onClick={() => simulateTransactions(5, 'fraud', 'fraud')} type="button">{activeAction === 'fraud' ? t('Creating burst…', 'नमूने बन रहे हैं…') : t('Simulate fraud burst', 'धोखाधड़ी के नमूने बनाएँ')}</button>
          <button className="ui-button ui-button-primary" disabled={isBusy} onClick={startCheckout} type="button">{activeAction === 'checkout' ? t('Starting checkout…', 'चेकआउट शुरू हो रहा है…') : isMockMode ? t('Try demo checkout', 'डेमो चेकआउट आज़माएँ') : t('Pay with Razorpay (test)', 'Razorpay से भुगतान (टेस्ट)')}</button>
        </div>
      </section>
      {actionError && <p aria-live="polite" className="notice notice-error" role="alert">{getApiErrorMessage(actionError, t('The action could not finish. Please try again.', 'कार्रवाई पूरी नहीं हो सकी। फिर कोशिश करें।'), language)}</p>}
      {actionNotice && <p aria-live="polite" className="notice notice-success" role="status">{t('Demo checkout complete. No payment was processed.', 'डेमो चेकआउट पूरा हुआ। कोई वास्तविक भुगतान नहीं हुआ।')}</p>}
      <section aria-label={t('Transaction key performance indicators', 'लेन-देन के मुख्य आँकड़े')} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard accent="emerald" detail={t('All payment events', 'सभी भुगतान')} label={t('Total transactions', 'कुल लेन-देन')} value={numberFormatter.format(stats.total)} />
        <KpiCard accent="rose" detail={t('Payments needing attention', 'ध्यान देने योग्य भुगतान')} label={t('Flagged for review', 'समीक्षा के लिए चिह्नित')} value={numberFormatter.format(stats.flagged)} />
        <KpiCard accent="amber" detail={t('Flagged share, not confirmed fraud', 'चिह्नित हिस्सा, पुष्ट धोखाधड़ी नहीं')} label={t('Flagged share', 'चिह्नित प्रतिशत')} value={fraudRate} />
        <KpiCard accent="slate" detail={t('Mean scored probability', 'स्कोर की औसत संभावना')} label={t('Average risk score', 'औसत जोखिम स्कोर')} value={averageRisk} />
      </section>
      <section aria-label={t('Risk charts', 'जोखिम चार्ट')} className="grid min-w-0 gap-4 lg:grid-cols-2">
        <TimeSeriesChart data={Array.isArray(series) ? series : []} onPeriodChange={setPeriod} period={period} />
        <RiskHistogramChart bins={Array.isArray(histogram) ? histogram : []} />
      </section>
      <TransactionTable error={transactionError ? getApiErrorMessage(transactionError, t('Could not refresh the transaction list.', 'लेन-देन सूची अपडेट नहीं हो सकी।'), language) : ''} items={Array.isArray(transactions) ? transactions : []} onRetry={refreshTransactions} />
      <ModelCard />
      <p className="text-muted px-1 text-xs">{isMockMode ? t('Demo checkout only. No payment is processed.', 'केवल डेमो चेकआउट। कोई वास्तविक भुगतान नहीं होता।') : t('Razorpay test mode simulates payment. No real money is moved.', 'Razorpay टेस्ट मोड में नमूना भुगतान होता है। वास्तविक पैसे नहीं कटते।')}</p>
    </div>
  )
}

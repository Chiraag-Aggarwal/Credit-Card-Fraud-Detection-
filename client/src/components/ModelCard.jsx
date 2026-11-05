import { useCallback, useEffect, useState } from 'react'
import apiClient, { getApiErrorMessage } from '../api/client'
import { usePreferences } from '../context/PreferencesContext'
import { formatProbability } from '../utils/transactionDisplay'
import useRequestScope from '../hooks/useRequestScope'

const metricLabels = [
  ['Precision', 'सटीकता (Precision)', 'precision'],
  ['Recall', 'पहचान दर (Recall)', 'recall'],
  ['F1 score', 'F1 स्कोर', 'f1'],
  ['ROC-AUC', 'ROC-AUC', 'roc_auc'],
  ['PR-AUC', 'PR-AUC', 'pr_auc'],
]

function MatrixGrid({ matrix }) {
  const { t, locale } = usePreferences()
  const valid = Array.isArray(matrix) && matrix.length === 2 && matrix.every((row) => Array.isArray(row) && row.length === 2)
  if (!valid) return <p className="text-muted text-sm">{t('Confusion matrix unavailable.', 'कन्फ्यूज़न मैट्रिक्स उपलब्ध नहीं है।')}</p>
  return <div className="table-scroll">
    <table className="confusion-matrix w-full text-center text-sm" aria-label={t('Confusion matrix', 'कन्फ्यूज़न मैट्रिक्स')}>
      <thead><tr><td /><th className="p-2 text-xs" scope="col">{t('Predicted legit', 'अनुमान: सही')}</th><th className="p-2 text-xs" scope="col">{t('Predicted fraud', 'अनुमान: धोखाधड़ी')}</th></tr></thead>
      <tbody>{matrix.map((row, rowIndex) => <tr key={rowIndex}><th className="p-2 text-xs" scope="row">{rowIndex === 0 ? t('Actual legit', 'वास्तविक: सही') : t('Actual fraud', 'वास्तविक: धोखाधड़ी')}</th>{row.map((value, columnIndex) => <td className="p-3 text-base font-bold" style={{ background: rowIndex === columnIndex ? 'var(--accent-soft)' : 'var(--surface-soft)', border: '1px solid var(--border)' }} key={columnIndex}>{new Intl.NumberFormat(locale).format(value)}</td>)}</tr>)}</tbody>
    </table>
  </div>
}

export default function ModelCard() {
  const { t, locale, language } = usePreferences()
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requests = useRequestScope()
  const loadModel = useCallback(async () => {
    const request = requests.begin()
    if (!request) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiClient.get('/api/model-info', { signal: request.signal })
      if (request.isCurrent()) setModel(data)
    } catch (requestError) {
      if (request.isCurrent()) setError(requestError)
    } finally {
      if (request.isCurrent()) setLoading(false)
      request.finish()
    }
  }, [requests])
  useEffect(() => { void loadModel() }, [loadModel])
  if (loading) return <section aria-busy="true" className="ui-card p-5"><div className="skeleton-block h-5 w-36" /><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{metricLabels.map(([label]) => <div className="skeleton-block h-16" key={label} />)}</div><span className="sr-only" role="status">{t('Loading model information', 'मॉडल की जानकारी लोड हो रही है')}</span></section>
  if (error || !model) return <section className="ui-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">{t('Model performance', 'मॉडल का प्रदर्शन')}</h2><p className="text-muted mt-1 text-sm" role="alert">{getApiErrorMessage(error, t('Could not load model information.', 'मॉडल की जानकारी नहीं मिल सकी।'), language)}</p></div><button className="ui-button" onClick={loadModel} type="button">{t('Retry', 'फिर कोशिश करें')}</button></div></section>
  const metrics = model.metrics || {}
  const mock = String(model.model_version).toLowerCase().startsWith('mock')
  return <section className="ui-card p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{t('Model performance', 'मॉडल का प्रदर्शन')}</h2><p className="text-muted mt-1 text-xs">{mock ? t('Demo placeholder metrics — no trained model is running', 'डेमो के नमूना मेट्रिक्स — प्रशिक्षित मॉडल नहीं चल रहा है') : t('Held-out test results and decision threshold', 'अलग रखे टेस्ट डेटा के परिणाम और निर्णय सीमा')}</p></div><span className="status-badge">{model.model_version}</span></div>
    <div className="mt-5 grid min-w-0 gap-6 xl:grid-cols-[1.5fr_1fr]">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="metric-tile rounded-2xl p-4" style={{ background: 'var(--accent-soft)' }}><dt className="text-muted text-xs">{t('Threshold', 'निर्णय सीमा')}</dt><dd className="mt-2 text-2xl font-bold">{formatProbability(model.threshold, locale)}</dd></div>
        {metricLabels.map(([en, hi, key]) => <div className="metric-tile rounded-2xl p-4" style={{ background: 'var(--surface-soft)' }} key={key}><dt className="text-muted text-xs">{t(en, hi)}</dt><dd className="mt-2 text-2xl font-bold">{formatProbability(metrics[key], locale)}</dd></div>)}
      </dl>
      <div className="min-w-0"><h3 className="text-muted mb-2 text-sm font-semibold">{t('Confusion matrix', 'कन्फ्यूज़न मैट्रिक्स')}</h3><MatrixGrid matrix={metrics.confusion_matrix} /></div>
    </div>
  </section>
}

import { usePreferences } from '../context/PreferencesContext'
export default function DashboardError({ message, onRetry }) {
  const { t } = usePreferences()
  return <section aria-labelledby="dashboard-error-title" className="ui-card px-6 py-12 text-center" role="alert">
    <span aria-hidden="true" className="status-badge" data-risk="HIGH">!</span><h1 className="mt-4 text-xl font-bold" id="dashboard-error-title">{t('Dashboard data could not load', 'डैशबोर्ड डेटा लोड नहीं हो सका')}</h1>
    <p className="text-muted mx-auto mt-2 max-w-lg text-sm leading-6">{message}</p>
    <button className="ui-button ui-button-primary mt-6" onClick={onRetry} type="button">{t('Retry', 'फिर कोशिश करें')}</button>
  </section>
}

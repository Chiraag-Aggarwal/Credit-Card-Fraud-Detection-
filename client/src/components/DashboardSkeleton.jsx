import { usePreferences } from '../context/PreferencesContext'
export default function DashboardSkeleton() {
  const { t } = usePreferences()
  return <div aria-busy="true" aria-label={t('Loading dashboard', 'डैशबोर्ड लोड हो रहा है')} className="page-stack">
    <div className="space-y-3"><div className="skeleton-block h-9 w-64 max-w-full" /><div className="skeleton-block h-4 w-96 max-w-full" /></div>
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{['total','flagged','rate','average'].map((key) => <div className="ui-card p-5" key={key}><div className="skeleton-block h-4 w-28" /><div className="skeleton-block mt-5 h-8 w-24" /><div className="skeleton-block mt-3 h-3 w-36" /></div>)}</section>
    <section className="grid gap-4 lg:grid-cols-2">{['trend','histogram'].map((key) => <div className="ui-card h-80 p-5" key={key}><div className="skeleton-block h-5 w-40" /><div className="skeleton-block mt-6 h-56" /></div>)}</section>
    <section className="ui-card p-5">{[1,2,3].map((key) => <div className="skeleton-block mt-5 h-9" key={key} />)}</section><span className="sr-only" role="status">{t('Loading dashboard data', 'डैशबोर्ड डेटा लोड हो रहा है')}</span>
  </div>
}

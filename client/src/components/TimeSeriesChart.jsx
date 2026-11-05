import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePreferences } from '../context/PreferencesContext'

export default function TimeSeriesChart({ data, period, onPeriodChange }) {
  const { t, locale } = usePreferences()
  function dateLabel(value, tick = false) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return tick ? (period === '24h' ? date.toLocaleTimeString(locale, { hour: 'numeric' }) : date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })) : date.toLocaleString(locale)
  }
  return (
    <section className="ui-card chart-card min-w-0 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-lg font-bold">{t('Transaction activity', 'लेन-देन गतिविधि')}</h2><p className="text-muted mt-1 text-xs">{t('Total and flagged payments over time', 'समय के अनुसार कुल और चिह्नित भुगतान')}</p></div>
        <div aria-label={t('Chart time range', 'चार्ट की समय सीमा')} className="segmented-control" role="group">
          {['24h', '30d'].map((option) => <button aria-pressed={period === option} className={period === option ? 'is-active' : ''} key={option} onClick={() => onPeriodChange(option)} type="button">{option === '24h' ? t('24 hours', '24 घंटे') : t('30 days', '30 दिन')}</button>)}
        </div>
      </div>
      {data.length ? (
        <div aria-label={t('Line chart of total and flagged transactions', 'कुल और चिह्नित लेन-देन का रेखा चार्ट')} className="mt-5 h-64 w-full min-w-0">
          <ResponsiveContainer height="100%" width="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
              <XAxis axisLine={false} dataKey="t" tickFormatter={(value) => dateLabel(value, true)} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: '0.7rem' }} minTickGap={24} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: '0.7rem' }} width={42} />
              <Tooltip labelFormatter={(value) => dateLabel(value)} contentStyle={{ borderRadius: 16, background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)', fontSize: '0.75rem' }} />
              <Legend />
              <Line activeDot={{ r: 5 }} dataKey="total" dot={false} name={t('Total', 'कुल')} stroke="var(--chart-total)" strokeWidth={3} type="monotone" />
              <Line activeDot={{ r: 5 }} dataKey="flagged" dot={false} name={t('Flagged', 'चिह्नित')} stroke="var(--chart-flagged)" strokeWidth={2.5} type="monotone" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <div className="text-muted mt-5 grid h-64 place-items-center text-center text-sm">{t('No transaction activity for this range.', 'इस समय सीमा में कोई लेन-देन नहीं है।')}</div>}
    </section>
  )
}

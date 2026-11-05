import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePreferences } from '../context/PreferencesContext'

export default function RiskHistogramChart({ bins }) {
  const { t } = usePreferences()
  const chartData = bins.map((bin) => ({ label: Math.round(bin.from * 100) + '–' + Math.round(bin.to * 100) + '%', count: bin.count }))
  return (
    <section className="ui-card chart-card min-w-0 p-5">
      <h2 className="text-lg font-bold">{t('Risk score distribution', 'जोखिम स्कोर का वितरण')}</h2>
      <p className="text-muted mt-1 text-xs">{t('Transaction counts by probability range', 'संभावना की सीमा के अनुसार लेन-देन की संख्या')}</p>
      {chartData.length ? <div aria-label={t('Bar chart of risk score histogram', 'जोखिम स्कोर का बार चार्ट')} className="mt-5 h-64 w-full min-w-0">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis axisLine={false} dataKey="label" tickLine={false} tick={{ fill: 'var(--muted)', fontSize: '0.65rem' }} minTickGap={8} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: '0.7rem' }} width={42} />
            <Tooltip cursor={{ fill: 'var(--accent-soft)' }} contentStyle={{ borderRadius: 16, background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)', fontSize: '0.75rem' }} />
            <Bar dataKey="count" name={t('Transactions', 'लेन-देन')} fill="var(--chart-total)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div> : <div className="text-muted mt-5 grid h-64 place-items-center text-sm">{t('No scored transactions yet.', 'अभी किसी लेन-देन का स्कोर नहीं है।')}</div>}
    </section>
  )
}

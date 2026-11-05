export default function KpiCard({ label, value, detail, accent = 'emerald' }) {
  return (
    <article className="ui-card kpi-card p-5" data-accent={accent}>
      <div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold">{label}</p><span aria-hidden="true" className="kpi-indicator" /></div>
      <p className="mt-4 text-4xl font-bold tracking-tight">{value}</p>
      <p className="text-muted mt-2 text-xs leading-5">{detail}</p>
    </article>
  )
}

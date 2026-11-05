import { usePreferences } from '../context/PreferencesContext'
import { riskText } from '../utils/transactionDisplay'
const riskOptions = ['LOW', 'MEDIUM', 'HIGH', 'UNSCORED']

export default function FlaggedFilterBar({ filters, onChange, onApply, onClear, disabled = false }) {
  const { t } = usePreferences()
  return (
    <form className="ui-card p-4 sm:p-5" onSubmit={onApply}>
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_auto_auto] xl:items-end">
        <div><label className="text-muted text-xs font-semibold" htmlFor="riskLabel">{t('Risk label', 'जोखिम स्तर')}</label>
          <select className="field-input mt-2 w-full" id="riskLabel" onChange={(event) => onChange('riskLabel', event.target.value)} value={filters.riskLabel}>
            <option value="">{t('All risk labels', 'सभी जोखिम स्तर')}</option>{riskOptions.map((risk) => <option key={risk} value={risk}>{riskText(risk, t)}</option>)}
          </select>
        </div>
        <div><label className="text-muted text-xs font-semibold" htmlFor="from">{t('From', 'आरंभ तिथि')}</label><input className="field-input mt-2 w-full" id="from" max={filters.to || undefined} onChange={(event) => onChange('from', event.target.value)} type="date" value={filters.from} /></div>
        <div><label className="text-muted text-xs font-semibold" htmlFor="to">{t('To', 'अंतिम तिथि')}</label><input className="field-input mt-2 w-full" id="to" min={filters.from || undefined} onChange={(event) => onChange('to', event.target.value)} type="date" value={filters.to} /></div>
        <button className="ui-button ui-button-primary" type="submit">{t('Apply filters', 'फ़िल्टर लागू करें')}</button>
        <button className="ui-button" onClick={onClear} type="button">{t('Clear', 'हटाएँ')}</button>
      </fieldset>
    </form>
  )
}

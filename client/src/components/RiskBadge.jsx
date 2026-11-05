import { usePreferences } from '../context/PreferencesContext'
import { riskText } from '../utils/transactionDisplay'
export default function RiskBadge({ risk }) {
  const { t } = usePreferences()
  return <span className="status-badge" data-risk={risk}>{riskText(risk, t)}</span>
}

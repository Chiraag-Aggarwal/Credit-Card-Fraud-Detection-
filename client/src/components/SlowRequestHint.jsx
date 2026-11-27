import { useEffect, useState } from 'react'
import { usePreferences } from '../context/PreferencesContext'

function PendingHint() {
  const { t } = usePreferences()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12000)
    return () => clearTimeout(timer)
  }, [])
  if (!slow) return null
  return <p className="text-muted text-sm leading-6" role="status">{t('The service may be starting after inactivity. Keep this page open; your request is still in progress.', 'कुछ समय बंद रहने के बाद सेवा शुरू हो सकती है। यह पेज खुला रखें; आपका अनुरोध अभी जारी है।')}</p>
}

export default function SlowRequestHint({ busy }) {
  return busy ? <PendingHint /> : null
}

import { useCallback, useEffect, useState } from 'react'
import apiClient, { authSession, getApiErrorMessage } from '../api/client'
import { usePreferences } from '../context/PreferencesContext'
import { recoveryCodesFromResponse } from '../utils/accountSecurity'
import FormField from './FormField'
import RecoveryCodesPanel from './RecoveryCodesPanel'
import SlowRequestHint from './SlowRequestHint'

export default function RecoveryCodeSettings() {
  const { t, language } = usePreferences()
  const [remaining, setRemaining] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [codes, setCodes] = useState(null)
  const [error, setError] = useState(null)
  const [missingPassword, setMissingPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const clearCodes = useCallback(() => setCodes(null), [])

  useEffect(() => {
    const controller = new AbortController()
    apiClient.get('/api/auth/security', { signal: controller.signal }).then(({ data }) => {
      if (!Number.isInteger(data?.recoveryCodesRemaining) || data.recoveryCodesRemaining < 0 || data.recoveryCodesRemaining > 8) throw new Error('Invalid recovery status')
      if (!controller.signal.aborted) setRemaining(data.recoveryCodesRemaining)
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [refresh])

  async function generate(event) {
    event.preventDefault()
    setError(null)
    setMissingPassword(!currentPassword)
    if (!currentPassword) return
    setBusy(true)
    const previousToken = authSession.get()
    try {
      const { data } = await apiClient.post('/api/auth/recovery-codes', { currentPassword }, { pinnedAccountSessionToken: previousToken })
      if (authSession.get() !== previousToken) throw new Error('Your session changed. Sign in again to manage recovery codes.')
      setCodes(recoveryCodesFromResponse(data))
      setCurrentPassword('')
      setRemaining(8)
    } catch (requestError) {
      setError(requestError)
    } finally {
      setBusy(false)
    }
  }

  return <section className="ui-card min-w-0 p-6 sm:p-8" aria-labelledby={codes ? undefined : 'recovery-heading'}>
    {codes ? <RecoveryCodesPanel codes={codes} onDone={clearCodes} /> : <>
      <h2 className="text-xl font-bold" id="recovery-heading">{t('Recovery codes', 'रिकवरी कोड')}</h2>
      <p className="text-muted mt-2 text-sm leading-6">{t('Saved recovery codes let you reset a forgotten password. Recovery does not use email. Keep the codes private; anyone with one can reset your password.', 'सुरक्षित रखे रिकवरी कोड से भूला हुआ पासवर्ड रीसेट कर सकते हैं। रिकवरी में ईमेल उपयोग नहीं होता। कोड निजी रखें; जिसके पास कोड होगा वह आपका पासवर्ड रीसेट कर सकता है।')}</p>
      {loading ? <p className="text-muted mt-3 text-sm" role="status">{t('Checking recovery codes…', 'रिकवरी कोड जाँचे जा रहे हैं…')}</p> : loadError ? <div className="status-error mt-4" role="alert">
        <p>{t('Recovery status could not be loaded.', 'रिकवरी की स्थिति नहीं मिल सकी।')}</p>
        <button className="ui-button mt-2" type="button" onClick={() => { setLoading(true); setLoadError(false); setRefresh((value) => value + 1) }}>{t('Retry', 'फिर कोशिश करें')}</button>
      </div> : <p className={remaining === 0 ? 'status-notice mt-4 text-sm' : 'text-muted mt-4 text-sm'}>{remaining === 0 ? t('You have no recovery codes. Generate and save a set before you need them.', 'आपके पास रिकवरी कोड नहीं हैं। ज़रूरत पड़ने से पहले नया सेट बनाकर सुरक्षित रखें।') : t(`${remaining} unused recovery codes remain.`, `${remaining} रिकवरी कोड अभी उपयोग नहीं हुए हैं।`)}</p>}
      <form className="mt-5 space-y-4" onSubmit={generate} noValidate aria-busy={busy}>
        {error && <p className="status-error" role="alert">{getApiErrorMessage(error, t('Could not display new recovery codes. Generate a new set and save it.', 'नए रिकवरी कोड नहीं दिख सके। नया सेट बनाकर सुरक्षित रखें।'), language)}</p>}
        <p className="text-muted text-sm leading-6">{t('Generating a new set immediately replaces every previous recovery code. Save the new set before leaving this page.', 'नया सेट बनाते ही सभी पुराने रिकवरी कोड बंद हो जाएँगे। पेज छोड़ने से पहले नया सेट सुरक्षित रखें।')}</p>
        <fieldset className="space-y-4" disabled={busy}>
          <FormField id="recovery-current-password" label={t('Current password', 'मौजूदा पासवर्ड')} autoComplete="current-password" type="password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setMissingPassword(false); setError(null) }} error={missingPassword && t('Enter your current password.', 'अपना मौजूदा पासवर्ड लिखें।')} />
          <button className="ui-button" type="submit">{busy ? t('Generating codes…', 'कोड बन रहे हैं…') : t('Generate new codes', 'नए कोड बनाएँ')}</button>
        </fieldset>
        <SlowRequestHint busy={busy} />
      </form>
    </>}
  </section>
}

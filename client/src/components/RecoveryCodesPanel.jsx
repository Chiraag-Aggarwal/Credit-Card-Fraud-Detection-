import { useId, useState } from 'react'
import { usePreferences } from '../context/PreferencesContext'

export default function RecoveryCodesPanel({ codes, onDone }) {
  const { t } = usePreferences()
  const id = useId()
  const [saved, setSaved] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')

  function codeFile() {
    return [t('Fraud Detection — account recovery codes', 'धोखाधड़ी पहचान — खाते के रिकवरी कोड'), '',
      t('Keep these codes private. Each code can reset your password once.', 'इन कोड को निजी रखें। हर कोड से पासवर्ड केवल एक बार रीसेट हो सकता है।'),
      t('Generating a new set replaces all previous codes.', 'नया सेट बनाने पर सभी पुराने कोड बंद हो जाते हैं।'), '', ...codes, ''].join('\n')
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(codeFile())
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }

  function downloadCodes() {
    const url = URL.createObjectURL(new Blob([codeFile()], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'fraud-detection-recovery-codes.txt'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section aria-labelledby={id + '-title'} className="min-w-0 space-y-5">
    <h2 id={id + '-title'} className="text-2xl font-bold">{t('Save your recovery codes', 'अपने रिकवरी कोड सुरक्षित रखें')}</h2>
    <p className="text-muted text-sm leading-6">{t('Use one of these codes if you forget your password. Each code works once. Keep them in a password manager or another private place.', 'पासवर्ड भूलने पर इनमें से एक कोड का उपयोग करें। हर कोड केवल एक बार काम करता है। इन्हें पासवर्ड मैनेजर या किसी निजी सुरक्षित जगह पर रखें।')}</p>
    <p className="status-notice text-sm">{t('These codes are shown only now. Leaving or refreshing this page hides them. We cannot email them to you or recover them later.', 'ये कोड केवल अभी दिखाए जा रहे हैं। पेज छोड़ने या रिफ्रेश करने पर ये छिप जाएँगे। हम इन्हें ईमेल नहीं कर सकते और बाद में वापस नहीं दिखा सकते।')}</p>
    <ul aria-label={t('Recovery codes', 'रिकवरी कोड')} className="grid min-w-0 gap-2" dir="ltr">
      {codes.map((code) => <li className="field-input min-w-0 select-all break-all px-3 py-2 font-mono text-xs sm:text-sm" key={code}>{code}</li>)}
    </ul>
    <div className="flex flex-wrap gap-3">
      <button className="ui-button" type="button" onClick={copyCodes}>{t('Copy codes', 'कोड कॉपी करें')}</button>
      <button className="ui-button" type="button" onClick={downloadCodes}>{t('Download codes', 'कोड डाउनलोड करें')}</button>
    </div>
    {copyStatus && <p className={copyStatus === 'copied' ? 'text-muted text-sm' : 'field-error text-sm'} role="status">{copyStatus === 'copied' ? t('Copied. Save the codes somewhere private.', 'कॉपी हो गए। कोड किसी निजी सुरक्षित जगह पर रखें।') : t('Copy was unavailable. Download the codes or select and copy them manually.', 'कॉपी नहीं हो सका। कोड डाउनलोड करें या चुनकर स्वयं कॉपी करें।')}</p>}
    <label className="flex items-start gap-3 text-sm leading-6" htmlFor={id + '-saved'}>
      <input className="mt-1 size-4 shrink-0" id={id + '-saved'} type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
      {t('I have saved these recovery codes in a private place.', 'मैंने ये रिकवरी कोड किसी निजी सुरक्षित जगह पर रख लिए हैं।')}
    </label>
    <button className="ui-button ui-button-primary" type="button" disabled={!saved} onClick={onDone}>{t('Continue', 'आगे बढ़ें')}</button>
  </section>
}

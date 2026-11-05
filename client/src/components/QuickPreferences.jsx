import { usePreferences } from '../context/PreferencesContext'
import Icon from './Icon'

export default function QuickPreferences() {
  const { language, setLanguage, mode, setMode, t } = usePreferences()
  return <div className="quick-preferences">
    <button className="language-toggle" type="button" onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')} aria-label={t('Switch to Hindi', 'अंग्रेज़ी में बदलें')} title={t('Switch to Hindi', 'अंग्रेज़ी में बदलें')}><span lang={language === 'en' ? 'hi' : 'en'}>{language === 'en' ? 'हिन्दी' : 'EN'}</span></button>
    <button className="icon-button" type="button" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-label={t(mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', mode === 'dark' ? 'लाइट मोड चुनें' : 'डार्क मोड चुनें')} title={t(mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', mode === 'dark' ? 'लाइट मोड चुनें' : 'डार्क मोड चुनें')}><Icon name={mode === 'dark' ? 'sun' : 'moon'} /></button>
  </div>
}

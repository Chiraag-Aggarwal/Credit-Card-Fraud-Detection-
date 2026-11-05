import { usePreferences } from '../context/PreferencesContext'

function PreferenceGroup({ name, title, description, value, options, onChange }) {
  return (
    <fieldset className="ui-card min-w-0 space-y-4 p-5 sm:p-6">
      <legend className="sr-only">{title}</legend>
      <div>
        <h2 aria-hidden="true" className="text-lg font-semibold">{title}</h2>
        <p className="text-muted mt-1 text-sm leading-relaxed" id={name + '-description'}>{description}</p>
      </div>
      <div aria-describedby={name + '-description'} className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <label
            className={'preference-option flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border p-3 ' + (value === option.value ? 'preference-option-selected' : '')}
            key={option.value}
          >
            <input
              checked={value === option.value}
              className="h-4 w-4 shrink-0 accent-[var(--accent)]"
              name={name}
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            {option.color && <span aria-hidden="true" className="preference-swatch h-6 w-6 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />}
            <span className="min-w-0">
              <span className="block font-medium" lang={option.lang}>{option.label}</span>
              {option.detail && <span className="text-muted mt-0.5 block text-xs">{option.detail}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export default function SettingsPage() {
  const {
    language, setLanguage, mode, setMode, theme, setTheme,
    fontSize, setFontSize, fontFamily, setFontFamily,
    resetPreferences, storageAvailable, t,
  } = usePreferences()

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('Make it yours', 'अपनी पसंद के अनुसार')}</p>
          <h1 className="page-heading">{t('Appearance & language', 'रूप-रंग और भाषा')}</h1>
          <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
            {t('Choose the look that feels right for you. Changes apply across the website immediately.', 'अपनी पसंद का रूप चुनें। बदलाव पूरी वेबसाइट पर तुरंत लागू होंगे।')}
          </p>
        </div>
        <button className="ui-button" onClick={resetPreferences} type="button">
          {t('Reset appearance', 'डिफ़ॉल्ट रूप वापस लाएँ')}
        </button>
      </header>

      <p aria-live="polite" className={storageAvailable ? 'text-muted text-sm' : 'notice-warning text-sm'} role="status">
        {storageAvailable
          ? t('Your choices are saved automatically in this browser.', 'आपकी पसंद इस ब्राउज़र में अपने आप सुरक्षित हो जाती है।')
          : t('Your browser blocked saving preferences. Your choices will work until you close this page.', 'आपके ब्राउज़र ने सेटिंग सुरक्षित करने से रोक दिया है। आपकी पसंद पेज बंद होने तक काम करेगी।')}
      </p>

      <div className="settings-grid grid items-start gap-4 xl:grid-cols-2">
        <PreferenceGroup
          description={t('Change the language of menus, buttons and messages.', 'मेन्यू, बटन और संदेशों की भाषा बदलें।')}
          name="language"
          onChange={setLanguage}
          options={[
            { value: 'en', label: 'English', detail: t('English interface', 'अंग्रेज़ी में वेबसाइट'), lang: 'en' },
            { value: 'hi', label: 'हिन्दी', detail: t('Hindi interface', 'हिन्दी में वेबसाइट'), lang: 'hi' },
          ]}
          title={t('Text language', 'वेबसाइट की भाषा')}
          value={language}
        />
        <PreferenceGroup
          description={t('Choose a bright workspace or a softer screen for evenings.', 'उजली स्क्रीन या शाम के लिए गहरे रंग की स्क्रीन चुनें।')}
          name="mode"
          onChange={setMode}
          options={[
            { value: 'light', label: t('Light', 'हल्का'), detail: t('Bright and clear', 'उजला और साफ़'), color: '#f0edfa' },
            { value: 'dark', label: t('Dark', 'गहरा'), detail: t('Calm after dark', 'कम रोशनी में आरामदायक'), color: '#292238' },
          ]}
          title={t('Light & dark mode', 'हल्का और गहरा मोड')}
          value={mode}
        />
        <PreferenceGroup
          description={t('Your accent colour is used for buttons, charts and highlights.', 'यह रंग बटन, चार्ट और चुने हुए विकल्पों में दिखेगा।')}
          name="theme"
          onChange={setTheme}
          options={[
            { value: 'lavender', label: t('Lavender', 'बैंगनी'), color: '#7c3aed' },
            { value: 'mint', label: t('Mint', 'हरा'), color: '#087f69' },
            { value: 'ocean', label: t('Ocean', 'नीला'), color: '#2563eb' },
            { value: 'rose', label: t('Rose', 'गुलाबी'), color: '#be185d' },
          ]}
          title={t('Colour theme', 'रंग की थीम')}
          value={theme}
        />
        <PreferenceGroup
          description={t('Make text easier to read. Your browser zoom still works.', 'पढ़ना आसान बनाने के लिए अक्षरों का आकार बदलें। ब्राउज़र का ज़ूम भी काम करेगा।')}
          name="fontSize"
          onChange={setFontSize}
          options={[
            { value: 'small', label: t('Small', 'छोटा') },
            { value: 'medium', label: t('Default', 'सामान्य') },
            { value: 'large', label: t('Large', 'बड़ा') },
          ]}
          title={t('Text size', 'अक्षरों का आकार')}
          value={fontSize}
        />
        <PreferenceGroup
          description={t('Choose a reading style. Hindi uses a compatible font on your device.', 'पढ़ने का अंदाज़ चुनें। हिन्दी के लिए आपके डिवाइस पर उपलब्ध उपयुक्त फ़ॉन्ट इस्तेमाल होगा।')}
          name="fontFamily"
          onChange={setFontFamily}
          options={[
            { value: 'system', label: t('Clean', 'सरल'), detail: t('System sans-serif', 'सरल सिस्टम फ़ॉन्ट') },
            { value: 'serif', label: t('Classic', 'पारंपरिक'), detail: t('Serif', 'सेरिफ़') },
            { value: 'rounded', label: t('Rounded', 'गोल'), detail: t('Soft sans-serif', 'नरम अक्षरों वाला फ़ॉन्ट') },
          ]}
          title={t('Font family', 'अक्षरों की शैली')}
          value={fontFamily}
        />
        <section aria-labelledby="preference-preview-title" className="ui-card preference-preview space-y-4 p-5 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold" id="preference-preview-title">{t('Your live preview', 'आपकी पसंद की झलक')}</h2>
            <p className="text-muted mt-1 text-sm">{t('This preview changes with your settings.', 'यह झलक आपकी सेटिंग के साथ बदलती है।')}</p>
          </div>
          <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm font-semibold">{t('Transaction overview', 'लेन-देन का सारांश')}</p>
            <p className="my-3 text-3xl font-bold">₹1,250.00</p>
            <p className="text-muted text-sm leading-relaxed">{t('Clear information. A workspace that feels like yours.', 'साफ़ जानकारी। आपकी पसंद के अनुसार बना कार्यक्षेत्र।')}</p>
            <span className="ui-button ui-button-primary mt-4 inline-flex" aria-hidden="true">{t('Accent preview', 'रंग की झलक')}</span>
          </div>
          <p className="text-muted text-xs leading-relaxed">{t('Appearance choices stay on this browser. They do not change your transactions or model results.', 'रूप-रंग की पसंद इस ब्राउज़र में रहती है। इससे आपके लेन-देन या मॉडल के नतीजे नहीं बदलते।')}</p>
        </section>
      </div>
    </div>
  )
}

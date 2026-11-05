import { useState } from 'react'
import apiClient, { getApiErrorMessage } from '../api/client'
import Icon from '../components/Icon'
import ModelCard from '../components/ModelCard'
import { usePreferences } from '../context/PreferencesContext'

const FEATURE_COLUMNS = ['Time', ...Array.from({ length: 28 }, (_, index) => 'V' + (index + 1)), 'Amount']
const MAX_ROWS = 100
const SAMPLE_BYTES = 1024 * 1024

function csvError(english, hindi) {
  const error = new Error(english)
  error.translations = [english, hindi]
  return error
}

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quoted && character === '"' && line[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      values.push(value.trim())
      value = ''
    } else {
      value += character
    }
  }

  if (quoted) throw csvError('A CSV row has an unmatched quote.', 'CSV की एक पंक्ति में उद्धरण चिह्न अधूरा है।')
  values.push(value.trim())
  return values
}

async function readFeatureRows(file) {
  if (!file) throw csvError('Choose a CSV file first.', 'पहले CSV फ़ाइल चुनें।')

  // Bound reads even when the user selects the full training dataset.
  const text = await file.slice(0, SAMPLE_BYTES).text()
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) throw csvError('The CSV needs a header row and at least one transaction.', 'CSV में कॉलम के नाम और कम से कम एक लेन-देन होना चाहिए।')

  const header = parseCsvLine(lines[0].replace(/^\uFEFF/, ''))
  if (new Set(header).size !== header.length) throw csvError('The CSV has duplicate column names.', 'CSV में कुछ कॉलम के नाम दो बार हैं।')
  const missing = FEATURE_COLUMNS.filter((name) => !header.includes(name))
  if (missing.length) throw csvError('Missing model columns: ' + missing.join(', '), 'मॉडल के लिए ये कॉलम नहीं मिले: ' + missing.join(', '))

  return lines.slice(1, MAX_ROWS + 1).map((line, rowIndex) => {
    const values = parseCsvLine(line)
    const row = rowIndex + 2
    if (values.length !== header.length) {
      throw csvError('CSV row ' + row + ' does not match the header.', 'CSV की पंक्ति ' + row + ' में कॉलम की संख्या सही नहीं है।')
    }

    const transaction = Object.fromEntries(FEATURE_COLUMNS.map((name) => {
      const rawValue = values[header.indexOf(name)]
      if (rawValue === '') throw csvError('CSV row ' + row + ' is missing ' + name + '.', 'CSV की पंक्ति ' + row + ' में ' + name + ' का मान नहीं है।')
      const value = Number(rawValue)
      if (!Number.isFinite(value)) throw csvError('CSV row ' + row + ' has an invalid ' + name + ' value.', 'CSV की पंक्ति ' + row + ' में ' + name + ' का मान सही संख्या नहीं है।')
      return [name, value]
    }))
    if (transaction.Amount < 0) throw csvError('CSV row ' + row + ' has a negative Amount.', 'CSV की पंक्ति ' + row + ' में Amount शून्य से कम है।')
    return transaction
  })
}

export default function BatchAnalyzerPage() {
  const { t, locale, language } = usePreferences()
  const [file, setFile] = useState(null)
  const [items, setItems] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [modelVersion, setModelVersion] = useState('')
  const isMockMode = import.meta.env.VITE_USE_MOCK === 'true'

  async function analyze(event) {
    event.preventDefault()
    setError(null)
    setItems([])
    setLoading(true)
    try {
      const transactions = await readFeatureRows(file)
      const { data } = await apiClient.post('/api/predictions/batch', { transactions })
      setItems(data.items)
      setModelVersion(data.items[0]?.modelVersion || '')
    } catch (requestError) {
      setError(requestError)
    } finally {
      setLoading(false)
    }
  }

  const formatProbability = (value) => value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)
  const flaggedCount = items.filter((item) => item.isFlagged).length
  const riskText = (value) => ({ LOW: t('LOW', 'कम'), MEDIUM: t('MEDIUM', 'मध्यम'), HIGH: t('HIGH', 'अधिक'), UNSCORED: t('UNSCORED', 'स्कोर नहीं') }[value] || value)
  const errorMessage = error?.translations
    ? t(...error.translations)
    : error ? getApiErrorMessage(error, t('Could not read or score these transactions. Check your CSV and try again.', 'लेन-देन पढ़े नहीं जा सके या स्कोर नहीं मिला। CSV जाँचकर फिर कोशिश करें।'), language) : ''

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('Model workspace', 'मॉडल का कार्यक्षेत्र')}</p>
          <h1 className="page-heading">{t('Batch AI analysis', 'बैच AI विश्लेषण')}</h1>
          <p className="text-muted mt-2 text-sm leading-relaxed">{t('Analyse transaction data and understand the model’s risk predictions.', 'लेन-देन के डेटा का विश्लेषण करें और मॉडल के जोखिम अनुमान समझें।')}</p>
        </div>
        <span className="status-badge">{t('Up to 100 transactions', 'अधिकतम 100 लेन-देन')}</span>
      </header>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
        <form aria-busy={loading} className="ui-card min-w-0 p-5 sm:p-6" onSubmit={analyze}>
          <h2 className="text-xl font-bold">{t('Transaction data', 'लेन-देन का डेटा')}</h2>
          <p className="text-muted mt-2 text-sm leading-relaxed">{t('Choose a CSV file with Time, V1–V28 and Amount columns. A Class column is allowed but ignored.', 'Time, V1–V28 और Amount कॉलम वाली CSV फ़ाइल चुनें। Class कॉलम हो सकता है, लेकिन उसे इस्तेमाल नहीं किया जाता।')}</p>
          <div className="batch-upload mt-5 flex min-w-0 flex-col items-center gap-4 rounded-2xl border border-dashed p-6 text-center">
            <span className="accent-icon"><Icon name="upload" size={30} /></span>
            <div>
              <h3 className="font-semibold">{t('Upload transaction CSV', 'लेन-देन की CSV अपलोड करें')}</h3>
              <p className="text-muted mt-1 text-xs">{t('Only the first 100 rows are sent for analysis.', 'विश्लेषण के लिए केवल पहली 100 पंक्तियाँ भेजी जाती हैं।')}</p>
            </div>
            <input
              accept=".csv,text/csv"
              aria-describedby="csv-guidance"
              className="peer sr-only"
              disabled={loading}
              id="batch-csv"
              onChange={(event) => { setFile(event.target.files?.[0] || null); setItems([]); setError(null) }}
              type="file"
            />
            <label className="ui-button cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4" htmlFor="batch-csv">{t('Choose CSV file', 'CSV फ़ाइल चुनें')}</label>
            <p className="text-muted max-w-full break-all text-xs">{file ? file.name : t('No file selected', 'कोई फ़ाइल नहीं चुनी गई')}</p>
          </div>
          <p className="text-muted mt-3 text-xs leading-relaxed" id="csv-guidance">{t('Results are temporary. This does not add transactions to your payment history.', 'नतीजे अस्थायी हैं। इससे आपके भुगतान इतिहास में लेन-देन नहीं जुड़ते।')}</p>
          {isMockMode && <p className="status-notice mt-4 text-sm" role="status">{t('Mock mode: these scores are examples, not predictions from the trained model.', 'मॉक मोड: ये स्कोर केवल उदाहरण हैं, प्रशिक्षित मॉडल के अनुमान नहीं।')}</p>}
          {errorMessage && <p className="status-error mt-4 text-sm" role="alert">{errorMessage}</p>}
          <button className="ui-button ui-button-primary mt-5 w-full sm:w-auto" disabled={loading || !file} type="submit">
            <Icon name="layers" size={18} />{loading ? t('Scoring transactions…', 'लेन-देन का स्कोर बन रहा है…') : t('Analyse CSV sample', 'CSV का विश्लेषण करें')}
          </button>
        </form>
        <ModelCard />
      </div>

      <section aria-labelledby="batch-results-title" className="ui-card min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div>
            <h2 className="text-xl font-bold" id="batch-results-title">{t('Analysis results', 'विश्लेषण के नतीजे')}</h2>
            <p className="text-muted mt-1 text-sm">{items.length ? t(items.length + ' transactions scored', items.length + ' लेन-देन को स्कोर मिला') : t('Your results will appear here.', 'आपके नतीजे यहाँ दिखेंगे।')}</p>
          </div>
          {items.length > 0 && <p className="text-muted text-sm">{t(flaggedCount + ' flagged', flaggedCount + ' जाँच के लिए चिह्नित')} · {modelVersion}</p>}
        </div>
        {items.length > 0 ? (
          <div aria-label={t('Batch analysis results', 'बैच विश्लेषण के नतीजे')} className="table-scroll" tabIndex={0}>
            <table className="data-table min-w-[620px]">
              <thead><tr>
                <th scope="col">{t('CSV row', 'CSV पंक्ति')}</th>
                <th scope="col">{t('Fraud probability', 'धोखाधड़ी की संभावना')}</th>
                <th scope="col">{t('Risk', 'जोखिम')}</th>
                <th scope="col">{t('Decision', 'निर्णय')}</th>
              </tr></thead>
              <tbody>{items.map((item) => (
                <tr key={item.index}>
                  <td>{item.index + 2}</td>
                  <td className="font-semibold">{formatProbability(item.fraudProbability)}</td>
                  <td><span className="status-badge" data-risk={item.riskLabel}>{riskText(item.riskLabel)}</span></td>
                  <td className="text-muted">{item.isFlagged ? t('Review as potential fraud', 'संभावित धोखाधड़ी के लिए जाँचें') : t('Below model threshold', 'मॉडल की सीमा से कम')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state p-8 text-center" role="status">
            <Icon className="mx-auto" name="layers" size={32} />
            <p className="mt-3 font-semibold">{loading ? t('Analysing your sample…', 'आपके डेटा का विश्लेषण हो रहा है…') : t('Ready when you are', 'विश्लेषण के लिए तैयार')}</p>
            <p className="text-muted mt-1 text-sm">{t('Select a CSV file above to start.', 'शुरू करने के लिए ऊपर CSV फ़ाइल चुनें।')}</p>
          </div>
        )}
        <p className="text-muted px-5 py-4 text-xs sm:px-6">{t('A risk score supports review; it does not prove fraud.', 'जोखिम स्कोर जाँच में मदद करता है; यह धोखाधड़ी का प्रमाण नहीं है।')}</p>
      </section>
    </div>
  )
}

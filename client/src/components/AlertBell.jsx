import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import apiClient from '../api/client'
import { usePreferences } from '../context/PreferencesContext'

export default function AlertBell() {
  const { t } = usePreferences()
  const [count, setCount] = useState(0)

  useEffect(() => {
    let active = true

    async function loadUnreadCount() {
      try {
        const { data } = await apiClient.get('/api/alerts/unread-count')
        if (active) setCount(Number.isFinite(data.count) ? Math.max(0, data.count) : 0)
      } catch {
        if (active) setCount(0)
      }
    }

    void loadUnreadCount()
    const intervalId = window.setInterval(loadUnreadCount, 15000)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [])

  const label =
    count > 0 ? t('Flagged transactions, ' + count + ' unread', 'संदिग्ध लेनदेन, ' + count + ' अपठित') : t('Flagged transactions', 'संदिग्ध लेनदेन')

  return (
    <Link
      aria-label={label}
      className="icon-button"
      title={label}
      to="/flagged"
    >
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
      {count > 0 && (
        <span
          aria-hidden="true"
          className="alert-count"
        >
          {count}
        </span>
      )}
    </Link>
  )
}

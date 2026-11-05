import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../context/PreferencesContext'

export default function ProtectedRoute() {
  const { user, loading } = useAuth()
  const { t } = usePreferences()
  const location = useLocation()

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <p className="ui-card text-muted p-6 text-sm font-medium" role="status">
          {t('Checking your session…', 'आपका लॉगिन जाँचा जा रहा है…')}
        </p>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

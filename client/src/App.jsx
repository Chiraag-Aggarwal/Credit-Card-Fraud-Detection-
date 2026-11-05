import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { lazy, Suspense, useEffect } from 'react'
import { usePreferences } from './context/PreferencesContext'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const BatchAnalyzerPage = lazy(() => import('./pages/BatchAnalyzerPage'))
const FlaggedTransactionsPage = lazy(() => import('./pages/FlaggedTransactionsPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

export default function App() {
  const { t } = usePreferences()
  useEffect(() => { document.title = t('Fraud Detection | Payment risk console', 'धोखाधड़ी पहचान | भुगतान जोखिम केंद्र') }, [t])
  return (
    <Suspense fallback={<div className="page-loading" role="status">{t('Opening your workspace…', 'आपका कार्यक्षेत्र खुल रहा है…')}</div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="flagged" element={<FlaggedTransactionsPage />} />
          <Route path="analyze" element={<BatchAnalyzerPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}

import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import AlertBell from './AlertBell'
import Icon from './Icon'
import QuickPreferences from './QuickPreferences'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../context/PreferencesContext'

const isMockMode = import.meta.env.VITE_USE_MOCK === 'true'

export default function Layout() {
  const { user, logout } = useAuth()
  const { t } = usePreferences()
  const navigate = useNavigate()
  const links = [
    { to: '/', icon: 'dashboard', label: t('Dashboard', 'डैशबोर्ड'), short: t('Overview', 'सारांश') },
    { to: '/flagged', icon: 'flag', label: t('Flagged transactions', 'संदिग्ध लेनदेन'), short: t('Flagged', 'संदिग्ध') },
    { to: '/analyze', icon: 'layers', label: t('Batch AI analysis', 'बैच AI विश्लेषण'), short: t('Analyse', 'विश्लेषण') },
    { to: '/profile', icon: 'user', label: t('My profile', 'मेरी प्रोफ़ाइल'), short: t('Profile', 'प्रोफ़ाइल') },
    { to: '/settings', icon: 'settings', label: t('Appearance', 'दिखावट'), short: t('Settings', 'सेटिंग्स') },
  ]
  const initials = (user?.name || user?.email || 'U').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  function handleLogout() { logout(); navigate('/login', { replace: true }) }

  return <div className="app-backdrop">
    <a className="skip-link" href="#main-content">{t('Skip to content', 'मुख्य सामग्री पर जाएँ')}</a>
    <div className="app-frame">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label={t('Fraud Detection dashboard', 'धोखाधड़ी पहचान डैशबोर्ड')}><span className="brand-mark"><Icon name="shield" size={34} /></span><span><strong>{t('Fraud Detection', 'धोखाधड़ी पहचान')}</strong><small>{t('Payment risk console', 'भुगतान जोखिम केंद्र')}</small></span></NavLink>
        <p className="nav-caption">{t('WORKSPACE', 'कार्यस्थल')}</p>
        <nav aria-label={t('Main navigation', 'मुख्य नेविगेशन')} className="desktop-nav">{links.map(link => <NavLink key={link.to} to={link.to} end={link.to === '/'} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}><Icon name={link.icon} /><span>{link.label}</span></NavLink>)}</nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><span className="status-dot" /><span>{t('A clearer view of risk.', 'जोखिम की साफ़ समझ।')}</span></div>
          <button className="nav-link" type="button" onClick={handleLogout}><Icon name="logout" /><span>{t('Log out', 'लॉग आउट')}</span></button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title"><Icon name="shield" /><span>{t('Payment risk console', 'भुगतान जोखिम केंद्र')}</span></div>
          <div className="topbar-actions">
            {isMockMode && <span className="mock-badge" role="status">{t('Mock data', 'डेमो डेटा')}</span>}
            <QuickPreferences />
            <AlertBell />
            <NavLink className="profile-link" to="/profile" aria-label={t('Edit your profile', 'अपनी प्रोफ़ाइल बदलें')}><span className="avatar">{initials}</span><span className="profile-name">{user?.name || user?.email}</span></NavLink>
          </div>
        </header>
        <main className="workspace-content" id="main-content" tabIndex={-1}><Outlet /></main>
        <footer className="workspace-footer"><Icon name="shield" size={14} />{t('Fraud Detection · Student project', 'धोखाधड़ी पहचान · विद्यार्थी प्रोजेक्ट')}</footer>
      </div>
    </div>
    <nav className="mobile-nav" aria-label={t('Mobile navigation', 'मोबाइल नेविगेशन')}>{links.map(link => <NavLink key={link.to} to={link.to} end={link.to === '/'} className={({ isActive }) => 'mobile-nav-link' + (isActive ? ' active' : '')}><Icon name={link.icon} /><span>{link.short}</span></NavLink>)}</nav>
  </div>
}

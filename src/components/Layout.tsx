import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { BarChart3, Bell, BookOpen, CalendarCheck, Camera, ChevronLeft, ClipboardList, GraduationCap, LayoutDashboard, LogOut, Menu, Moon, QrCode, Search, Settings, ShieldCheck, Sun, Users, X } from 'lucide-react'
import { ClassroomSelect } from './ClassroomSelect'
import CommandPalette from './CommandPalette'
import { useAuth } from '../contexts/AuthContext'
import { initials } from '../lib/utils'

const sections = [
  {
    label: 'Classroom',
    links: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/classrooms', label: 'My Classrooms', icon: BookOpen },
      { to: '/scan', label: 'Scan Attendance', icon: Camera },
      { to: '/students', label: 'Students', icon: Users },
      { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
      { to: '/qr-codes', label: 'QR Codes', icon: QrCode },
      { to: '/excuses', label: 'Excuses', icon: ClipboardList },
    ],
  },
  {
    label: 'Insights',
    links: [
      { to: '/notifications', label: 'Notifications', icon: Bell },
      { to: '/reports', label: 'Reports', icon: BarChart3 },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Account',
    links: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
]

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : ''
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const navSections = profile?.role === 'admin'
    ? sections.map(s => s.label === 'Account' ? { ...s, links: [...s.links, { to: '/admin', label: 'Users', icon: ShieldCheck }] } : s)
    : sections
  const [open, setOpen] = useState(false)
  const { dark, toggle } = useTheme()

  return (
    <div className="app-shell">
      <button className="mobile-menu" onClick={() => setOpen(true)}><Menu /></button>
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark small"><GraduationCap /></div>
          <span>Attendly</span>
          <button className="close-menu" onClick={() => setOpen(false)}><X /></button>
        </div>
        <div className="sidebar-classroom">
          <span>ACTIVE CLASSROOM</span>
          <ClassroomSelect />
        </div>
        <button className="palette-hint" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}>
          <Search size={15} /><span>Quick search</span><kbd>⌘K</kbd>
        </button>
        <nav>
          {navSections.map((s) => (
            <div className="nav-section" key={s.label}>
              <span className="nav-label">{s.label}</span>
              {s.links.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>
                  <Icon size={18} /><span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <NavLink to="/profile" className="user-card">
            <div className="avatar">{initials(profile?.full_name)}</div>
            <div><strong>{profile?.full_name || 'Teacher'}</strong><span>{profile?.email}</span></div>
            <ChevronLeft size={16} />
          </NavLink>
          <div className="footer-actions">
            <button onClick={toggle}>{dark ? <Sun size={18} /> : <Moon size={18} />}{dark ? 'Light mode' : 'Dark mode'}</button>
            <button onClick={() => void signOut()}><LogOut size={18} />Log out</button>
          </div>
        </div>
      </aside>
      <main className="main-content"><Outlet /></main>
      <CommandPalette />
    </div>
  )
}

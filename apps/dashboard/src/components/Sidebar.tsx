'use client'
// src/components/Sidebar.tsx
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/',            icon: '◈', label: 'Overview' },
  { href: '/wealth',      icon: '◎', label: 'Wealth' },
  { href: '/cards',       icon: '◉', label: 'Cards' },
  { href: '/gambling',    icon: '◇', label: 'Gambling' },
  { href: '/health',      icon: '◌', label: 'Bot Health' },
  { href: '/leaderboard', icon: '△', label: 'Leaderboard' },
  { href: '/control',     icon: '◈', label: 'Control' },
]

export default function Sidebar() {
  const path = usePathname()
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h1>TENSURA</h1>
        <p>domination dashboard</p>
      </div>
      <nav className="nav-section">
        {nav.map(({ href, icon, label }) => (
          <Link
            key={href}
            href={href}
            className={`nav-link ${path === href ? 'active' : ''}`}
          >
            <span className="nav-icon">{icon}</span>
            {label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-footer">
        <p style={{ fontSize: 11, color: 'var(--muted)' }}>
          <span className="live-dot" />
          live data
        </p>
      </div>
    </aside>
  )
}

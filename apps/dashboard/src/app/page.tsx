'use client'
// src/app/page.tsx — Overview
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Health { group_id: string; platform: string; status: string; bot_name: string; last_bot_msg: string }
interface Stats  { total_coins: number; cards_claimed: number; bets_won: number; bets_lost: number }

export default function Overview() {
  const [health, setHealth]   = useState<Health[]>([])
  const [stats, setStats]     = useState<Stats>({ total_coins: 0, cards_claimed: 0, bets_won: 0, bets_lost: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()

    const sub = supabase
      .channel('overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bot_health' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gambling_events' }, load)
      .subscribe()

    return () => { supabase.removeChannel(sub) }
  }, [])

  async function load() {
    const [h, ge, ce, dc] = await Promise.all([
      supabase.from('bot_health').select('*').order('platform'),
      supabase.from('gambling_events').select('outcome, payout'),
      supabase.from('card_events').select('outcome').eq('outcome', 'claimed'),
      supabase.from('daily_claims').select('amount').order('timestamp', { ascending: false }).limit(30),
    ])

    setHealth(h.data ?? [])

    const events = ge.data ?? []
    const wins   = events.filter(e => e.outcome === 'win').length
    const losses = events.filter(e => e.outcome === 'loss').length
    const coins  = (dc.data ?? []).reduce((sum, d) => sum + (d.amount ?? 0), 0)

    setStats({
      total_coins:   coins,
      cards_claimed: ce.data?.length ?? 0,
      bets_won:      wins,
      bets_lost:     losses,
    })
    setLoading(false)
  }

  const online  = health.filter(h => h.status === 'online').length
  const offline = health.filter(h => h.status === 'offline').length
  const winRate = stats.bets_won + stats.bets_lost > 0
    ? Math.round((stats.bets_won / (stats.bets_won + stats.bets_lost)) * 100)
    : 0

  return (
    <>
      <div className="page-header">
        <h2>Overview</h2>
        <p><span className="live-dot" />live · updates in real-time</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Groups Online</div>
          <div className={`stat-value ${offline > 0 ? 'yellow' : 'green'}`}>{online} / {health.length}</div>
          <div className="stat-sub">{offline > 0 ? `${offline} offline` : 'all systems go'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Daily Coins (30d)</div>
          <div className="stat-value">${stats.total_coins.toLocaleString()}</div>
          <div className="stat-sub">from daily claims</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cards Claimed</div>
          <div className="stat-value">{stats.cards_claimed}</div>
          <div className="stat-sub">total all time</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Win Rate</div>
          <div className={`stat-value ${winRate >= 50 ? 'green' : 'red'}`}>{winRate}%</div>
          <div className="stat-sub">{stats.bets_won}W / {stats.bets_lost}L</div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-header">
          <span className="table-title">Bot Status — All Groups</span>
        </div>
        {loading ? (
          <div className="empty">Loading...</div>
        ) : health.length === 0 ? (
          <div className="empty">No groups synced yet. Start the WhatsApp bot first.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Group ID</th>
                <th>Platform</th>
                <th>Bot</th>
                <th>Status</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {health.map(h => (
                <tr key={h.group_id + h.platform}>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>{h.group_id.slice(0, 20)}…</td>
                  <td><span className="platform-badge">{h.platform}</span></td>
                  <td>{h.bot_name ?? '—'}</td>
                  <td><span className={`badge ${h.status}`}>{h.status}</span></td>
                  <td style={{ color: 'var(--muted)' }}>
                    {h.last_bot_msg ? new Date(h.last_bot_msg).toLocaleTimeString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

'use client'
// src/app/health/page.tsx
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Health() {
  const [health, setHealth] = useState<any[]>([])

  useEffect(() => {
    load()
    const sub = supabase
      .channel('health-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bot_health' }, load)
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [])

  async function load() {
    const { data } = await supabase.from('bot_health').select('*').order('platform').order('updated_at', { ascending: false })
    setHealth(data ?? [])
  }

  const online      = health.filter(h => h.status === 'online').length
  const suspicious  = health.filter(h => h.status === 'suspicious').length
  const offline     = health.filter(h => h.status === 'offline').length

  function timeSince(ts: string | null): string {
    if (!ts) return '—'
    const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
    if (secs < 60)   return `${secs}s ago`
    if (secs < 3600) return `${Math.floor(secs/60)}m ago`
    return `${Math.floor(secs/3600)}h ago`
  }

  return (
    <>
      <div className="page-header">
        <h2>Bot Health</h2>
        <p>Per-group status and connectivity</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Online</div>
          <div className="stat-value green">{online}</div>
          <div className="stat-sub">groups responding</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Suspicious</div>
          <div className="stat-value" style={{color:'var(--yellow)'}}>{suspicious}</div>
          <div className="stat-sub">ping sent, waiting</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Offline</div>
          <div className="stat-value red">{offline}</div>
          <div className="stat-sub">no response</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Groups</div>
          <div className="stat-value">{health.length}</div>
          <div className="stat-sub">both platforms</div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-header"><span className="table-title">Group Status</span></div>
        <table>
          <thead>
            <tr>
              <th>Group ID</th>
              <th>Platform</th>
              <th>Bot</th>
              <th>Status</th>
              <th>Last Bot Msg</th>
              <th>Last Activity</th>
              <th>Avg Ping</th>
            </tr>
          </thead>
          <tbody>
            {health.map((h, i) => (
              <tr key={i}>
                <td style={{color:'var(--muted)',fontSize:11}}>{h.group_id.slice(0,22)}…</td>
                <td><span className="platform-badge">{h.platform}</span></td>
                <td style={{fontFamily:'DM Sans'}}>{h.bot_name ?? '—'}</td>
                <td><span className={`badge ${h.status}`}>{h.status}</span></td>
                <td style={{color: h.status !== 'online' ? 'var(--red)' : 'var(--muted)'}}>
                  {timeSince(h.last_bot_msg)}
                </td>
                <td style={{color:'var(--muted)'}}>{timeSince(h.last_cmd_seen)}</td>
                <td style={{color:'var(--muted)'}}>{h.avg_ping_ms ? `${h.avg_ping_ms}ms` : '—'}</td>
              </tr>
            ))}
            {health.length === 0 && <tr><td colSpan={7} className="empty">No groups tracked yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

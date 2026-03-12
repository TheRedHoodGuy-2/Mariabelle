'use client'
// src/app/wealth/page.tsx
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Wealth() {
  const [daily, setDaily]     = useState<any[]>([])
  const [fishing, setFishing] = useState<any[]>([])
  const [digging, setDigging] = useState<any[]>([])
  const [passive, setPassive] = useState<any[]>([])

  useEffect(() => { load() }, [])

  async function load() {
    const [d, f, dig, p] = await Promise.all([
      supabase.from('daily_claims').select('*').order('timestamp', { ascending: false }).limit(50),
      supabase.from('fishing_events').select('*').order('timestamp', { ascending: false }).limit(50),
      supabase.from('dig_events').select('*').order('timestamp', { ascending: false }).limit(50),
      supabase.from('passive_income_events').select('*').order('timestamp', { ascending: false }).limit(50),
    ])
    setDaily(d.data ?? [])
    setFishing(f.data ?? [])
    setDigging(dig.data ?? [])
    setPassive(p.data ?? [])
  }

  const totalDaily   = daily.reduce((s, d) => s + (d.amount ?? 0) + (d.streak_bonus ?? 0), 0)
  const totalFish    = fishing.reduce((s, f) => s + (f.coins_earned ?? 0), 0)
  const totalDig     = digging.reduce((s, d) => s + (d.value ?? 0), 0)
  const totalPassive = passive.reduce((s, p) => s + (p.amount ?? 0), 0)

  return (
    <>
      <div className="page-header">
        <h2>Wealth</h2>
        <p>Income tracking across all sources</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Daily Claims</div>
          <div className="stat-value">${totalDaily.toLocaleString()}</div>
          <div className="stat-sub">{daily.length} claims</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Fishing</div>
          <div className="stat-value">${totalFish.toLocaleString()}</div>
          <div className="stat-sub">{fishing.filter(f => f.catch_type !== 'nothing').length} catches</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Digging</div>
          <div className="stat-value">${totalDig.toLocaleString()}</div>
          <div className="stat-sub">{digging.filter(d => d.result_type === 'coins').length} finds</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Passive Income</div>
          <div className="stat-value">${totalPassive.toLocaleString()}</div>
          <div className="stat-sub">{passive.length} drops</div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-header"><span className="table-title">Recent Daily Claims</span></div>
        <table>
          <thead><tr><th>Time</th><th>Platform</th><th>Amount</th><th>Streak Bonus</th><th>Streak</th></tr></thead>
          <tbody>
            {daily.slice(0, 20).map((d, i) => (
              <tr key={i}>
                <td style={{color:'var(--muted)'}}>{new Date(d.timestamp).toLocaleString()}</td>
                <td><span className="platform-badge">{d.platform}</span></td>
                <td className="green">${(d.amount ?? 0).toLocaleString()}</td>
                <td>{d.streak_bonus ? `+$${d.streak_bonus.toLocaleString()}` : '—'}</td>
                <td>{d.streak_count ?? '—'}</td>
              </tr>
            ))}
            {daily.length === 0 && <tr><td colSpan={5} className="empty">No claims yet</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <div className="table-header"><span className="table-title">Recent Fishing</span></div>
        <table>
          <thead><tr><th>Time</th><th>Platform</th><th>Result</th><th>Coins</th></tr></thead>
          <tbody>
            {fishing.slice(0, 15).map((f, i) => (
              <tr key={i}>
                <td style={{color:'var(--muted)'}}>{new Date(f.timestamp).toLocaleString()}</td>
                <td><span className="platform-badge">{f.platform}</span></td>
                <td><span className={`badge ${f.catch_type === 'nothing' ? 'loss' : 'win'}`}>{f.catch_type}</span></td>
                <td>{f.coins_earned ? `$${f.coins_earned.toLocaleString()}` : '—'}</td>
              </tr>
            ))}
            {fishing.length === 0 && <tr><td colSpan={4} className="empty">No fishing events yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

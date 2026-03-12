'use client'
// src/app/leaderboard/page.tsx
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface PlayerStats {
  player_id:   string
  platform:    string
  total_bets:  number
  wins:        number
  losses:      number
  win_rate:    number
  total_pnl:   number
}

export default function Leaderboard() {
  const [players, setPlayers] = useState<PlayerStats[]>([])
  const [tab, setTab]         = useState<'whatsapp' | 'discord'>('whatsapp')

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase
      .from('gambling_events')
      .select('player_id, platform, outcome, payout, bet_amount')

    if (!data) return

    // Aggregate by player
    const map = new Map<string, PlayerStats>()
    for (const e of data) {
      const key = e.player_id + ':' + e.platform
      const p   = map.get(key) ?? {
        player_id: e.player_id, platform: e.platform,
        total_bets: 0, wins: 0, losses: 0, win_rate: 0, total_pnl: 0,
      }
      p.total_bets++
      if (e.outcome === 'win')  p.wins++
      if (e.outcome === 'loss') p.losses++
      p.total_pnl += (e.payout ?? 0)
      map.set(key, p)
    }

    const all = [...map.values()].map(p => ({
      ...p,
      win_rate: p.wins + p.losses > 0 ? Math.round(p.wins / (p.wins + p.losses) * 100) : 0,
    })).sort((a, b) => b.total_pnl - a.total_pnl)

    setPlayers(all)
  }

  const filtered = players.filter(p => p.platform === tab)

  return (
    <>
      <div className="page-header">
        <h2>Leaderboard</h2>
        <p>Top gamblers ranked by profit/loss</p>
      </div>

      {/* Platform tabs */}
      <div style={{display:'flex', gap:8, marginBottom:24}}>
        {(['whatsapp','discord'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 16px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: tab === t ? 'var(--text)' : 'var(--surface)',
              color: tab === t ? 'white' : 'var(--muted)',
              fontFamily: 'DM Mono, monospace',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >{t}</button>
        ))}
      </div>

      <div className="table-wrap">
        <div className="table-header"><span className="table-title">{tab} — by profit</span></div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player ID</th>
              <th>Bets</th>
              <th>W / L</th>
              <th>Win Rate</th>
              <th>Total P&L</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => (
              <tr key={i}>
                <td style={{color:'var(--muted)'}}>{i + 1}</td>
                <td style={{fontSize:11, color:'var(--muted)'}}>{p.player_id.slice(0, 20)}…</td>
                <td>{p.total_bets}</td>
                <td>{p.wins} / {p.losses}</td>
                <td>
                  <span className={`badge ${p.win_rate >= 50 ? 'win' : 'loss'}`}>
                    {p.win_rate}%
                  </span>
                </td>
                <td className={p.total_pnl >= 0 ? 'green' : 'red'} style={{fontWeight:500}}>
                  {p.total_pnl >= 0 ? '+' : ''}${p.total_pnl.toLocaleString()}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="empty">No gambling data yet for {tab}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

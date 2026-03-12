'use client'
// src/app/gambling/page.tsx
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Gambling() {
  const [events, setEvents]     = useState<any[]>([])
  const [decisions, setDecisions] = useState<any[]>([])

  useEffect(() => {
    load()
    const sub = supabase
      .channel('gambling')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gambling_events' }, load)
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [])

  async function load() {
    const [e, d] = await Promise.all([
      supabase.from('gambling_events').select('*').order('timestamp', { ascending: false }).limit(100),
      supabase.from('ai_decisions').select('*').eq('decision_type', 'gambling').order('created_at', { ascending: false }).limit(20),
    ])
    setEvents(e.data ?? [])
    setDecisions(d.data ?? [])
  }

  const wins     = events.filter(e => e.outcome === 'win')
  const losses   = events.filter(e => e.outcome === 'loss')
  const totalPnl = events.reduce((s, e) => s + (e.payout ?? 0), 0)
  const winRate  = wins.length + losses.length > 0
    ? Math.round(wins.length / (wins.length + losses.length) * 100) : 0
  const avgBet   = events.length > 0
    ? Math.round(events.reduce((s, e) => s + (e.bet_amount ?? 0), 0) / events.length) : 0

  return (
    <>
      <div className="page-header">
        <h2>Gambling</h2>
        <p>Bet history and AI decision log</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total P&L</div>
          <div className={`stat-value ${totalPnl >= 0 ? 'green' : 'red'}`}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString()}
          </div>
          <div className="stat-sub">{events.length} bets tracked</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Win Rate</div>
          <div className={`stat-value ${winRate >= 50 ? 'green' : 'red'}`}>{winRate}%</div>
          <div className="stat-sub">{wins.length}W / {losses.length}L</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Bet</div>
          <div className="stat-value">${avgBet.toLocaleString()}</div>
          <div className="stat-sub">per round</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">AI Executed</div>
          <div className="stat-value">{decisions.filter(d => d.executed).length}</div>
          <div className="stat-sub">{decisions.filter(d => !d.executed).length} skipped</div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-header"><span className="table-title">Bet History</span></div>
        <table>
          <thead>
            <tr><th>Time</th><th>Platform</th><th>Game</th><th>Bet</th><th>Guess</th><th>Outcome</th><th>P&L</th></tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i}>
                <td style={{color:'var(--muted)'}}>{new Date(e.timestamp).toLocaleString()}</td>
                <td><span className="platform-badge">{e.platform}</span></td>
                <td>.{e.game}</td>
                <td>${(e.bet_amount ?? 0).toLocaleString()}</td>
                <td style={{color:'var(--muted)'}}>{e.guess ?? '—'}</td>
                <td><span className={`badge ${e.outcome}`}>{e.outcome}</span></td>
                <td className={e.payout >= 0 ? 'green' : 'red'}>
                  {e.payout >= 0 ? '+' : ''}${(e.payout ?? 0).toLocaleString()}
                </td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={7} className="empty">No bets yet</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <div className="table-header"><span className="table-title">AI Decision Log</span></div>
        <table>
          <thead>
            <tr><th>Time</th><th>Confidence</th><th>Executed</th><th>Latency</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {decisions.map((d, i) => (
              <tr key={i}>
                <td style={{color:'var(--muted)'}}>{new Date(d.created_at).toLocaleString()}</td>
                <td>{Math.round((d.confidence ?? 0) * 100)}%</td>
                <td>
                  <span className={`badge ${d.executed ? 'win' : 'loss'}`}>
                    {d.executed ? 'yes' : 'skip'}
                  </span>
                </td>
                <td style={{color:'var(--muted)'}}>{d.latency_ms ? `${d.latency_ms}ms` : '—'}</td>
                <td style={{color:'var(--muted)',fontFamily:'DM Sans',fontSize:12}}>
                  {d.skip_reason ?? (d.recommendation as any)?.reasoning ?? '—'}
                </td>
              </tr>
            ))}
            {decisions.length === 0 && <tr><td colSpan={5} className="empty">No AI decisions yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

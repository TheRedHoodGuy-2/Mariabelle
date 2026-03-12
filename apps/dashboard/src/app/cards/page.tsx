'use client'
// src/app/cards/page.tsx
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Cards() {
  const [cards, setCards] = useState<any[]>([])

  useEffect(() => {
    load()
    const sub = supabase
      .channel('cards')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'card_events' }, load)
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [])

  async function load() {
    const { data } = await supabase
      .from('card_events').select('*')
      .order('spawn_time', { ascending: false }).limit(100)
    setCards(data ?? [])
  }

  const claimed = cards.filter(c => c.outcome === 'claimed').length
  const missed  = cards.filter(c => c.outcome === 'missed').length
  const pending = cards.filter(c => !c.outcome).length
  const rate    = claimed + missed > 0 ? Math.round(claimed / (claimed + missed) * 100) : 0

  return (
    <>
      <div className="page-header">
        <h2>Cards</h2>
        <p>Spawn detection and claim tracking</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Claim Rate</div>
          <div className={`stat-value ${rate >= 60 ? 'green' : 'red'}`}>{rate}%</div>
          <div className="stat-sub">{claimed} claimed / {missed} missed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Spawns</div>
          <div className="stat-value">{cards.length}</div>
          <div className="stat-sub">{pending} unresolved</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Claim Time</div>
          <div className="stat-value">
            {cards.filter(c => c.delay_ms).length > 0
              ? `${Math.round(cards.filter(c => c.delay_ms).reduce((s, c) => s + c.delay_ms, 0) / cards.filter(c => c.delay_ms).length / 1000)}s`
              : '—'}
          </div>
          <div className="stat-sub">humanised delay</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tier S Caught</div>
          <div className="stat-value green">{cards.filter(c => c.tier === 99 && c.outcome === 'claimed').length}</div>
          <div className="stat-sub">highest tier</div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-header"><span className="table-title">Card Spawns</span></div>
        <table>
          <thead>
            <tr>
              <th>Card</th>
              <th>Tier</th>
              <th>Platform</th>
              <th>Price</th>
              <th>Outcome</th>
              <th>Delay</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c, i) => (
              <tr key={i}>
                <td style={{fontFamily:'DM Sans',fontWeight:500}}>{c.card_name ?? '—'}</td>
                <td>{c.tier === 99 ? 'S' : (c.tier ?? '—')}</td>
                <td><span className="platform-badge">{c.platform}</span></td>
                <td>{c.price ? `$${c.price.toLocaleString()}` : '—'}</td>
                <td>
                  {c.outcome
                    ? <span className={`badge ${c.outcome === 'claimed' ? 'win' : 'loss'}`}>{c.outcome}</span>
                    : <span className="badge draw">pending</span>}
                </td>
                <td style={{color:'var(--muted)'}}>{c.delay_ms ? `${(c.delay_ms/1000).toFixed(1)}s` : '—'}</td>
                <td style={{color:'var(--muted)'}}>{new Date(c.spawn_time).toLocaleString()}</td>
              </tr>
            ))}
            {cards.length === 0 && <tr><td colSpan={7} className="empty">No card spawns detected yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

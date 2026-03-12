'use client'
// src/app/control/page.tsx
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Control() {
  const [config, setConfig]   = useState<any>(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('gambling_config').select('*').limit(1).single()
    if (data) setConfig(data)
  }

  async function save() {
    if (!config) return
    setSaving(true)
    await supabase.from('gambling_config').update({
      gambling_enabled: config.gambling_enabled,
      max_bets_per_day: config.max_bets_per_day,
      bet_percentage:   config.bet_percentage,
      min_confidence:   config.min_confidence,
    }).eq('id', config.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!config) return <div className="empty">Loading config...</div>

  return (
    <>
      <div className="page-header">
        <h2>Control</h2>
        <p>Adjust bot behaviour. Changes apply immediately.</p>
      </div>

      <div className="control-grid">
        {/* Gambling toggle */}
        <div className="control-card">
          <h3>Gambling</h3>
          <p>Enable or disable autonomous betting across all groups</p>
          <div className="toggle-row">
            <span style={{fontFamily:'DM Mono', fontSize:13}}>
              {config.gambling_enabled ? 'enabled' : 'disabled'}
            </span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={config.gambling_enabled}
                onChange={e => setConfig({ ...config, gambling_enabled: e.target.checked })}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        {/* Max bets per day */}
        <div className="control-card">
          <h3>Max Bets / Day</h3>
          <p>Hard limit on daily bets. Resets at midnight.</p>
          <div className="range-wrap">
            <div className="range-row">
              <span className="muted" style={{fontSize:12}}>0</span>
              <span className="range-val">{config.max_bets_per_day}</span>
              <span className="muted" style={{fontSize:12}}>50</span>
            </div>
            <input
              type="range" min={0} max={50} step={1}
              value={config.max_bets_per_day}
              onChange={e => setConfig({ ...config, max_bets_per_day: parseInt(e.target.value) })}
            />
          </div>
        </div>

        {/* Bet size */}
        <div className="control-card">
          <h3>Bet Size</h3>
          <p>Percentage of current balance per bet</p>
          <div className="range-wrap">
            <div className="range-row">
              <span className="muted" style={{fontSize:12}}>5%</span>
              <span className="range-val">{Math.round(config.bet_percentage * 100)}%</span>
              <span className="muted" style={{fontSize:12}}>50%</span>
            </div>
            <input
              type="range" min={5} max={50} step={1}
              value={Math.round(config.bet_percentage * 100)}
              onChange={e => setConfig({ ...config, bet_percentage: parseInt(e.target.value) / 100 })}
            />
          </div>
        </div>

        {/* Min confidence */}
        <div className="control-card">
          <h3>AI Min Confidence</h3>
          <p>AI must be at least this confident to place a bet</p>
          <div className="range-wrap">
            <div className="range-row">
              <span className="muted" style={{fontSize:12}}>50%</span>
              <span className="range-val">{Math.round(config.min_confidence * 100)}%</span>
              <span className="muted" style={{fontSize:12}}>95%</span>
            </div>
            <input
              type="range" min={50} max={95} step={1}
              value={Math.round(config.min_confidence * 100)}
              onChange={e => setConfig({ ...config, min_confidence: parseInt(e.target.value) / 100 })}
            />
          </div>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        style={{
          background: saved ? 'var(--green)' : 'var(--text)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius)',
          padding: '10px 28px',
          fontFamily: 'DM Mono, monospace',
          fontSize: 13,
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.6 : 1,
          transition: 'all 0.2s',
        }}
      >
        {saved ? '✓ saved' : saving ? 'saving...' : 'save changes'}
      </button>
    </>
  )
}

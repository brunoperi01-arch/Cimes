import { useState } from 'react'

const CATEGORIES = ['Résidence', 'Particulier', 'Hôtel']
const PLATFORMS  = ['Booking.com', 'Airbnb', 'Direct', 'Autre']

export function CollectPage({ selWeekId, cap, onSaveRate, formSaved }) {
  const [competitor, setCompetitor] = useState('')
  const [price,      setPrice]      = useState('')
  const [category,   setCategory]   = useState('Résidence')
  const [platform,   setPlatform]   = useState('Booking.com')

  async function handleSubmit(e) {
    e.preventDefault()
    await onSaveRate({
      week_id:    selWeekId,
      capacity:   parseInt(cap, 10),
      competitor,
      price:      Number(price),
      category,
      platform
    })
    setCompetitor('')
    setPrice('')
  }

  return (
    <div style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Saisie manuelle</h1>

      <form onSubmit={handleSubmit}>

        {/* Catégorie */}
        <label style={labelStyle}>Catégorie</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat} type="button"
              onClick={() => setCategory(cat)}
              style={{
                flex: 1, padding: '9px 4px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                border: category === cat ? '2px solid #1D4ED8' : '1px solid #D1D5DB',
                background: category === cat ? '#EFF6FF' : 'white',
                color: category === cat ? '#1D4ED8' : '#374151',
                cursor: 'pointer'
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Plateforme */}
        <label style={labelStyle}>Plateforme</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {PLATFORMS.map(p => (
            <button
              key={p} type="button"
              onClick={() => setPlatform(p)}
              style={{
                flex: 1, padding: '9px 4px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                border: platform === p ? '2px solid #059669' : '1px solid #D1D5DB',
                background: platform === p ? '#ECFDF5' : 'white',
                color: platform === p ? '#059669' : '#374151',
                cursor: 'pointer'
              }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Nom concurrent */}
        <label style={labelStyle}>Nom du concurrent</label>
        <input
          value={competitor}
          onChange={e => setCompetitor(e.target.value)}
          placeholder="ex: Labellemontagne Central Park"
          required
          style={inputStyle}
        />

        {/* Prix */}
        <label style={labelStyle}>Prix / semaine (€)</label>
        <input
          value={price}
          onChange={e => setPrice(e.target.value)}
          placeholder="ex: 750"
          type="number"
          required
          style={inputStyle}
        />

        {/* Feedback */}
        {formSaved === 'ok'        && <p style={{ color: '#059669', fontSize: 13, marginBottom: 8 }}>✓ Tarif enregistré.</p>}
        {formSaved === 'duplicate' && <p style={{ color: '#D97706', fontSize: 13, marginBottom: 8 }}>⚠ Tarif déjà existant.</p>}
        {formSaved === 'error'     && <p style={{ color: '#EF4444', fontSize: 13, marginBottom: 8 }}>✗ Erreur d'enregistrement.</p>}

        <button type="submit" style={buttonStyle}>Enregistrer</button>
      </form>
    </div>
  )
}

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '.05em',
  color: '#6B7280', marginBottom: 6
}
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: 12, marginBottom: 16,
  borderRadius: 10, border: '1px solid #D1D5DB',
  fontSize: 14
}
const buttonStyle = {
  width: '100%', padding: 13, borderRadius: 12,
  border: 'none', background: '#111827',
  color: 'white', fontWeight: 700, fontSize: 15,
  cursor: 'pointer'
}

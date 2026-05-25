import { useState } from 'react'

export function CollectPage({ selWeekId, cap, onSaveRate, formSaved }) {
  const [competitor, setCompetitor] = useState('')
  const [price, setPrice] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()

    await onSaveRate({
      week_id: selWeekId,
      capacity: parseInt(cap, 10),
      competitor,
      price: Number(price)
    })

    setCompetitor('')
    setPrice('')
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Saisie tarif</h1>

      <form onSubmit={handleSubmit}>
        <input
          value={competitor}
          onChange={e => setCompetitor(e.target.value)}
          placeholder="Concurrent"
          required
          style={inputStyle}
        />

        <input
          value={price}
          onChange={e => setPrice(e.target.value)}
          placeholder="Prix"
          type="number"
          required
          style={inputStyle}
        />

        {formSaved === 'ok' && <p style={{ color: 'green' }}>Tarif enregistré.</p>}
        {formSaved === 'duplicate' && <p style={{ color: 'orange' }}>Tarif déjà existant.</p>}
        {formSaved === 'error' && <p style={{ color: 'red' }}>Erreur d’enregistrement.</p>}

        <button type="submit" style={buttonStyle}>
          Enregistrer
        </button>
      </form>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 12,
  marginBottom: 12,
  borderRadius: 10,
  border: '1px solid #D1D5DB'
}

const buttonStyle = {
  width: '100%',
  padding: 13,
  borderRadius: 12,
  border: 'none',
  background: '#111827',
  color: 'white',
  fontWeight: 700
}

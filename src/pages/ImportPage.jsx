import { useState } from 'react'

export function ImportPage({ onImportCsv, lastImportStats }) {
  const [csvText, setCsvText] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleImport() {
    setLoading(true)

    try {
      await onImportCsv(csvText)
      setCsvText('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Import CSV</h1>

      <textarea
        value={csvText}
        onChange={e => setCsvText(e.target.value)}
        placeholder="Colle ici le contenu CSV"
        style={textareaStyle}
      />

      <button onClick={handleImport} disabled={loading || !csvText.trim()} style={buttonStyle}>
        {loading ? 'Import…' : 'Importer'}
      </button>

      {lastImportStats && (
        <div style={cardStyle}>
          <h2>Dernier import</h2>
          <pre>{JSON.stringify(lastImportStats, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

const textareaStyle = {
  width: '100%',
  height: 220,
  boxSizing: 'border-box',
  padding: 12,
  borderRadius: 12,
  border: '1px solid #D1D5DB',
  marginBottom: 12
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

const cardStyle = {
  background: 'white',
  padding: 16,
  borderRadius: 16,
  marginTop: 16,
  border: '1px solid #E5E7EB'
}

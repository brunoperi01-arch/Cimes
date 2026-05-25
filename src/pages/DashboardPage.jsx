export function DashboardPage({ onNavigate, selWeek, cap, reco, rates }) {
  return (
    <div style={{ padding: 24 }}>
      <h1>Dashboard</h1>

      <p style={{ color: '#6B7280' }}>
        Outil de suivi tarifaire Les Cimes du Val d’Allos
      </p>

      <div style={cardStyle}>
        <h2>Semaine sélectionnée</h2>
        <p>{selWeek?.label || selWeek?.id || 'Aucune semaine'}</p>
        <p>Capacité : {cap}</p>
      </div>

      <div style={cardStyle}>
        <h2>Recommandation</h2>
        <p>Prix conseillé : {reco?.recommendedPrice ?? reco?.price ?? '—'} €</p>
        <p>Tarifs concurrents : {rates?.length || 0}</p>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <button style={buttonStyle} onClick={() => onNavigate('weeks')}>
          Voir les semaines
        </button>

        <button style={buttonStyle} onClick={() => onNavigate('collect')}>
          Saisie manuelle
        </button>

        <button style={buttonStyle} onClick={() => onNavigate('import')}>
          Import CSV
        </button>

        <button style={buttonStyle} onClick={() => onNavigate('diag')}>
          Diagnostic
        </button>
      </div>
    </div>
  )
}

const cardStyle = {
  background: 'white',
  padding: 16,
  borderRadius: 16,
  margin: '16px 0',
  border: '1px solid #E5E7EB'
}

const buttonStyle = {
  padding: 13,
  borderRadius: 12,
  border: 'none',
  background: '#111827',
  color: 'white',
  fontWeight: 700
}

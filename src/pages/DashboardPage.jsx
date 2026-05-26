export function DashboardPage({
  onNavigate,
  selWeek,
  cap,
  reco,
  rates,
  ratesLoading,
  imports,
  sbReady
}) {
  const recommendedPrice =
    reco?.recommendedPrice ??
    reco?.recommended_price ??
    reco?.price ??
    reco?.targetPrice ??
    reco?.target_price ??
    reco?.finalPrice ??
    reco?.final_price ??
    null

  return (
    <div style={{ padding: 24 }}>
      <h1>Dashboard</h1>

      <p style={{ color: '#6B7280', lineHeight: 1.5 }}>
        Outil de suivi tarifaire Les Cimes du Val d’Allos
      </p>

      <div style={cardStyle}>
        <h2>Semaine sélectionnée</h2>
        <p style={bigTextStyle}>
          {selWeek?.label || selWeek?.id || 'Aucune semaine'}
        </p>
        <p>Capacité : {cap}</p>
      </div>

      <div style={cardStyle}>
        <h2>Recommandation</h2>

        <p style={priceStyle}>
          {recommendedPrice !== null ? `${recommendedPrice} €` : '— €'}
        </p>

        <p style={{ color: '#6B7280' }}>
          Tarifs concurrents : {rates?.length || 0}
        </p>

        {ratesLoading && (
          <p style={{ color: '#6B7280' }}>
            Chargement des tarifs…
          </p>
        )}
      </div>

      <div style={cardStyle}>
        <h2>État de la base</h2>

        <p>
          Supabase :{' '}
          <strong style={{ color: sbReady ? '#15803D' : '#B91C1C' }}>
            {sbReady ? 'connecté' : 'non configuré'}
          </strong>
        </p>

        <p>
          Imports enregistrés : {imports?.length || 0}
        </p>
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

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: 'pointer', color: '#6B7280' }}>
          Voir le détail technique
        </summary>

        <pre style={preStyle}>
          {JSON.stringify({ reco, rates }, null, 2)}
        </pre>
      </details>
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

const bigTextStyle = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 8
}

const priceStyle = {
  fontSize: 30,
  fontWeight: 800,
  margin: '10px 0'
}

const buttonStyle = {
  padding: 13,
  borderRadius: 12,
  border: 'none',
  background: '#111827',
  color: 'white',
  fontWeight: 700,
  cursor: 'pointer'
}

const preStyle = {
  background: '#111827',
  color: 'white',
  padding: 12,
  borderRadius: 12,
  overflow: 'auto',
  fontSize: 12
}

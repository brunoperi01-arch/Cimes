export function WeekDetailPage({
  onNavigate,
  selWeek,
  cap,
  rates,
  reco,
  onRateDeleted
}) {
  return (
    <div style={{ padding: 24 }}>
      <button onClick={() => onNavigate('weeks')} style={backStyle}>
        ← Retour
      </button>

      <h1>{selWeek?.label || selWeek?.id}</h1>
      <p style={{ color: '#6B7280' }}>Capacité : {cap}</p>

      <div style={cardStyle}>
        <h2>Recommandation</h2>
        <p>Prix conseillé : {reco?.recommendedPrice ?? reco?.price ?? '—'} €</p>
      </div>

      <div style={cardStyle}>
        <h2>Tarifs concurrents</h2>

        {!rates?.length && <p>Aucun tarif concurrent enregistré.</p>}

        {rates?.map((rate, index) => (
          <div key={rate.id || index} style={rateStyle}>
            <strong>{rate.competitor || rate.name || 'Concurrent'}</strong>
            <span>{rate.price || rate.amount || '—'} €</span>
          </div>
        ))}
      </div>

      <button onClick={onRateDeleted} style={buttonStyle}>
        Recharger les tarifs
      </button>
    </div>
  )
}

const backStyle = {
  border: 'none',
  background: 'transparent',
  color: '#2563EB',
  marginBottom: 12
}

const cardStyle = {
  background: 'white',
  padding: 16,
  borderRadius: 16,
  marginBottom: 16,
  border: '1px solid #E5E7EB'
}

const rateStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid #E5E7EB'
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

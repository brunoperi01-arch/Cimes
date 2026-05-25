export function DiagnosticPage({ user, sbErrors, imports, rates }) {
  return (
    <div style={{ padding: 24 }}>
      <h1>Diagnostic</h1>

      <div style={cardStyle}>
        <h2>Utilisateur</h2>
        <p>{user?.email || 'Non connecté'}</p>
      </div>

      <div style={cardStyle}>
        <h2>Imports</h2>
        <p>{imports?.length || 0} import(s)</p>
      </div>

      <div style={cardStyle}>
        <h2>Tarifs</h2>
        <p>{rates?.length || 0} tarif(s) chargé(s)</p>
      </div>

      <div style={cardStyle}>
        <h2>Erreurs Supabase</h2>
        {!sbErrors?.length && <p>Aucune erreur détectée.</p>}

        {sbErrors?.map((err, index) => (
          <p key={index} style={{ color: 'red' }}>
            {String(err)}
          </p>
        ))}
      </div>
    </div>
  )
}

const cardStyle = {
  background: 'white',
  padding: 16,
  borderRadius: 16,
  marginBottom: 16,
  border: '1px solid #E5E7EB'
}

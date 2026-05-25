import { WEEKS_ALL } from '../constants/weeks'

export function WeeksPage({ onSelectWeek, yr, setYr, cap, setCap }) {
  const weeks = WEEKS_ALL.filter(w => String(w.id).includes(String(yr)))

  return (
    <div style={{ padding: 24 }}>
      <h1>Semaines</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select value={yr} onChange={e => setYr(Number(e.target.value))} style={selectStyle}>
          <option value={2026}>2026</option>
          <option value={2027}>2027</option>
        </select>

        <select value={cap} onChange={e => setCap(e.target.value)} style={selectStyle}>
          <option value="4p">4 personnes</option>
          <option value="6p">6 personnes</option>
          <option value="8p">8 personnes</option>
        </select>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {weeks.map(week => (
          <button
            key={week.id}
            onClick={() => onSelectWeek(week.id)}
            style={weekButtonStyle}
          >
            <strong>{week.label || week.id}</strong>
            <span style={{ color: '#6B7280' }}>
              {week.season_type || ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

const selectStyle = {
  flex: 1,
  padding: 10,
  borderRadius: 10,
  border: '1px solid #D1D5DB'
}

const weekButtonStyle = {
  background: 'white',
  border: '1px solid #E5E7EB',
  borderRadius: 14,
  padding: 14,
  textAlign: 'left',
  display: 'flex',
  justifyContent: 'space-between'
}

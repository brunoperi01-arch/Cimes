// ══════════════════════════════════════════════════════════════════
// src/components/PeriodSelector.jsx
// Sélecteur de période contrôlé (value + onChange en props).
// Présentationnel : reçoit la liste des périodes et le label formaté.
// ══════════════════════════════════════════════════════════════════
import { periodOptionLabel } from "../utils/dates.js";

export default function PeriodSelector({
  value, onChange, periods = [], season = null,
  placeholder = "Choisir une période…", style = {},
}) {
  const list = season ? periods.filter(p => p.season === season) : periods;
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={style}>
      <option value="">{placeholder}</option>
      {list.map(p => (
        <option key={p.id} value={p.id}>{periodOptionLabel(p)}</option>
      ))}
    </select>
  );
}

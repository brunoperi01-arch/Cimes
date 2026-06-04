// ══════════════════════════════════════════════════════════════════
// src/components/ApartmentTypeSelector.jsx
// Sélecteur de typologie d'appartement (2P6 / 2P6_SUP / 3P6 / 3P8).
// Contrôlé via value + onChange. Option "Toutes typologies" optionnelle.
// ══════════════════════════════════════════════════════════════════
import { ACCOMMODATION_ORDER, ACCOMMODATION_SHORT } from "../domain/accommodations.js";

export default function ApartmentTypeSelector({
  value, onChange, style = {}, allowAll = false,
  allLabel = "Toutes typologies",
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={style}>
      {allowAll && <option value="">{allLabel}</option>}
      {ACCOMMODATION_ORDER.map(a => (
        <option key={a} value={a}>{ACCOMMODATION_SHORT[a]}</option>
      ))}
    </select>
  );
}

// ══════════════════════════════════════════════════════════════════
// src/components/AlertCard.jsx
// Carte d'alerte présentationnelle. Reçoit une alerte (du moteur
// d'alertes), sa méta de niveau, le helper de style cd et un callback.
// ══════════════════════════════════════════════════════════════════
import { C } from "./theme.js";
import Badge from "./Badge.jsx";

export default function AlertCard({ alert, meta, cd, onAction }) {
  return (
    <div style={{ ...cd(11), padding: "10px 13px", marginBottom: 7, borderLeft: `3px solid ${meta.color}`, background: meta.bg }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{meta.icon} {alert.title}</p>
        <Badge label={meta.label} color={meta.color} bg={C.white} size={10} />
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: C.text, lineHeight: 1.4 }}>{alert.explanation}</p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: meta.color, fontWeight: 600, lineHeight: 1.4 }}>→ {alert.action}</p>
      {alert.screen && (
        <button onClick={() => onAction?.(alert.screen)} style={{ marginTop: 7, fontSize: 11, fontWeight: 700, color: C.white, background: meta.color, border: "none", borderRadius: 7, padding: "5px 11px", cursor: "pointer" }}>
          Voir
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// src/components/BottomNav.jsx
// Barre de navigation mobile (5 modules). Présentationnel : reçoit la
// liste des modules, l'id actif et un callback de sélection.
// ══════════════════════════════════════════════════════════════════
import { C } from "./theme.js";

export default function BottomNav({ modules = [], activeId, onSelect }) {
  return (
    <div style={{ position: "sticky", bottom: 0, background: C.white, borderTop: `0.5px solid ${C.grayM}`, display: "flex", padding: "6px 0 16px", zIndex: 10 }}>
      {modules.map(m => {
        const on = activeId === m.id;
        return (
          <button key={m.id} onClick={() => onSelect(m)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <span style={{ fontSize: 16 }}>{m.icon}</span>
            <span style={{ fontSize: 11, fontWeight: on ? 700 : 400, color: on ? C.blue : C.gray }}>{m.l}</span>
          </button>
        );
      })}
    </div>
  );
}

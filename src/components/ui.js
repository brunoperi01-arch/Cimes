// ══════════════════════════════════════════════════════════════════
// src/components/ui.js
// Fabrique de styles inline partagés (cartes, grilles, inputs, boutons…).
// Paramétrée par isMobile pour rester responsive. Utilise la palette C.
//
// Usage dans App / pages :
//   const { card, cnt, responsiveGrid, btn, inp, sml, tabB, cd, rw, formGrid } = makeStyles(isMobile);
// ══════════════════════════════════════════════════════════════════
import { C } from "./theme.js";

export function makeStyles(isMobile) {
  const cnt = { padding: isMobile ? "0 14px 80px" : "0 18px 24px" };

  const responsiveGrid = (cols = 2) => ({
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : `repeat(${cols}, minmax(0, 1fr))`,
    gap: isMobile ? 8 : 14,
    alignItems: "start",
  });

  const formGrid = { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 };

  const card = (extra = {}) => ({
    background: C.white, borderRadius: 14, border: `0.5px solid ${C.grayM}`,
    padding: isMobile ? "12px" : "14px 16px",
    boxShadow: "0 1px 3px rgba(16,24,40,0.04)", boxSizing: "border-box", ...extra,
  });

  const cd = (r = 14, mb = 8) => ({ background: C.white, borderRadius: r, overflow: "hidden", marginBottom: mb });

  const rw = (last) => ({ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 13px", borderBottom: last ? "none" : `0.5px solid ${C.grayL}` });

  const btn = (dis, bg = C.blue, fg = C.white) => ({ width: "100%", padding: "12px", fontSize: 14, fontWeight: 600, background: dis ? "#C7C7CC" : bg, color: fg, border: "none", borderRadius: 11, cursor: dis ? "not-allowed" : "pointer", marginBottom: 6 });

  const sml = { fontSize: 12, fontWeight: 700, color: C.gray, margin: "12px 2px 5px", letterSpacing: "0.06em", textTransform: "uppercase" };

  const inp = (extra = {}) => ({ width: "100%", padding: "9px 11px", fontSize: 14, border: `1px solid ${C.grayM}`, borderRadius: 9, background: C.white, color: C.text, boxSizing: "border-box", ...extra });

  const tabB = (a) => ({ flex: 1, padding: "9px 2px", fontSize: 13, fontWeight: a ? 700 : 400, background: a ? C.white : "transparent", color: a ? C.blue : C.gray, border: "none", borderRadius: 8, cursor: "pointer" });

  return { cnt, responsiveGrid, formGrid, card, cd, rw, btn, sml, inp, tabB };
}

// ══════════════════════════════════════════════════════════════════
// src/utils/money.js
// Utilitaires monétaires / numériques — purs, testables hors React.
// ══════════════════════════════════════════════════════════════════

// Formate un nombre en français ("1 234"). Renvoie "—" si non numérique.
export const fmt = n => (typeof n === "number" ? n.toLocaleString("fr-FR") : "—");

// Formate un pourcentage signé ("+12%", "-4%").
export const fmtPct = n => (n >= 0 ? "+" : "") + Math.round(n) + "%";

// Médiane d'un tableau de nombres (entier arrondi pour une paire). null si vide.
export function median(arr) {
  if (!arr || !arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Pourcentage d'écart (part/total), arrondi. null si total nul.
export function gapPct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

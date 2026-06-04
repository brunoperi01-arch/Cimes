// ══════════════════════════════════════════════════════════════════
// src/utils/dates.js
// Utilitaires de dates — purs, sans dépendance (testables hors React).
//
// RÈGLE MÉTIER IMPORTANTE : pour les dates de séjour, ne jamais utiliser
// toISOString() directement sur une Date locale (décalage de fuseau).
// On passe toujours par ces helpers, qui ancrent à 12:00:00Z.
// ══════════════════════════════════════════════════════════════════

// Construit une date ISO "YYYY-MM-DD" à partir de composants (m est 0-indexé)
export function dateISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Date JS → "YYYY-MM-DD" (sans décalage de fuseau)
export function dateObjToISO(date) {
  return dateISO(date.getFullYear(), date.getMonth(), date.getDate());
}

// Compare deux dates sur leur partie "YYYY-MM-DD" uniquement
export function sameDate(a, b) {
  return String(a || "").slice(0, 10) === String(b || "").slice(0, 10);
}

// Ajoute (ou retire) des jours à une date "YYYY-MM-DD"
export function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "YYYY-MM-DD" → "12 août"
export function fmtDateShort(dateStr) {
  if (!dateStr) return "";
  const mns = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
  const d = new Date(dateStr + "T12:00:00Z");
  return `${d.getUTCDate()} ${mns[d.getUTCMonth()]}`;
}

// Libellé d'une période : "12 août → 19 août · 7 nuits"
export function periodOptionLabel(p) {
  const start = p.period_start || p.week_start;
  const nights = Number(p.stay_nights || 7);
  const end = p.period_end || addDaysStr(start, nights);
  return `${fmtDateShort(start)} → ${fmtDateShort(end)} · ${nights} nuits`;
}

// Date de relevé → "JJ/MM/AAAA"
export function fmtCollected(s) {
  if (!s) return "—";
  const d = String(s).slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : String(s).slice(0, 10);
}

// Nombre de jours entre deux dates "YYYY-MM-DD" (>= 0)
export function daysBetween(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start + "T12:00:00");
  const b = new Date(end + "T12:00:00");
  return Math.max(0, Math.round((b - a) / 86400000));
}

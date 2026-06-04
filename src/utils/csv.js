// ══════════════════════════════════════════════════════════════════
// src/utils/csv.js
// Utilitaires CSV — purs, testables hors React.
// Gèrent le séparateur ; ou , et les guillemets simples.
// ══════════════════════════════════════════════════════════════════

// Détecte le séparateur d'une ligne d'en-tête (";" prioritaire, sinon ",")
export function detectSeparator(headerLine) {
  return String(headerLine || "").includes(";") ? ";" : ",";
}

// Découpe une valeur de cellule (retire guillemets et espaces de bord)
function cleanCell(v) {
  return String(v ?? "").trim().replace(/^"|"$/g, "");
}

// Parse un texte CSV → { headers: string[], rows: Array<Record<string,string>>, sep }
// headers sont normalisés en minuscules. Lève une erreur si vide.
export function parseCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV vide ou sans données.");
  const sep = detectSeparator(lines[0]);
  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase());
  const rows = lines.slice(1).map(line => {
    const cells = line.split(sep).map(cleanCell);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
    return obj;
  });
  return { headers, rows, sep };
}

// Parse un nombre tolérant (virgule décimale FR, espaces). 0 si invalide.
export function parseCsvNumber(value) {
  if (value == null || value === "") return 0;
  const n = parseFloat(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
}

// Sérialise un tableau d'objets en CSV (sépare par ;). headers explicites optionnels.
export function toCsv(rows, headers, sep = ";") {
  const cols = headers || (rows[0] ? Object.keys(rows[0]) : []);
  const head = cols.join(sep);
  const body = (rows || []).map(r => cols.map(c => {
    const v = r[c] ?? "";
    const s = String(v);
    return s.includes(sep) || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(sep)).join("\n");
  return head + "\n" + body;
}

// Déclenche le téléchargement d'un CSV dans le navigateur (no-op hors navigateur).
export function downloadCsv(filename, content) {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

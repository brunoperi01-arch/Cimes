// ══════════════════════════════════════════════════════════════════
// src/services/periodsService.js
// Lecture du référentiel des périodes depuis Supabase (table periods).
// Repli sur la liste fournie par le code (fallbackPeriods) si hors-ligne
// ou si la base ne renvoie rien.
//
// Le service renvoie les périodes au FORMAT ATTENDU PAR L'UI (mêmes clés
// que l'ancienne constante ALL_PERIODS), pour ne rien casser :
//   id, week_start, period_start, period_end, season, stay_nights,
//   season_type, label, subtitle
// ══════════════════════════════════════════════════════════════════
import { sb, SB_READY } from "./supabaseClient.js";

// Adapte une ligne Supabase (table periods) au format UI historique.
function toUiShape(row) {
  return {
    id:           row.period_id,           // l'UI utilise des ids texte (clé métier)
    uuid:         row.id,                   // uuid réel (utile si besoin)
    week_start:   row.period_start,
    period_start: row.period_start,
    period_end:   row.period_end,
    season:       row.season,
    stay_nights:  row.stay_nights,
    season_type:  row.category,             // haute/moyenne/basse
    label:        row.label,
    subtitle:     row.label,
    display_order: row.display_order,
  };
}

// Charge toutes les périodes actives, triées. Repli sur fallback si vide/HS.
export async function getPeriods(fallbackPeriods = []) {
  if (SB_READY) {
    try {
      const rows = await sb.select("periods", "is_active=eq.true&order=display_order.asc&select=*");
      if (rows && rows.length) return rows.map(toUiShape);
    } catch (e) {
      console.warn("getPeriods Supabase:", e?.message);
    }
  }
  return fallbackPeriods;
}

// ══════════════════════════════════════════════════════════════════
// src/domain/accommodations.js
// Typologies commerciales Les Cimes (2P6 / 2P6_SUP / 3P6 / 3P8).
// Source unique de vérité + mapping/migration + tarifs de repli.
// Pur (la seule dépendance est utils/dates pour findRateForGridCell).
// ══════════════════════════════════════════════════════════════════
import { addDaysStr, sameDate } from "../utils/dates.js";

export const ACCOMMODATION_TYPES = {
  "2P6":     { code:"2P6",     label:"2 pièces 6 pers.",            short:"2P6",     capacity:6, surfaceMin:34, surfaceMax:45, targetMin:2, targetMax:4, comfort:"budget_famille",        segment:"6p_budget"  },
  "2P6_SUP": { code:"2P6_SUP", label:"2 pièces 6 pers. supérieur",  short:"2P6 Sup", capacity:6, surfaceMin:42, surfaceMax:45, targetMin:4, targetMax:6, comfort:"confort_intermediaire", segment:"6p_confort" },
  "3P6":     { code:"3P6",     label:"3 pièces 6 pers.",            short:"3P6",     capacity:6, surfaceMin:42, surfaceMax:45, targetMin:4, targetMax:6, comfort:"confort",              segment:"6p_confort" },
  "3P8":     { code:"3P8",     label:"3 pièces 8 pers.",            short:"3P8",     capacity:8, surfaceMin:57, surfaceMax:57, targetMin:6, targetMax:8, comfort:"famille_premium",      segment:"8p_famille" },
};
// Ordre d'affichage canonique
export const ACCOMMODATION_ORDER = ["2P6", "2P6_SUP", "3P6", "3P8"];
// Libellés courts dérivés de la config (plus de map séparée à maintenir)
export const ACCOMMODATION_SHORT = Object.fromEntries(ACCOMMODATION_ORDER.map(k => [k, ACCOMMODATION_TYPES[k].short]));
// Capacités réellement vendues, déduites des typologies (remplace FILTER_CAPACITIES)
export const ACCOMMODATION_CAPACITIES = Array.from(new Set(ACCOMMODATION_ORDER.map(k => ACCOMMODATION_TYPES[k].capacity))).sort((a, b) => a - b); // [6, 8]
// Capacités proposées dans les filtres concurrents (le marché inclut des biens 2/4 pers.)
export const FILTER_CAPACITIES = [2, 4, 6, 8];
// Typologies disponibles pour une capacité donnée
export function accommodationTypesForCapacity(capacity) {
  const c = Number(capacity);
  return ACCOMMODATION_ORDER.filter(k => ACCOMMODATION_TYPES[k].capacity === c);
}
// Typologie par défaut pour une capacité (1re de l'ordre canonique)
export function defaultAccommodationForCapacity(capacity) {
  return accommodationTypesForCapacity(capacity)[0] || ACCOMMODATION_ORDER[0];
}
// MIGRATION/MAPPING : ancienne catégorie générique (capacité "2p/4p/6p/8p"
// ou nombre 2/4/6/8) → typologie commerciale. Best-effort, pour compat ascendante.
export function migrateCapacityToAccommodation(legacy) {
  if (legacy == null) return "";
  const s = String(legacy).trim().toUpperCase();
  // Déjà une vraie typologie ?
  const norm = normalizeAccommodationType(s);
  if (norm) return norm;
  // Forme "6P" / "6p" / "6" / "6 pers."
  const m = s.match(/(\d+)/);
  if (!m) return "";
  const cap = Number(m[1]);
  if (cap <= 6) return "2P6";   // 2/4/6 pers historiques → 2P6 (offre de base 6 pers.)
  if (cap >= 8) return "3P8";   // 8 pers → 3P8
  return defaultAccommodationForCapacity(cap);
}
// Métadonnées d'une typologie (sécurisé)
export function accommodationMeta(type) {
  return ACCOMMODATION_TYPES[normalizeAccommodationType(type) || type] || null;
}

// Tarif interne de repli, indexé PAR TYPOLOGIE (remplace OUR_TARIFS 2p/4p/6p/8p).
// Utilisé uniquement comme fallback quand aucune ligne our_rates n'existe.
export const OUR_TARIFS_BY_TYPE = {
  "2P6":     { haute:428, moyenne:340, basse:259 },
  "2P6_SUP": { haute:455, moyenne:365, basse:280 },
  "3P6":     { haute:455, moyenne:365, basse:280 },
  "3P8":     { haute:489, moyenne:390, basse:290 },
};
// Compat : ancien OUR_TARIFS par capacité, dérivé de la table par typologie.
// (Conservé pour ne pas casser les appels existants OUR_TARIFS["6p"] / OUR_TARIFS[6].)
export const OUR_TARIFS = (() => {
  const out = {};
  for (const cap of ACCOMMODATION_CAPACITIES) {
    const t = OUR_TARIFS_BY_TYPE[defaultAccommodationForCapacity(cap)];
    out[`${cap}p`] = t; out[cap] = t;
  }
  // Capacités historiques sans typologie propre → repli sur le 2P6
  out["2p"] = out["2p"] || OUR_TARIFS_BY_TYPE["2P6"];
  out["4p"] = out["4p"] || OUR_TARIFS_BY_TYPE["2P6"];
  out[2] = out[2] || OUR_TARIFS_BY_TYPE["2P6"];
  out[4] = out[4] || OUR_TARIFS_BY_TYPE["2P6"];
  return out;
})();
// Tarif de repli par typologie + saison
export function fallbackTarifForType(accommodationType, seasonType) {
  const t = OUR_TARIFS_BY_TYPE[normalizeAccommodationType(accommodationType) || accommodationType];
  return t ? (t[seasonType] || 0) : 0;
}

// Métadonnées de notre grille interne
export const OUR_TARIFS_META = { source:"Tarif interne validé", verified_at:"avril 2026", status:"réel" };

// Normalise une typologie depuis accommodation_type OU notes (ordre : SUP avant 2P6 simple). "" si indéterminé.
export function normalizeAccommodationType(value, notes = "") {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const n = String(notes || "").toUpperCase();
  if (raw === "2P6_SUP" || raw === "2P6SUP" || n.includes("2P6 SUP") || n.includes("2P6_SUP") || n.includes("2P6SUP")) return "2P6_SUP";
  if (raw === "3P8" || n.includes("3P8")) return "3P8";
  if (raw === "3P6" || n.includes("3P6")) return "3P6";
  if (raw === "2P6" || n.includes("2P6")) return "2P6";
  return "";
}
// Compat : ancienne API renvoie null si indéterminé
export function inferAccommodationType(rate) {
  return normalizeAccommodationType(rate?.accommodation_type, rate?.notes || rate?.accommodation_label) || null;
}
// Retrouve la ligne our_rates pour une cellule de grille : par dates + durée + typologie (jamais par period_id)
export function findRateForGridCell(rates, period, accommodationType) {
  const start = period.period_start || period.week_start;
  const nights = Number(period.stay_nights || 7);
  const end = period.period_end || addDaysStr(start, nights);
  return (rates || []).find(r => {
    const rType = normalizeAccommodationType(r.accommodation_type, r.notes);
    return (
      sameDate(r.period_start, start) &&
      sameDate(r.period_end, end) &&
      Number(r.stay_nights || 7) === nights &&
      rType === accommodationType
    );
  }) || null;
}

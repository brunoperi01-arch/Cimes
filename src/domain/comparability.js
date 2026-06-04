// ══════════════════════════════════════════════════════════════════
// src/domain/comparability.js
// Segmentation & comparabilité des concurrents — pur, testable.
//
// RÈGLES MÉTIER :
//  - Les Cimes n'est JAMAIS un concurrent (isOwnProperty).
//  - Pros (résidences/hôtels) et particuliers ne se mélangent pas
//    dans une même médiane (competitorSegment).
// ══════════════════════════════════════════════════════════════════

// Reconnaît notre propre établissement (à exclure des concurrents)
export function isOwnProperty(name) {
  const n = String(name || "").toLowerCase();
  return (
    n.includes("les cimes du val d'allos") ||
    n.includes("les cimes val d'allos") ||
    n.includes("résidence les cimes") ||
    n.includes("residence les cimes")
  );
}

// Segment d'un concurrent : "private" (particulier) ou "residence" (pro)
export function competitorSegment(c) {
  if (!c) return "residence";
  if (
    c.is_private_rental === true ||
    c.market_segment === "private" ||
    c.property_type === "particulier" ||
    c.property_type === "studio"
  ) return "private";
  return "residence";
}

export function isPrivateCompetitor(c) {
  return competitorSegment(c) === "private";
}

// Types de sources connus (compat anciens types maeva/airbnb/…)
export const SOURCE_TYPES = [
  { type: "booking", name: "Booking.com" },
  { type: "direct", name: "Site direct" },
  { type: "maeva", name: "Maeva" },
  { type: "airbnb", name: "Airbnb" },
  { type: "abritel", name: "Abritel" },
  { type: "expedia", name: "Expedia" },
  { type: "other", name: "Autre" },
];

// Badge (label + couleurs) selon le type de source, gère aussi les anciens types
export function sourceBadgeMeta(type) {
  switch (type) {
    case "booking":       return { l: "Booking", c: "#0A6CFF", bg: "#E8F1FF" };
    case "direct":        return { l: "Direct", c: "#1DB954", bg: "#E6F9EE" };
    case "tour_operator": return { l: "TO", c: "#7C3AED", bg: "#F1E9FF" };
    case "marketplace":   return { l: "OTA", c: "#F5A623", bg: "#FFF4E0" };
    case "maeva":         return { l: "TO", c: "#7C3AED", bg: "#F1E9FF" };
    case "airbnb": case "abritel": case "expedia": return { l: "OTA", c: "#F5A623", bg: "#FFF4E0" };
    default:              return { l: "Autre", c: "#8E8E93", bg: "#F2F2F7" };
  }
}

// ══════════════════════════════════════════════════════════════════
// src/domain/onlineRates.js
// Logique métier "online_own" : prix attendu en ligne & statut de
// diffusion. Pur, testable. (La persistance vit dans le service.)
// ══════════════════════════════════════════════════════════════════

export const ONLINE_SOURCE_TYPES = {
  booking: "Booking", direct: "Site direct", tour_operator: "Tour-opérateur",
  marketplace: "Marketplace", other: "Autre",
};

// Plateformes proposées en saisie rapide (libellé → type de canal)
export const ONLINE_PLATFORMS = [
  { name: "Booking", type: "booking" },
  { name: "Maeva", type: "tour_operator" },
  { name: "Ski Planet", type: "tour_operator" },
  { name: "Travelski", type: "tour_operator" },
  { name: "Carrefour Voyages", type: "tour_operator" },
  { name: "Site officiel", type: "direct" },
  { name: "Autre", type: "other" },
];

// Prix attendu en ligne = promo active si présente, sinon tarif public
export function getExpectedOurOnlinePrice({ publicRate, activePromo }) {
  const publicPrice = Number(publicRate?.price_total || publicRate?.price_week || 0);
  if (activePromo && (activePromo.price_promo || activePromo.promo_price)) {
    const promoPrice = Number(activePromo.price_promo || activePromo.promo_price);
    return { expected_price: promoPrice, expected_public_price: publicPrice, expected_promo_price: promoPrice, mode: "promo" };
  }
  return { expected_price: publicPrice, expected_public_price: publicPrice, expected_promo_price: null, mode: "public" };
}

// Statut diffusion à partir du prix vérifié vs attendu
export function onlineRateStatus({ validated, expected, expectedPublic, expectedPromo }) {
  if (validated == null || validated <= 0) return "non trouvé";
  if (!expected) return "à vérifier";
  const gapPct = Math.round(((validated - expected) / expected) * 100);
  // Promo attendue mais prix en ligne ≈ prix public → promo absente
  if (expectedPromo && expectedPublic && Math.abs(validated - expectedPublic) <= expectedPublic * 0.02 && validated > expectedPromo * 1.02) return "promo absente";
  if (gapPct > 2) return "trop haut";
  if (gapPct < -2) return "trop bas";
  return "OK";
}

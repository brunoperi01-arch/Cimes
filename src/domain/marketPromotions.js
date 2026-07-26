// ══════════════════════════════════════════════════════════════════
// src/domain/marketPromotions.js
// Logique métier pure du module "Tendance promos" (veille des promotions
// marché montagne). Aucune dépendance Supabase/React — testable seule.
//
// Distinct de src/domain/promotions.js (promos propres aux Cimes).
// ══════════════════════════════════════════════════════════════════
import { dateObjToISO } from "../utils/dates.js";

// ── Taxonomie des types de promotion (marché) ───────────────────────
export const PROMOTION_TYPES = {
  remise_pourcentage:               "Remise en %",
  prix_barre:                       "Prix barré",
  prix_appel:                       "Prix d'appel",
  derniere_minute:                  "Dernière minute",
  reservation_anticipee:            "Réservation anticipée",
  deuxieme_semaine_offerte:         "2ᵉ semaine offerte",
  semaine_achetee_semaine_offerte:  "1 sem. achetée = 1 offerte",
  frais_dossier_offerts:            "Frais de dossier offerts",
  paiement_plusieurs_fois:          "Paiement en plusieurs fois",
  offre_famille:                    "Offre famille",
  offre_canicule:                   "Offre canicule",
  activite_incluse:                 "Activité / forfait inclus",
  court_sejour:                     "Court séjour",
  code_promo:                       "Code promotionnel",
  offre_membres:                    "Réservé aux membres",
  autre:                            "Autre promotion",
};

// ── Normalisation d'un libellé libre → type normalisé ────────────────
// L'ordre compte : les motifs les plus spécifiques sont testés en premier
// pour éviter qu'un motif générique ("offerte") n'écrase un motif précis
// ("1 semaine achetée = 1 offerte").
const RULES = [
  [/1\s*semaine\s*achet[ée]e.*1\s*semaine\s*offerte|semaine\s*achet[ée]e\s*=\s*semaine\s*offerte/i, "semaine_achetee_semaine_offerte"],
  [/2\s*[eè]me\s*semaine\s*(gratuite|offerte)|deuxi[eè]me\s*semaine\s*(gratuite|offerte)/i, "deuxieme_semaine_offerte"],
  [/frais\s*de\s*dossier\s*offert/i, "frais_dossier_offerts"],
  [/(3x|4x|plusieurs\s*fois|paiement\s*[ée]chelonn[ée])/i, "paiement_plusieurs_fois"],
  [/canicule/i, "offre_canicule"],
  [/famille|enfant\s*gratuit|kids?\s*free/i, "offre_famille"],
  [/forfait\s*(ski\s*)?inclus|activit[ée]\s*inclus|spa\s*inclus|petit[- ]d[ée]jeuner\s*inclus/i, "activite_incluse"],
  [/court\s*s[ée]jour|week[- ]?end|midweek|2\s*nuits|3\s*nuits/i, "court_sejour"],
  [/code\s*promo|code\s*r[ée]duction/i, "code_promo"],
  [/(adh[ée]rent|membre|club\s*fid[ée]lit[ée])/i, "offre_membres"],
  [/(d[ée]part\s*imm[ée]diat|dernier[e]?\s*minute|last\s*minute)/i, "derniere_minute"],
  [/(early\s*booking|r[ée]servation\s*anticip[ée]e|pr[ée]-r[ée]servation|vente\s*flash\s*anticip[ée]e)/i, "reservation_anticipee"],
  [/prix\s*d[' ]appel|[àa]\s*partir\s*de/i, "prix_appel"],
  [/prix\s*barr[ée]/i, "prix_barre"],
  [/-?\s*\d{1,3}\s*%/i, "remise_pourcentage"],
];

export function normalizePromotionType(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return "autre";
  for (const [re, type] of RULES) {
    if (re.test(text)) return type;
  }
  return "autre";
}

export function promotionTypeLabel(type) {
  return PROMOTION_TYPES[type] || PROMOTION_TYPES.autre;
}

// ── Statut actif / expiré ─────────────────────────────────────────
export function isPromotionActive(promo, today = dateObjToISO(new Date())) {
  if (!promo) return false;
  if (promo.booking_end && String(promo.booking_end).slice(0, 10) < today) return false;
  return true;
}

// ── Statistiques simples ───────────────────────────────────────────
function median(arr) {
  const v = (arr || []).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round(((v[mid - 1] + v[mid]) / 2) * 100) / 100;
}
function mean(arr) {
  const v = (arr || []).filter(n => Number.isFinite(n));
  if (!v.length) return null;
  return Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 100) / 100;
}

// ── Synthèse marché ─────────────────────────────────────────────────
// Ne calcule rien sur un échantillon trop faible : renvoie needsMoreData.
export function computeMarketSynthesis(promotions, today = dateObjToISO(new Date())) {
  const active = (promotions || []).filter(p => isPromotionActive(p, today));
  const withDiscount = active.map(p => Number(p.discount_percent)).filter(Number.isFinite);
  const withStarting = active.map(p => Number(p.starting_price)).filter(Number.isFinite);
  const lastMinuteCount = active.filter(p => p.promotion_type === "derniere_minute").length;
  const operators = new Set(active.map(p => p.operator_name).filter(Boolean));
  const stations = new Set(active.map(p => p.station_name).filter(Boolean));
  const lastCollected = (promotions || [])
    .map(p => p.collected_at)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  const needsMoreData = active.length < 3;
  const medianDiscount = median(withDiscount);

  let level = "donnees_insuffisantes";
  if (!needsMoreData) {
    if (medianDiscount == null) level = "donnees_insuffisantes";
    else if (medianDiscount >= 25) level = "agressif";
    else if (medianDiscount >= 12) level = "modere";
    else level = "peu_promotionnel";
  }

  return {
    activeOffersCount: active.length,
    operatorsCount: operators.size,
    stationsCount: stations.size,
    medianDiscountPercent: medianDiscount,
    meanDiscountPercent: mean(withDiscount),
    medianStartingPrice: median(withStarting),
    lastMinuteSharePercent: active.length ? Math.round((lastMinuteCount / active.length) * 100) : null,
    lastCollectedAt: lastCollected,
    level, // 'peu_promotionnel' | 'modere' | 'agressif' | 'donnees_insuffisantes'
    needsMoreData,
  };
}

export const MARKET_LEVEL_LABELS = {
  peu_promotionnel: "Marché peu promotionnel",
  modere: "Marché modérément promotionnel",
  agressif: "Marché agressif",
  donnees_insuffisantes: "Données insuffisantes",
};

// ── Comparaison avec Les Cimes ───────────────────────────────────────
// cimesPromo (optionnel) : { discount_pct, starting_price } — promo active des Cimes,
// typiquement issue de src/domain/promotions.js (getActivePromoForContext).
export function compareWithCimes(synthesis, cimesPromo) {
  if (!synthesis || synthesis.needsMoreData || synthesis.medianDiscountPercent == null) return null;
  const cimesDiscount = cimesPromo?.discount_pct != null ? Number(cimesPromo.discount_pct) : null;
  const cimesStarting = cimesPromo?.starting_price != null ? Number(cimesPromo.starting_price) : null;
  const gapPoints = cimesDiscount != null ? Math.round(cimesDiscount - synthesis.medianDiscountPercent) : null;

  let positioning = "indéterminé";
  let text = "Aucune promotion active connue aux Cimes à comparer au marché.";
  if (cimesDiscount != null) {
    if (gapPoints > 3) positioning = "plus agressif que le marché";
    else if (gapPoints < -3) positioning = "moins agressif que le marché";
    else positioning = "aligné sur le marché";
    text = `La remise active des Cimes est de ${cimesDiscount}%, contre une médiane marché de ${synthesis.medianDiscountPercent}%. `
      + (gapPoints > 0
        ? `Les Cimes sont ${Math.abs(gapPoints)} points plus agressives que le marché.`
        : gapPoints < 0
          ? `Les Cimes sont ${Math.abs(gapPoints)} points moins agressives que le marché.`
          : `Les Cimes sont alignées sur le marché.`);
  }

  return {
    cimesDiscountPercent: cimesDiscount,
    marketMedianDiscountPercent: synthesis.medianDiscountPercent,
    gapPoints,
    cimesStartingPrice: cimesStarting,
    marketMedianStartingPrice: synthesis.medianStartingPrice,
    positioning,
    text,
  };
}

// ── Répartition par type ─────────────────────────────────────────────
export function computeTypeDistribution(promotions, today = dateObjToISO(new Date())) {
  const active = (promotions || []).filter(p => isPromotionActive(p, today));
  const counts = {};
  for (const p of active) {
    const t = p.promotion_type || "autre";
    counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([type, count]) => ({ type, label: promotionTypeLabel(type), count, sharePercent: active.length ? Math.round((count / active.length) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
}

// ── Tendance (évolution 7j / 30j) ─────────────────────────────────────
// Compare la fenêtre récente à la fenêtre précédente de même durée, plutôt
// que deux relevés isolés (règle explicite : pas de comparaison sur 2 points).
function windowStats(promotions, fromDaysAgo, toDaysAgo, today) {
  const todayDate = new Date(today + "T12:00:00Z");
  const from = new Date(todayDate); from.setUTCDate(from.getUTCDate() - fromDaysAgo);
  const to = new Date(todayDate); to.setUTCDate(to.getUTCDate() - toDaysAgo);
  const inWindow = (promotions || []).filter(p => {
    const d = String(p.collected_at || "").slice(0, 10);
    return d && d >= dateObjToISO(from) && d <= dateObjToISO(to);
  });
  return {
    count: inWindow.length,
    medianDiscount: median(inWindow.map(p => Number(p.discount_percent)).filter(Number.isFinite)),
    medianStarting: median(inWindow.map(p => Number(p.starting_price)).filter(Number.isFinite)),
  };
}

export function computeTrend(promotions, today = dateObjToISO(new Date())) {
  const last7 = windowStats(promotions, 7, 0, today);
  const prev7 = windowStats(promotions, 14, 8, today);
  const last30 = windowStats(promotions, 30, 0, today);
  const prev30 = windowStats(promotions, 60, 31, today);

  const enoughData = (promotions || []).length >= 5;

  return {
    enoughData,
    last7Days: last7,
    prev7Days: prev7,
    last30Days: last30,
    prev30Days: prev30,
    countTrend7: enoughData && prev7.count ? Math.round(((last7.count - prev7.count) / prev7.count) * 100) : null,
    countTrend30: enoughData && prev30.count ? Math.round(((last30.count - prev30.count) / prev30.count) * 100) : null,
  };
}

// ── Recommandation prudente ────────────────────────────────────────
// Ne recommande JAMAIS de baisse générale de prix sur données faibles/anciennes.
export function buildRecommendation({ synthesis, comparison, daysToArrival, dataAgeDays }) {
  if (!synthesis || synthesis.needsMoreData) {
    return { action: "ne_pas_agir", label: "Ne pas agir — données insuffisantes", explanation: "Moins de 3 offres actives détectées sur le marché : pas assez de matière pour recommander une action tarifaire." };
  }
  if (dataAgeDays != null && dataAgeDays > 14) {
    return { action: "ne_pas_agir", label: "Ne pas agir — relevés trop anciens", explanation: `Le dernier relevé date de ${dataAgeDays} jours. Relancez un scan avant toute décision.` };
  }

  const level = synthesis.level;
  const gap = comparison?.gapPoints ?? null;

  if (level === "agressif" && (gap == null || gap < -5)) {
    return { action: "renforcer_promotion", label: "Renforcer la promotion", explanation: `Le marché est agressif (remise médiane ${synthesis.medianDiscountPercent}%) et Les Cimes sont en retrait. Envisagez de renforcer l'offre actuelle.` };
  }
  if (level === "agressif" && synthesis.lastMinuteSharePercent >= 40 && daysToArrival != null && daysToArrival <= 21) {
    return { action: "creer_derniere_minute", label: "Créer une offre dernière minute", explanation: `${synthesis.lastMinuteSharePercent}% des offres actives sont des dernières minutes et l'arrivée est proche (${daysToArrival}j). Une offre courte durée peut capter la demande tardive.` };
  }
  if (level === "peu_promotionnel" && gap != null && gap > 8) {
    return { action: "reduire_remise", label: "Réduire la remise", explanation: `Le marché est peu promotionnel (médiane ${synthesis.medianDiscountPercent}%) alors que Les Cimes affichent une remise nettement supérieure. Une réduction progressive est possible sans perdre en compétitivité.` };
  }
  if (level === "modere" && (gap == null)) {
    return { action: "proposer_deuxieme_semaine", label: "Proposer une deuxième semaine", explanation: "Le marché est modérément promotionnel sans qu'aucune promotion directe ne soit active aux Cimes. Une offre deuxième semaine reste moins risquée qu'une remise sèche." };
  }
  return { action: "maintenir_promotion", label: "Maintenir la promotion actuelle", explanation: "Le positionnement des Cimes est cohérent avec le marché observé. Aucun ajustement urgent." };
}

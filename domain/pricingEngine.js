// ══════════════════════════════════════════════════════════════════
// src/domain/pricingEngine.js
// Moteur de recommandation tarifaire — Les Cimes du Val d'Allos
//
// 100 % indépendant de l'interface (aucun import React / DOM).
// Logique pure et testable : mêmes entrées → mêmes sorties.
//
// Entrée principale :
//   calculateRecommendation({
//     officialRate, ownOnlineRates, competitorRates, period, apartmentType
//   })
//
// Sortie :
//   {
//     recommendation: "augmenter" | "baisser" | "maintenir" | "verifier",
//     confidence: "faible" | "moyenne" | "forte",
//     explanation: string,
//     alerts: Array<{ level, type, message, action }>,
//     marketMedian: number | null,
//     differenceVsMarket: { amount, pct } | null,
//     differenceVsOwnOnline: { amount, pct } | null
//   }
// ══════════════════════════════════════════════════════════════════

// ── Constantes de réglage (modifiables sans toucher au reste) ──────
export const PRICING_DEFAULTS = Object.freeze({
  marketGapPct: 15,     // seuil d'écart marché pour recommander un changement
  criticalGapPct: 25,   // au-delà → alerte critique
  partnerGapPct: 2,     // tolérance entre tarif officiel et prix vu en ligne
  minSamples: 3,        // relevés validés minimum pour une médiane fiable
  strongSamples: 5,     // relevés pour une confiance forte
  obsoleteDays: 7,      // au-delà → relevés considérés obsolètes
  promoMaxAgeDays: 30,  // promo concurrente ignorée si plus ancienne
});

export const RECOMMENDATIONS = Object.freeze({
  AUGMENTER: "augmenter",
  BAISSER: "baisser",
  MAINTENIR: "maintenir",
  VERIFIER: "verifier",
});

export const CONFIDENCE = Object.freeze({
  FAIBLE: "faible",
  MOYENNE: "moyenne",
  FORTE: "forte",
});

const TRUSTED = ["validé", "réel", "saisi manuellement", "importé csv"];

// ── Helpers purs ───────────────────────────────────────────────────
export function median(values) {
  const arr = (values || []).filter(v => typeof v === "number" && !Number.isNaN(v));
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function daysAgo(dateStr, now = Date.now()) {
  if (!dateStr) return Infinity;
  const d = new Date(String(dateStr).slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return Infinity;
  return Math.floor((now - d.getTime()) / 86400000);
}

// Prix "séjour" d'un relevé, quelle que soit la convention de champ
export function priceOf(rate) {
  if (rate == null) return 0;
  if (typeof rate === "number") return rate;
  return Number(rate.price_total || rate.price_week || rate.price || 0);
}

function isTrusted(rate) {
  return TRUSTED.includes(String(rate?.reliability_status || "").toLowerCase());
}

// Un relevé concurrent est-il une RÉSIDENCE/PRO (vs particulier) ?
function isResidence(rate) {
  return !(
    rate?.market_segment === "private" ||
    rate?.is_private_rental === true ||
    rate?.property_type === "particulier" ||
    rate?.property_type === "studio"
  );
}

function sameDay(a, b) {
  return String(a || "").slice(0, 10) === String(b || "").slice(0, 10);
}

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

// ── Sélection des relevés concurrents pertinents pour le contexte ──
// On compare du comparable : même période + même durée, résidences pros,
// statut de confiance. La typologie/capacité affine si fournie.
export function selectComparableCompetitors(competitorRates, period = {}, apartmentType, opts = {}) {
  const start = period.period_start || period.week_start || period.checkin;
  const nights = Number(period.stay_nights || period.stayNights || 7);
  const capacity = opts.capacity != null ? Number(opts.capacity) : null;
  return (competitorRates || []).filter(r => {
    if (!isTrusted(r)) return false;
    if (priceOf(r) <= 0) return false;
    if (!isResidence(r)) return false;
    if (start && !sameDay(r.period_start, start)) return false;
    if (Number(r.stay_nights || 7) !== nights) return false;
    if (capacity != null && r.capacity != null && Number(r.capacity) !== capacity) return false;
    return true;
  });
}

// ── Détection des promos concurrentes dans un lot de relevés ───────
function detectCompetitorPromos(rates, now, maxAgeDays) {
  return (rates || []).filter(r => {
    if (daysAgo(r.collected_at, now) > maxAgeDays) return false;
    const hasLabel = !!(r.promo_label && String(r.promo_label).trim());
    const hasPct = Number(r.promo_percent || 0) > 0;
    const orig = Number(r.original_price || 0);
    const p = priceOf(r);
    const discounted = orig > 0 && p > 0 && p < orig * 0.97;
    return hasLabel || hasPct || discounted;
  });
}

// ══ FONCTION PRINCIPALE ════════════════════════════════════════════
export function calculateRecommendation({
  officialRate,
  ownOnlineRates = [],
  competitorRates = [],
  period = {},
  apartmentType = null,
  options = {},
} = {}) {
  const cfg = { ...PRICING_DEFAULTS, ...options };
  const now = options.now || Date.now();
  const alerts = [];

  // Tarif officiel (accepte un nombre OU un objet {price_total/price_week})
  const official = priceOf(officialRate);

  // 1) Médiane marché (concurrents comparables)
  const comparable = selectComparableCompetitors(competitorRates, period, apartmentType, options);
  const sampleCount = comparable.length;
  const marketMedian = median(comparable.map(priceOf));

  // 2) Écart vs marché
  let differenceVsMarket = null;
  if (official > 0 && marketMedian) {
    const amount = Math.round(official - marketMedian);
    differenceVsMarket = { amount, pct: pct(amount, marketMedian) };
  }

  // 3) Écart vs nos prix vus en ligne (online_own)
  const onlineValues = (ownOnlineRates || [])
    .map(r => Number(r.validated_price ?? r.detected_price ?? priceOf(r)))
    .filter(v => v > 0);
  const onlineMedian = median(onlineValues);
  let differenceVsOwnOnline = null;
  if (official > 0 && onlineMedian) {
    const amount = Math.round(onlineMedian - official); // ce que les partenaires affichent vs notre officiel
    differenceVsOwnOnline = { amount, pct: pct(amount, official) };
  }

  // ── ALERTES ──────────────────────────────────────────────────────
  // A. Diffusion partenaires : un prix en ligne s'écarte de l'officiel
  (ownOnlineRates || []).forEach(r => {
    const val = Number(r.validated_price ?? r.detected_price ?? 0);
    if (!official || !val) return;
    const gp = pct(val - official, official);
    if (gp == null || Math.abs(gp) <= cfg.partnerGapPct) return;
    alerts.push({
      level: Math.abs(gp) >= 10 ? "critique" : "warning",
      type: "partner_gap",
      message: `${r.source_name || "Partenaire"} affiche ${val}€ (${gp > 0 ? "+" : ""}${gp}% vs officiel ${official}€).`,
      action: gp < 0
        ? "Demandez la correction du prix partenaire ou vérifiez une promo non prévue."
        : "Vérifiez le surcoût partenaire (frais/marge) — risque de non-compétitivité.",
    });
  });

  // B. Données insuffisantes
  if (sampleCount > 0 && sampleCount < cfg.minSamples) {
    alerts.push({
      level: "info", type: "insufficient_data",
      message: `Seulement ${sampleCount} relevé(s) concurrent(s) validé(s) pour cette période.`,
      action: `Relevez au moins ${cfg.minSamples} concurrents comparables pour fiabiliser la médiane.`,
    });
  }

  // C. Relevés obsolètes
  if (sampleCount > 0) {
    const freshest = Math.min(...comparable.map(r => daysAgo(r.collected_at, now)));
    if (freshest > cfg.obsoleteDays) {
      alerts.push({
        level: "warning", type: "stale_data",
        message: `Relevé concurrent le plus récent : ${freshest} jours (seuil ${cfg.obsoleteDays} j).`,
        action: "Rafraîchissez les relevés avant de décider.",
      });
    }
  }

  // D. Promos concurrentes
  detectCompetitorPromos(comparable, now, cfg.promoMaxAgeDays).forEach(r => {
    const p = priceOf(r);
    const orig = Number(r.original_price || 0);
    const dpct = Number(r.promo_percent || 0) || (orig > 0 ? Math.round((1 - p / orig) * 100) : null);
    alerts.push({
      level: "info", type: "competitor_promo",
      message: `${r.competitor || r.property_name || "Un concurrent"} en promo${dpct ? ` (~-${dpct}%)` : ""}${r.promo_label ? ` « ${r.promo_label} »` : ""} à ${p}€.`,
      action: "Surveillez ce canal ; envisagez une offre directe ciblée si la pression s'installe.",
    });
  });

  // ── CONFIANCE ──────────────────────────────────────────────────────
  let confidence = CONFIDENCE.FAIBLE;
  if (sampleCount >= cfg.strongSamples) confidence = CONFIDENCE.FORTE;
  else if (sampleCount >= cfg.minSamples) confidence = CONFIDENCE.MOYENNE;
  // Pénalité si données obsolètes
  if (sampleCount > 0) {
    const freshest = Math.min(...comparable.map(r => daysAgo(r.collected_at, now)));
    if (freshest > cfg.obsoleteDays && confidence === CONFIDENCE.FORTE) confidence = CONFIDENCE.MOYENNE;
  }

  // ── RECOMMANDATION ────────────────────────────────────────────────
  let recommendation = RECOMMENDATIONS.VERIFIER;
  let explanation;

  if (!official) {
    recommendation = RECOMMENDATIONS.VERIFIER;
    explanation = "Aucun tarif officiel renseigné pour cette période/typologie. Complétez la grille officielle avant toute décision.";
  } else if (!marketMedian || sampleCount < cfg.minSamples) {
    recommendation = RECOMMENDATIONS.VERIFIER;
    explanation = sampleCount === 0
      ? "Aucun relevé concurrent validé : impossible de situer le tarif. Lancez des relevés marché."
      : `Données marché insuffisantes (${sampleCount} relevé(s)). Recommandation à confirmer après plus de relevés.`;
  } else {
    const gp = differenceVsMarket.pct;
    if (gp > cfg.marketGapPct) {
      recommendation = RECOMMENDATIONS.BAISSER;
      explanation = `Tarif officiel ${official}€ supérieur de +${gp}% à la médiane marché (${marketMedian}€). Position trop chère : envisagez une baisse ou une promo directe.`;
      alerts.unshift({
        level: gp >= cfg.criticalGapPct ? "critique" : "warning", type: "too_high",
        message: `Officiel +${gp}% vs marché (${official}€ contre ${marketMedian}€).`,
        action: "Baisser le tarif public ou lancer une promo directe ciblée.",
      });
    } else if (gp < -cfg.marketGapPct) {
      recommendation = RECOMMENDATIONS.AUGMENTER;
      explanation = `Tarif officiel ${official}€ inférieur de ${gp}% à la médiane marché (${marketMedian}€). Vous laissez probablement de la marge : envisagez une hausse.`;
      alerts.unshift({
        level: gp <= -cfg.criticalGapPct ? "critique" : "warning", type: "too_low",
        message: `Officiel ${gp}% vs marché (${official}€ contre ${marketMedian}€).`,
        action: "Augmenter le tarif public pour capter la marge disponible.",
      });
    } else {
      recommendation = RECOMMENDATIONS.MAINTENIR;
      explanation = `Tarif officiel ${official}€ aligné sur la médiane marché (${marketMedian}€, écart ${gp > 0 ? "+" : ""}${gp}%). Maintenez et surveillez.`;
    }
  }

  // Tri des alertes par gravité (critique → warning → info)
  const rank = { critique: 3, warning: 2, info: 1 };
  alerts.sort((a, b) => (rank[b.level] || 0) - (rank[a.level] || 0));

  return {
    recommendation,
    confidence,
    explanation,
    alerts,
    marketMedian,
    differenceVsMarket,
    differenceVsOwnOnline,
    // métadonnées utiles (non listées mais pratiques côté UI)
    meta: { official, sampleCount, apartmentType: apartmentType || null, period },
  };
}

export default calculateRecommendation;

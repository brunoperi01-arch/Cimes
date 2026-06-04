// ══════════════════════════════════════════════════════════════════
// src/domain/alerts.js
// Moteur d'alertes — 6 règles simples, fonction pure et testable.
// Niveaux : info < warning < critique. Chaque alerte porte une
// explication claire + une action recommandée + un écran cible.
// ══════════════════════════════════════════════════════════════════

export const ALERT_LEVELS = {
  critique: { rank:3, label:"Critique", color:"#B91C1C", bg:"#FEE2E2", icon:"🔴" },
  warning:  { rank:2, label:"À surveiller", color:"#D45400", bg:"#FFF0E6", icon:"🟠" },
  info:     { rank:1, label:"Info", color:"#1B3A6B", bg:"#EEF4FF", icon:"🔵" },
};
function _alertMedian(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function _daysAgo(dateStr) {
  if (!dateStr) return 9999;
  const d = new Date(String(dateStr).slice(0, 10) + "T12:00:00Z");
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
// Génère toutes les alertes à partir des 3 domaines + périodes.
// Params : ourRates (officiel), onlineRates (online_own), competitorRates (marché),
// periods (ALL_PERIODS), opts { marketGapPct=15, minRates=3, obsoleteDays=7 }
export function computeAlerts({ ourRates = [], onlineRates = [], competitorRates = [], periods = [], opts = {} } = {}) {
  const { marketGapPct = 15, minRates = 3, obsoleteDays = 7, partnerGapPct = 2 } = opts;
  const alerts = [];
  const isTrusted = r => ["validé", "réel", "saisi manuellement", "importé CSV"].includes(String(r.reliability_status || "").toLowerCase());
  const priceOf = r => Number(r.price_total || r.price_week || r.price || 0);
  const isResidence = r => !(r.market_segment === "private" || r.is_private_rental === true || r.property_type === "particulier" || r.property_type === "studio");

  // ─ Règle 1 : tarif partenaire ≠ tarif officiel (online_own) ─
  (onlineRates || []).forEach(r => {
    const exp = Number(r.expected_price || 0), val = Number(r.validated_price || 0);
    if (!exp || !val) return;
    const gap = Math.round(val - exp);
    const gapPct = Math.round((gap / exp) * 100);
    if (Math.abs(gapPct) <= partnerGapPct) return;
    const tooLow = gap < 0;
    alerts.push({
      rule: 1, level: Math.abs(gapPct) >= 10 ? "critique" : "warning",
      title: `${r.source_name || "Partenaire"} : ${gap > 0 ? "+" : ""}${gap}€ vs tarif officiel`,
      explanation: `${r.source_name || "Le partenaire"} affiche ${val}€ alors que votre tarif officiel est ${exp}€ (${gapPct > 0 ? "+" : ""}${gapPct}%)${r.accommodation_type ? ` pour le ${r.accommodation_type}` : ""}.`,
      action: tooLow ? "Demandez au partenaire de remonter le prix au tarif officiel, ou vérifiez s'il applique une promo non prévue." : "Vérifiez pourquoi le partenaire affiche plus cher (frais, marge) — risque de paraître non compétitif.",
      screen: "our_online_rates", tag: r.source_name,
    });
  });

  // ─ Règles 2/3/4/5 : par période (marché concurrent) ─
  const pricedComp = (competitorRates || []).filter(r => isTrusted(r) && priceOf(r) > 0 && isResidence(r));
  (periods || []).forEach(p => {
    const ps = p.period_start || p.week_start;
    const rowsP = pricedComp.filter(r => String(r.period_start || "").slice(0, 10) === String(ps || "").slice(0, 10) && Number(r.stay_nights || 7) === Number(p.stay_nights || 7));
    const periodLabel = `${ps || "?"}${p.stay_nights ? ` (${p.stay_nights}n)` : ""}`;
    // tarif officiel de la période (toutes typologies confondues : on prend la médiane interne)
    const ourForP = (ourRates || []).filter(r => String(r.period_start || "").slice(0, 10) === String(ps || "").slice(0, 10) && Number(r.stay_nights || 7) === Number(p.stay_nights || 7)).map(priceOf).filter(Boolean);
    const ourMed = _alertMedian(ourForP);
    const mktMed = _alertMedian(rowsP.map(priceOf));

    // Règle 4 : pas assez de relevés concurrents
    if (rowsP.length > 0 && rowsP.length < minRates) {
      alerts.push({
        rule: 4, level: "info", title: `Peu de relevés concurrents · ${periodLabel}`,
        explanation: `Seulement ${rowsP.length} relevé(s) concurrent(s) validé(s) pour cette période. La médiane marché est peu fiable.`,
        action: "Relevez au moins 3 concurrents comparables (résidences pros) pour fiabiliser le positionnement.",
        screen: "track", tag: periodLabel,
      });
    }
    // Règle 5 : relevés obsolètes (>7 j)
    if (rowsP.length > 0) {
      const freshest = Math.min(...rowsP.map(r => _daysAgo(r.collected_at)));
      if (freshest > obsoleteDays) {
        alerts.push({
          rule: 5, level: "warning", title: `Relevés obsolètes · ${periodLabel}`,
          explanation: `Le relevé concurrent le plus récent date de ${freshest} jours (seuil ${obsoleteDays} j).`,
          action: "Rafraîchissez les relevés de cette période pour décider sur des prix à jour.",
          screen: "collect", tag: periodLabel,
        });
      }
    }
    // Règles 2/3 : positionnement vs marché (besoin de médianes fiables)
    if (ourMed && mktMed && rowsP.length >= minRates) {
      const gapPct = Math.round(((ourMed - mktMed) / mktMed) * 100);
      if (gapPct > marketGapPct) {
        alerts.push({
          rule: 2, level: gapPct >= 25 ? "critique" : "warning", title: `Trop cher vs marché · ${periodLabel}`,
          explanation: `Votre tarif officiel (méd. ${ourMed}€) dépasse la médiane concurrente (${mktMed}€) de +${gapPct}%.`,
          action: "Envisagez une promo directe ou un ajustement ; risque de faible taux de réservation.",
          screen: "benchmark", tag: periodLabel,
        });
      } else if (gapPct < -marketGapPct) {
        alerts.push({
          rule: 3, level: gapPct <= -25 ? "critique" : "warning", title: `Trop bas vs marché · ${periodLabel}`,
          explanation: `Votre tarif officiel (méd. ${ourMed}€) est inférieur à la médiane concurrente (${mktMed}€) de ${gapPct}%.`,
          action: "Vous laissez peut-être de la marge : envisagez d'augmenter le tarif public.",
          screen: "benchmark", tag: periodLabel,
        });
      }
    }
  });

  // ─ Règle 6 : promotion concurrente détectée ─
  pricedComp.forEach(r => {
    const hasPromoLabel = !!(r.promo_label && String(r.promo_label).trim());
    const hasPromoPct = Number(r.promo_percent || 0) > 0;
    const orig = Number(r.original_price || 0), price = priceOf(r);
    const discounted = orig > 0 && price > 0 && price < orig * 0.97;
    if (!hasPromoLabel && !hasPromoPct && !discounted) return;
    if (_daysAgo(r.collected_at) > 30) return; // promo trop ancienne, on ignore
    const pct = hasPromoPct ? Number(r.promo_percent) : (discounted ? Math.round((1 - price / orig) * 100) : null);
    alerts.push({
      rule: 6, level: "info", title: `Promo concurrente : ${r.competitor || r.property_name || "concurrent"}`,
      explanation: `${r.competitor || r.property_name || "Un concurrent"} affiche une remise${pct ? ` (~-${pct}%)` : ""}${r.promo_label ? ` « ${r.promo_label} »` : ""} à ${price}€.`,
      action: "Surveillez ce canal ; envisagez une offre directe ciblée si la pression s'installe.",
      screen: "track", tag: r.competitor || r.property_name,
    });
  });

  // Tri : critique → warning → info
  return alerts.sort((a, b) => (ALERT_LEVELS[b.level]?.rank || 0) - (ALERT_LEVELS[a.level]?.rank || 0));
}

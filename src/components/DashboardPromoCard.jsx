// ══════════════════════════════════════════════════════════════════
// src/components/DashboardPromoCard.jsx
// Carte compacte "Tendance promos montagne" affichée sur le Dashboard.
// Autonome (charge ses propres données), reste discrète (une seule carte).
// ══════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { C } from "./theme.js";
import { computeMarketSynthesis, compareWithCimes, MARKET_LEVEL_LABELS } from "../domain/marketPromotions.js";
import { getMarketPromotions } from "../services/marketPromotionsService.js";
import { dateObjToISO } from "../utils/dates.js";

const LEVEL_COLOR = {
  peu_promotionnel: C.green, modere: C.orange, agressif: C.red, donnees_insuffisantes: C.gray,
};

export default function DashboardPromoCard({ cd, onNavigate, cimesActivePromo = null }) {
  const [synthesis, setSynthesis] = useState(null);
  const [comparison, setComparison] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getMarketPromotions({}).then(rows => {
      if (cancelled) return;
      const today = dateObjToISO(new Date());
      const s = computeMarketSynthesis(rows, today);
      setSynthesis(s);
      setComparison(compareWithCimes(s, cimesActivePromo));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!synthesis) return null;
  const color = LEVEL_COLOR[synthesis.level];

  return (
    <div style={{ ...cd(11), padding: "11px 13px", marginTop: 8, borderLeft: `3px solid ${color}`, cursor: "pointer" }} onClick={onNavigate}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>🏔 Tendance promos montagne</p>
        <span style={{ fontSize: 11, fontWeight: 700, color }}>{MARKET_LEVEL_LABELS[synthesis.level]}</span>
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 11, color: C.gray }}>
        {synthesis.medianDiscountPercent != null ? `Remise médiane marché ${synthesis.medianDiscountPercent}%` : "Remise médiane : données insuffisantes"}
        {" · "}{synthesis.activeOffersCount} offre(s) active(s)
        {comparison?.gapPoints != null ? ` · écart Cimes ${comparison.gapPoints > 0 ? "+" : ""}${comparison.gapPoints} pts` : ""}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 11, fontWeight: 600, color: C.blue }}>Voir le détail →</p>
    </div>
  );
}

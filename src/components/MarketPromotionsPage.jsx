// ══════════════════════════════════════════════════════════════════
// src/components/MarketPromotionsPage.jsx
// Page "Tendance promos" — veille des promotions marché montagne.
// Autonome : gère son propre chargement de données. Reçoit uniquement
// des helpers de présentation (SBar, BNav, styles) + éventuellement la
// promo active des Cimes déjà calculée (pour la comparaison).
// ══════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from "react";
import { C } from "./theme.js";
import Badge from "./Badge.jsx";
import { STATIONS, OPERATORS, activeStations, activeOperators } from "../constants/marketWatch.js";
import {
  PROMOTION_TYPES, promotionTypeLabel, isPromotionActive,
  computeMarketSynthesis, MARKET_LEVEL_LABELS, compareWithCimes,
  computeTypeDistribution, computeTrend, buildRecommendation,
} from "../domain/marketPromotions.js";
import { getMarketPromotions, runPromotionsScan, deleteMarketPromotion } from "../services/marketPromotionsService.js";
import { dateObjToISO, daysBetween } from "../utils/dates.js";

const LEVEL_COLOR = {
  peu_promotionnel: C.green, modere: C.orange, agressif: C.red, donnees_insuffisantes: C.gray,
};

export default function MarketPromotionsPage({ SBar, BNav, styles, isMobile, cimesActivePromo = null }) {
  const { cnt, cd, rw, btn, sml, inp, responsiveGrid } = styles;

  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanStations, setScanStations] = useState(activeStations().slice(0, 3));
  const [scanOperators, setScanOperators] = useState(activeOperators());
  const [scanStayStart, setScanStayStart] = useState("");
  const [scanStayEnd, setScanStayEnd] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [lastScanAt, setLastScanAt] = useState(null);

  const [filters, setFilters] = useState({ station: "", operator: "", type: "", activeOnly: true });

  async function reload() {
    setLoading(true); setLoadErr(null);
    try { setPromotions(await getMarketPromotions({})); }
    catch (e) { setLoadErr(e?.message || "Erreur de chargement."); }
    setLoading(false);
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  async function handleScan() {
    if (!scanStations.length || !scanOperators.length) { setScanResult({ error: "Choisissez au moins une station et un opérateur." }); return; }
    setScanning(true); setScanResult(null);
    try {
      const r = await runPromotionsScan({
        stations: scanStations, operators: scanOperators,
        stayStart: scanStayStart || null, stayEnd: scanStayEnd || null,
      });
      setScanResult(r);
      setLastScanAt(r.scannedAt);
      await reload();
    } catch (e) {
      setScanResult({ error: e?.message || "Erreur pendant le scan." });
    }
    setScanning(false);
  }

  async function handleDelete(id) {
    await deleteMarketPromotion(id);
    setPromotions(p => p.filter(x => x.id !== id));
  }

  const today = dateObjToISO(new Date());
  const synthesis = useMemo(() => computeMarketSynthesis(promotions, today), [promotions]);
  const comparison = useMemo(() => compareWithCimes(synthesis, cimesActivePromo), [synthesis, cimesActivePromo]);
  const distribution = useMemo(() => computeTypeDistribution(promotions, today), [promotions]);
  const trend = useMemo(() => computeTrend(promotions, today), [promotions]);
  const dataAgeDays = synthesis.lastCollectedAt ? daysBetween(String(synthesis.lastCollectedAt).slice(0, 10), today) : null;
  const recommendation = useMemo(
    () => buildRecommendation({ synthesis, comparison, daysToArrival: null, dataAgeDays }),
    [synthesis, comparison, dataAgeDays]
  );

  const filteredList = promotions
    .filter(p => !filters.station || p.station_name === filters.station)
    .filter(p => !filters.operator || p.operator_name === filters.operator)
    .filter(p => !filters.type || p.promotion_type === filters.type)
    .filter(p => !filters.activeOnly || isPromotionActive(p, today));

  return (
    <div>
      <SBar title="Tendance promos" />
      <div style={cnt}>

        {/* ── Scan manuel ─────────────────────────────────────────── */}
        <div style={{ ...cd(11), padding: "11px 13px", background: C.bluePale, marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.blue }}>📡 Veille promos marché montagne</p>
            <button onClick={() => setScanOpen(o => !o)} style={{ fontSize: 11, fontWeight: 700, color: C.white, background: C.blue, border: "none", borderRadius: 7, padding: "6px 11px", cursor: "pointer" }}>
              {scanOpen ? "Fermer" : "Scanner les promotions"}
            </button>
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: C.blueL }}>
            {lastScanAt ? `Dernier scan : ${lastScanAt}` : "Aucun scan lancé pour l'instant."}
          </p>

          {scanOpen && (
            <div style={{ marginTop: 9 }}>
              <p style={sml}>Stations (max 3 par lancement)</p>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
                {STATIONS.filter(s => s.active).map(s => {
                  const on = scanStations.includes(s.name);
                  return (
                    <button key={s.id} onClick={() => setScanStations(list => on ? list.filter(x => x !== s.name) : (list.length >= 3 ? list : [...list, s.name]))}
                      style={{ fontSize: 11, fontWeight: 600, color: on ? C.white : C.blue, background: on ? C.blue : C.white, border: `1px solid ${C.blue}`, borderRadius: 7, padding: "5px 9px", cursor: "pointer" }}>
                      {s.name}
                    </button>
                  );
                })}
              </div>
              <p style={sml}>Opérateurs</p>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
                {OPERATORS.filter(o => o.active).map(o => {
                  const on = scanOperators.includes(o.name);
                  return (
                    <button key={o.id} onClick={() => setScanOperators(list => on ? list.filter(x => x !== o.name) : [...list, o.name])}
                      style={{ fontSize: 11, fontWeight: 600, color: on ? C.white : C.text, background: on ? C.blue : C.white, border: `1px solid ${C.grayM}`, borderRadius: 7, padding: "5px 9px", cursor: "pointer" }}>
                      {o.name}
                    </button>
                  );
                })}
              </div>
              <p style={sml}>Période de séjour visée (optionnel)</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                <input type="date" value={scanStayStart} onChange={e => setScanStayStart(e.target.value)} style={inp()} />
                <input type="date" value={scanStayEnd} onChange={e => setScanStayEnd(e.target.value)} style={inp()} />
              </div>
              <button onClick={handleScan} disabled={scanning} style={btn(scanning, C.blue)}>
                {scanning ? "Scan en cours…" : "Lancer le scan"}
              </button>
              {scanResult && (
                <div style={{ ...cd(9, 0), padding: "8px 10px", marginTop: 6, background: scanResult.error ? C.redL : C.greenL }}>
                  {scanResult.error
                    ? <p style={{ margin: 0, fontSize: 12, color: C.red }}>✗ {scanResult.error}</p>
                    : (
                      <>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.green }}>
                          {scanResult.detectedCount} promo(s) détectée(s) · {scanResult.savedCount} enregistrée(s)
                        </p>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: C.gray }}>
                          {scanResult.duplicatesCount} doublon(s) ignoré(s) · {scanResult.errorsCount} erreur(s)
                        </p>
                        {scanResult.apiErrors?.length > 0 && scanResult.apiErrors.map((e, i) => (
                          <p key={i} style={{ margin: "2px 0 0", fontSize: 11, color: C.orange }}>⚠ {e.station} : {e.error}</p>
                        ))}
                      </>
                    )}
                </div>
              )}
            </div>
          )}
        </div>

        {loading && <p style={{ fontSize: 12, color: C.gray, textAlign: "center", padding: "16px 0" }}>Chargement…</p>}
        {loadErr && <p style={{ fontSize: 12, color: C.red, textAlign: "center", padding: "16px 0" }}>✗ {loadErr}</p>}

        {!loading && !loadErr && (
          <>
            {/* ── 1. Synthèse du marché ─────────────────────────────── */}
            <p style={sml}>Synthèse du marché</p>
            <div style={{ ...cd(11), padding: "10px 13px", marginBottom: 8, borderLeft: `3px solid ${LEVEL_COLOR[synthesis.level]}` }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: LEVEL_COLOR[synthesis.level] }}>
                {MARKET_LEVEL_LABELS[synthesis.level]}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: C.gray }}>
                Dernier relevé : {synthesis.lastCollectedAt ? String(synthesis.lastCollectedAt).slice(0, 10) : "—"}
              </p>
            </div>
            <div style={{ ...responsiveGrid(4), marginBottom: 8 }}>
              {[
                ["Offres actives", synthesis.activeOffersCount],
                ["Opérateurs", synthesis.operatorsCount],
                ["Stations", synthesis.stationsCount],
                ["Remise médiane", synthesis.medianDiscountPercent != null ? `${synthesis.medianDiscountPercent}%` : "—"],
                ["Remise moyenne", synthesis.meanDiscountPercent != null ? `${synthesis.meanDiscountPercent}%` : "—"],
                ["Prix d'appel médian", synthesis.medianStartingPrice != null ? `${synthesis.medianStartingPrice}€` : "—"],
                ["Part dernière minute", synthesis.lastMinuteSharePercent != null ? `${synthesis.lastMinuteSharePercent}%` : "—"],
              ].map(([l, v]) => (
                <div key={l} style={{ ...cd(10, 0), padding: "9px 11px" }}>
                  <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.text }}>{v}</p>
                  <p style={{ margin: 0, fontSize: 10, color: C.gray }}>{l}</p>
                </div>
              ))}
            </div>

            {/* ── 2. Comparaison avec Les Cimes ─────────────────────── */}
            <p style={sml}>Comparaison avec Les Cimes</p>
            <div style={{ ...cd(11), padding: "11px 13px", marginBottom: 8 }}>
              {comparison ? (
                <>
                  <p style={{ margin: 0, fontSize: 12, color: C.text, lineHeight: 1.5 }}>{comparison.text}</p>
                  {comparison.marketMedianStartingPrice != null && (
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: C.gray }}>
                      Prix d'appel médian marché : {comparison.marketMedianStartingPrice}€
                      {comparison.cimesStartingPrice != null ? ` · Cimes : ${comparison.cimesStartingPrice}€` : ""}
                    </p>
                  )}
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: C.gray, fontStyle: "italic" }}>
                  Données insuffisantes pour comparer (moins de 3 offres actives détectées).
                </p>
              )}
            </div>

            {/* ── 3. Répartition par type ────────────────────────────── */}
            <p style={sml}>Répartition des promotions</p>
            <div style={{ ...cd(11), padding: "11px 13px", marginBottom: 8 }}>
              {distribution.length === 0
                ? <p style={{ margin: 0, fontSize: 12, color: C.gray, fontStyle: "italic" }}>Aucune promotion active pour le moment.</p>
                : distribution.map(d => (
                  <div key={d.type} style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.text, marginBottom: 2 }}>
                      <span>{d.label}</span><span style={{ fontWeight: 700 }}>{d.count} · {d.sharePercent}%</span>
                    </div>
                    <div style={{ height: 6, background: C.grayL, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${d.sharePercent}%`, background: C.blueL, borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
            </div>

            {/* ── 5. Historique / tendance ───────────────────────────── */}
            <p style={sml}>Tendance</p>
            <div style={{ ...cd(11), padding: "11px 13px", marginBottom: 8 }}>
              {!trend.enoughData ? (
                <p style={{ margin: 0, fontSize: 12, color: C.gray, fontStyle: "italic" }}>Historique encore trop court pour dégager une tendance fiable.</p>
              ) : (
                <div style={{ ...responsiveGrid(2) }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.text }}>7 derniers jours</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: C.gray }}>
                      {trend.last7Days.count} offre(s){trend.countTrend7 != null ? ` · ${trend.countTrend7 > 0 ? "+" : ""}${trend.countTrend7}% vs semaine précédente` : ""}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: C.gray }}>Remise médiane : {trend.last7Days.medianDiscount != null ? `${trend.last7Days.medianDiscount}%` : "—"}</p>
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.text }}>30 derniers jours</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: C.gray }}>
                      {trend.last30Days.count} offre(s){trend.countTrend30 != null ? ` · ${trend.countTrend30 > 0 ? "+" : ""}${trend.countTrend30}% vs période précédente` : ""}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: C.gray }}>Remise médiane : {trend.last30Days.medianDiscount != null ? `${trend.last30Days.medianDiscount}%` : "—"}</p>
                  </div>
                </div>
              )}
            </div>

            {/* ── 6. Recommandation ─────────────────────────────────── */}
            <p style={sml}>Recommandation</p>
            <div style={{ ...cd(11), padding: "11px 13px", marginBottom: 8, borderLeft: `3px solid ${C.orange}`, background: C.orangeL }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.orange }}>{recommendation.label}</p>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: C.text, lineHeight: 1.4 }}>{recommendation.explanation}</p>
            </div>

            {/* ── 4. Liste des promotions détectées ──────────────────── */}
            <p style={sml}>Promotions détectées ({filteredList.length})</p>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
              <select value={filters.station} onChange={e => setFilters(f => ({ ...f, station: e.target.value }))} style={{ ...inp(), width: "auto", fontSize: 11, padding: "5px 8px" }}>
                <option value="">Toutes les stations</option>
                {STATIONS.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
              <select value={filters.operator} onChange={e => setFilters(f => ({ ...f, operator: e.target.value }))} style={{ ...inp(), width: "auto", fontSize: 11, padding: "5px 8px" }}>
                <option value="">Tous les opérateurs</option>
                {OPERATORS.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
              </select>
              <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))} style={{ ...inp(), width: "auto", fontSize: 11, padding: "5px 8px" }}>
                <option value="">Tous les types</option>
                {Object.entries(PROMOTION_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button onClick={() => setFilters(f => ({ ...f, activeOnly: !f.activeOnly }))}
                style={{ fontSize: 11, fontWeight: 600, color: filters.activeOnly ? C.white : C.text, background: filters.activeOnly ? C.blue : C.white, border: `1px solid ${C.grayM}`, borderRadius: 7, padding: "5px 9px", cursor: "pointer" }}>
                {filters.activeOnly ? "Actives seulement" : "Toutes (actives + expirées)"}
              </button>
            </div>

            {filteredList.length === 0
              ? <p style={{ fontSize: 12, color: C.gray, textAlign: "center", padding: "16px 0", fontStyle: "italic" }}>Aucune promotion ne correspond à ces filtres.</p>
              : (
                <div style={cd()}>
                  {filteredList.map((p, i, arr) => {
                    const active = isPromotionActive(p, today);
                    return (
                      <div key={p.id || i} style={rw(i === arr.length - 1)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{p.operator_name}</span>
                            <Badge label={p.station_name} color={C.blueL} bg={C.bluePale} size={9} />
                            <Badge label={promotionTypeLabel(p.promotion_type)} color={C.purple} bg={C.purpleL} size={9} />
                            {!active && <Badge label="Expirée" color={C.gray} bg={C.grayL} size={9} />}
                          </div>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: C.gray }}>
                            {p.offer_title || p.original_promotion_text || "—"}
                            {p.discount_percent != null ? ` · -${p.discount_percent}%` : ""}
                            {p.starting_price != null ? ` · à partir de ${p.starting_price}€` : ""}
                          </p>
                          <p style={{ margin: "1px 0 0", fontSize: 10, color: C.gray }}>
                            Relevé le {String(p.collected_at || "").slice(0, 10)} · {p.reliability_status}
                            {p.source_url && <> · <a href={p.source_url} target="_blank" rel="noreferrer" style={{ color: C.blue }}>source</a></>}
                          </p>
                        </div>
                        <button onClick={() => handleDelete(p.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: C.gray, flexShrink: 0 }}>🗑</button>
                      </div>
                    );
                  })}
                </div>
              )}
          </>
        )}
      </div>
      <BNav />
    </div>
  );
}

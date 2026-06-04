// ══════════════════════════════════════════════════════════════════
// src/pages/Alerts.jsx
// Page Alertes : anomalies de prix & recommandations.
// Lecture seule — calcule les alertes via le moteur et les affiche.
// Reçoit données + helpers en props (pas de state propre).
// ══════════════════════════════════════════════════════════════════
import { C } from "../components/theme.js";
import AlertCard from "../components/AlertCard.jsx";
import { computeAlerts, ALERT_LEVELS } from "../domain/alerts.js";

export default function Alerts({
  ourRates, onlineRates, histAll, periods,
  styles, SBar, BNav, onNavigate,
}) {
  const { cnt, cd, responsiveGrid } = styles;
  const alerts = computeAlerts({ ourRates, onlineRates, competitorRates: histAll, periods });
  const byLevel = { critique: [], warning: [], info: [] };
  alerts.forEach(a => (byLevel[a.level] || byLevel.info).push(a));
  const counts = { critique: byLevel.critique.length, warning: byLevel.warning.length, info: byLevel.info.length };
  return (
    <div><SBar title="Alertes" />
      <div style={cnt}>
        <div style={{ ...cd(11), padding: "11px 13px", background: C.bluePale, marginTop: 8 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.blue }}>🔔 Alertes & anomalies</p>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: C.blueL }}>Anomalies de prix détectées automatiquement à partir de vos tarifs officiels, des prix vus en ligne et du marché concurrent.</p>
        </div>
        {/* Compteurs par niveau */}
        <div style={{ ...responsiveGrid(3), marginBottom: 8 }}>
          {[["critique", "Critiques"], ["warning", "À surveiller"], ["info", "Infos"]].map(([lv, l]) => {
            const m = ALERT_LEVELS[lv];
            return (
              <div key={lv} style={{ ...cd(10, 0), padding: "9px 12px", background: counts[lv] ? m.bg : C.white }}>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: counts[lv] ? m.color : C.grayM }}>{counts[lv]}</p>
                <p style={{ margin: 0, fontSize: 11, color: C.gray }}>{m.icon} {l}</p>
              </div>
            );
          })}
        </div>
        {alerts.length === 0
          ? <div style={{ ...cd(11), padding: "20px 14px", textAlign: "center" }}><p style={{ margin: 0, fontSize: 30 }}>✓</p><p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 600, color: C.green }}>Aucune anomalie détectée</p><p style={{ margin: "2px 0 0", fontSize: 11, color: C.gray }}>Vos tarifs, la diffusion en ligne et le positionnement marché sont cohérents.</p></div>
          : ["critique", "warning", "info"].flatMap(lv => byLevel[lv]).map((a, i) => (
            <AlertCard key={i} alert={a} meta={ALERT_LEVELS[a.level]} cd={cd} onAction={onNavigate} />
          ))}
      </div><BNav />
    </div>
  );
}

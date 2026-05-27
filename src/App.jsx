import { useState, useEffect, useCallback, useRef } from "react";

// ══ CONFIG ══════════════════════════════════════════════════════
const SB_URL = import.meta.env.VITE_SUPABASE_URL || "DEMO";
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "DEMO";
const SB_READY = SB_URL !== "DEMO" && SB_KEY !== "DEMO"
              && SB_URL.startsWith("https://") && SB_KEY.length > 20;

const IA_ENDPOINT = "/api/analyse-reco";

// ══ SUPABASE REST WRAPPER ════════════════════════════════════════
let _token = null;
const authHeaders = () => ({
  "apikey": SB_KEY,
  "Authorization": `Bearer ${_token || SB_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation",
});

const sbErrors = [];

const sb = {
  async rpc(path, body) {
    const r = await fetch(`${SB_URL}${path}`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { sbErrors.push({ ts: new Date().toISOString(), msg: d?.message || r.statusText, path }); throw new Error(d?.message || r.statusText); }
    return d;
  },
  async select(table, params = "") {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, { headers: authHeaders() });
    if (!r.ok) { const t = await r.text(); sbErrors.push({ ts: new Date().toISOString(), msg: t, path: table }); throw new Error(t); }
    return r.json();
  },
  async insert(table, body) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
    if (!r.ok) { const t = await r.text(); if (t.includes("unique") || t.includes("duplicate") || t.includes("23505")) throw new Error("DUPLICATE:" + t); sbErrors.push({ ts: new Date().toISOString(), msg: t, path: table }); throw new Error(t); }
    return r.json();
  },
  async update(table, filter, body) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(body) });
    if (!r.ok) { const t = await r.text(); throw new Error(t); }
    return r.json();
  },
  async delete(table, filter) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, { method: "DELETE", headers: authHeaders() });
    if (!r.ok) throw new Error(await r.text());
    return true;
  },
  async signIn(email, pwd) {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "apikey": SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pwd }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.message || "Identifiants incorrects");
    _token = d.access_token;
    try { sessionStorage.setItem("sb_token", d.access_token); sessionStorage.setItem("sb_user", JSON.stringify({ email: d.user?.email, id: d.user?.id })); } catch {}
    return d;
  },
  signOut() { _token = null; try { sessionStorage.removeItem("sb_token"); sessionStorage.removeItem("sb_user"); } catch {} },
  restoreSession() {
    try {
      const t = sessionStorage.getItem("sb_token");
      const u = sessionStorage.getItem("sb_user");
      if (t && u) { _token = t; return JSON.parse(u); }
    } catch {}
    return null;
  },
};

// ══ DONNÉES STATIQUES ═══════════════════════════════════════════
const DEFAULT_COMPETITORS = [
  { id: "cv",       name: "Les Chalets du Verdon", property_type: "résidence", source: "Vacancéole",     comparability_score: 88, has_pool: true,  has_ski_access: true  },
  { id: "cp",       name: "Central Park",           property_type: "résidence", source: "Labellemontagne",comparability_score: 82, has_pool: false, has_ski_access: false },
  { id: "goe",      name: "Goélia La Foux",          property_type: "résidence", source: "Goélia",         comparability_score: 85, has_pool: true,  has_ski_access: true  },
  { id: "ham",      name: "Hôtel du Hameau",          property_type: "hôtel",     source: "Booking",        comparability_score: 55, has_pool: false, has_ski_access: true  },
  { id: "airbnb_lf",name: "Airbnb La Foux",          property_type: "particulier",source: "Airbnb",        comparability_score: 60, has_pool: false, has_ski_access: false },
  { id: "bk_lf",   name: "Booking La Foux",          property_type: "particulier",source: "Booking",       comparability_score: 58, has_pool: false, has_ski_access: false },
  { id: "abr_lf",  name: "Abritel La Foux",          property_type: "particulier",source: "Abritel",       comparability_score: 56, has_pool: false, has_ski_access: false },
  { id: "pap_lf",  name: "PAP Vacances",             property_type: "particulier",source: "PAP",           comparability_score: 48, has_pool: false, has_ski_access: false },
];

const STATIC_WEEKS = (() => {
  const mns = ["jan","fév","mar","avr","mai","juin","juil","août","sept"];
  const evts = {
    "2026-07-11":"Vac. zone A","2026-07-14":"Fête Nat.","2026-07-18":"Vac. B/C","2026-08-15":"Assomption","2026-09-05":"Rentrée",
    "2027-07-10":"Vac. zone A","2027-07-14":"Fête Nat.","2027-07-17":"Vac. B/C","2027-08-15":"Assomption","2027-09-04":"Rentrée",
  };
  const rows = [];
  [2026, 2027].forEach(year => {
    let d = new Date(year, 5, 20);
    while (d.getDay() !== 6) d = new Date(d.getTime() + 864e5);
    let wn = 1;
    while (d < new Date(year, 8, 13)) {
      const e = new Date(d.getTime() + 6 * 864e5);
      const m = d.getMonth();
      const fmt = dt => `${dt.getDate()} ${mns[dt.getMonth()]}`;
      const key = `${year}-${String(m+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      let cat = "basse";
      if (m === 7) cat = "haute";
      else if (m === 6 && d.getDate() >= 11) cat = "haute";
      else if (m === 6) cat = "moyenne";
      else if (m === 5 && d.getDate() >= 27) cat = "moyenne";
      rows.push({ id: `${year}_w${wn}`, year, week_start: d.toISOString().slice(0,10), label: `${fmt(d)} → ${fmt(e)}`, month_label: ["Juin","Juil.","Août","Sept."][m-5]||"", season_type: cat, event_label: evts[key]||null });
      d = new Date(d.getTime() + 7 * 864e5); wn++;
    }
  });
  return rows;
})();

const OUR_TARIFS = {
  "2p": { haute:245, moyenne:195, basse:145 },
  "4p": { haute:359, moyenne:280, basse:210 },
  "6p": { haute:428, moyenne:340, basse:259 },
  "8p": { haute:489, moyenne:390, basse:290 },
};

// ══ HELPERS ══════════════════════════════════════════════════════
function isDuplicate(existing, rate) {
  if (rate.competitor_id) {
    return existing.some(r =>
      r.week_id       === rate.week_id &&
      r.competitor_id === rate.competitor_id &&
      r.capacity      === rate.capacity &&
      r.collected_at  === rate.collected_at &&
      r.source        === rate.source
    );
  }
  return existing.some(r =>
    !r.competitor_id &&
    r.week_id      === rate.week_id &&
    r.property_name === rate.property_name &&
    r.source        === rate.source &&
    r.capacity      === rate.capacity &&
    r.collected_at  === rate.collected_at
  );
}

function enrichRates(rawRates, competitors) {
  return rawRates.map(r => {
    const comp = competitors.find(c => c.id === r.competitor_id || c.source === r.source);
    return {
      ...r,
      comparability_score: r.competitors?.comparability_score ?? comp?.comparability_score ?? 50,
      property_type: r.competitors?.property_type ?? comp?.property_type ?? r.type ?? "particulier",
      competitor_name: r.competitors?.name ?? comp?.name ?? r.property_name ?? r.source,
    };
  });
}

const ls = {
  get: k => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  push: (k, item) => { const arr = ls.get(k); ls.set(k, [...arr.filter(x => x.id !== item.id), item]); },
};

function stripUserId(rate) {
  const { user_id, ...rest } = rate;
  return rest;
}

async function getCompetitorRates({ weekId, capacity, showExamples = false }, allCompetitors) {
  let raw = [];
  if (SB_READY) {
    let q = `week_id=eq.${weekId}&capacity=eq.${capacity}&order=collected_at.desc`;
    q += `&select=*,competitors(id,name,property_type,comparability_score,has_pool,has_ski_access)`;
    if (!showExamples) q += `&is_example=eq.false`;
    raw = await sb.select("competitor_rates", q);
  } else {
    raw = ls.get(`rates_${weekId}_${capacity}`).filter(r => showExamples || !r.is_example);
  }
  return enrichRates(raw || [], allCompetitors);
}

async function saveCompetitorRate(rate, allCompetitors) {
  const clean = stripUserId(rate);
  if (SB_READY) {
    if (clean.competitor_id) {
      const ex = await sb.select("competitor_rates",
        `week_id=eq.${clean.week_id}&competitor_id=eq.${clean.competitor_id}&capacity=eq.${clean.capacity}&collected_at=eq.${clean.collected_at}&source=eq.${encodeURIComponent(clean.source)}&select=id`);
      if (ex?.length) throw new Error("DUPLICATE");
    } else if (clean.property_name) {
      const ex = await sb.select("competitor_rates",
        `week_id=eq.${clean.week_id}&property_name=eq.${encodeURIComponent(clean.property_name)}&source=eq.${encodeURIComponent(clean.source)}&capacity=eq.${clean.capacity}&collected_at=eq.${clean.collected_at}&competitor_id=is.null&select=id`);
      if (ex?.length) throw new Error("DUPLICATE");
    }
    return sb.insert("competitor_rates", clean);
  }
  const id    = "r_" + Date.now();
  const full  = { ...clean, id };
  const key   = `rates_${clean.week_id}_${clean.capacity}`;
  const existing = ls.get(key);
  if (isDuplicate(existing, clean)) throw new Error("DUPLICATE");
  ls.push(key, full);
  return full;
}

async function deleteCompetitorRate(id, weekId, capacity) {
  if (SB_READY) return sb.delete("competitor_rates", `id=eq.${id}`);
  const key = `rates_${weekId}_${capacity}`;
  ls.set(key, ls.get(key).filter(r => r.id !== id));
}

async function getHistoricalRates({ weekId, competitorId, capacity }) {
  if (SB_READY) {
    const q = `week_id=eq.${weekId}&competitor_id=eq.${competitorId}&capacity=eq.${capacity}&order=collected_at.asc&select=*,competitors(name)`;
    return sb.select("competitor_rates", q);
  }
  return ls.get(`rates_${weekId}_${capacity}`).filter(r => r.competitor_id === competitorId).sort((a,b) => a.collected_at.localeCompare(b.collected_at));
}

async function getImports() {
  if (SB_READY) return sb.select("imports", "order=imported_at.desc&limit=5");
  return ls.get("imports").slice(-5).reverse();
}

async function saveImportLog(log) {
  if (SB_READY) return sb.insert("imports", log);
  ls.push("imports", { ...log, id: "imp_" + Date.now() });
}

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function calcReco(ourPrice, rates, settings = {}) {
  const { thresholdLow = 15, thresholdHigh = 20, obsoleteDays = 7, minScore = 70 } = settings;
  const now = new Date();
  const age = d => d ? Math.floor((now - new Date(d)) / 864e5) : 999;

  const qualified   = rates.filter(r => !r.is_example && (r.comparability_score ?? 50) >= minScore);
  const excluded    = rates.filter(r => !r.is_example && (r.comparability_score ?? 50) < minScore);
  const recent      = qualified.filter(r => age(r.collected_at) <= obsoleteDays);
  const hasOld      = qualified.some(r => age(r.collected_at) > obsoleteDays);
  const maxAge      = qualified.length ? Math.max(...qualified.map(r => age(r.collected_at))) : null;

  const byType  = t => qualified.filter(r => r.property_type === t);
  const prices  = arr => arr.map(r => Number(r.price_week)).filter(Boolean);

  const medAll  = median(prices(qualified));
  const medRes  = median(prices(byType("résidence")));
  const medPart = median(prices(byType("particulier")));
  const medHot  = median(prices(byType("hôtel")));
  const ref     = medRes ?? medAll;

  const hasEnough = qualified.length >= 3;
  const promoCount = rates.filter(r => r.promo_label).length;
  const confidence = !hasEnough ? "faible" : (qualified.length >= 5 && recent.length >= 3) ? "fort" : "moyen";
  const confScore  = { faible: 20, moyen: 55, fort: 85 }[confidence];

  let action = "Maintenir", urgency = "normal", explanation = "";
  const low    = ref ? Math.round(ref * 0.95) : (ourPrice || 0);
  const target = ref ? Math.round(ref * 1.02) : (ourPrice || 0);
  const high   = ref ? Math.round(ref * 1.18) : (ourPrice || 0);

  if (!ref) {
    action = "Relevé insuffisant"; urgency = "haut";
    explanation = `${qualified.length} concurrent(s) qualifié(s) (score ≥${minScore}). Minimum 3 requis.`;
  } else if (ourPrice) {
    const pct = (ourPrice - ref) / ref * 100;
    if (pct < -thresholdLow)      { action = "Augmenter le tarif"; urgency = "haut"; explanation = `Tarif ${Math.abs(Math.round(pct))}% sous la médiane résidences (${ref.toLocaleString("fr-FR")}€). Potentiel +${(ref - ourPrice).toLocaleString("fr-FR")}€/sem.`; }
    else if (pct > thresholdHigh) { action = "Baisser ou créer une promo"; urgency = "moyen"; explanation = `Tarif ${Math.round(pct)}% au-dessus de la médiane (${ref.toLocaleString("fr-FR")}€).`; }
    else if (promoCount >= 3)     { action = "Surveiller les promotions"; urgency = "moyen"; explanation = `${promoCount} concurrents en promotion.`; }
    else                          { action = "Maintenir"; urgency = "normal"; explanation = `Bien positionné (${pct >= 0 ? "+" : ""}${Math.round(pct)}% vs ${ref.toLocaleString("fr-FR")}€ médiane).`; }
  }
  if (hasOld) explanation += " ⚠ Relevés partiellement obsolètes.";

  return {
    medAll, medRes, medPart, medHot, ref, low, target, high,
    action, urgency, confidence, confScore, explanation,
    hasEnough, promoCount, ratesCount: qualified.length,
    excludedCount: excluded.length, recentCount: recent.length,
    dataAgeDays: maxAge, hasOld,
  };
}

function parsePaste(text, source, weekId, capacity) {
  const full = text.toLowerCase();
  const priceRe = /(\d[\d\s]{1,5})\s*€|€\s*(\d[\d\s]{1,5})|\b(\d{2,4})\b(?=\s*(?:€|eur|\s*\/\s*(?:nuit|sem|semaine)))/gi;
  const pricesSet = new Set();
  let m;
  while ((m = priceRe.exec(text)) !== null) {
    const v = parseFloat((m[1]||m[2]||m[3]).replace(/\s/g,""));
    if (v >= 30 && v <= 8000) pricesSet.add(v);
  }
  const prices = [...pricesSet].sort((a,b)=>a-b);

  let originalPrice = null;
  const barreM = text.match(/(?:de|était|barré|avant|au lieu de)\s*:?\s*([\d\s]{3,6})\s*€/i);
  if (barreM) { const v = parseFloat(barreM[1].replace(/\s/g,"")); if (v>0) originalPrice=v; }

  let promoLabel = null, promoPercent = 0;
  if (/genius/i.test(full))                   { promoLabel="Genius -10%"; promoPercent=10; }
  else if (/last[\s-]?minute/i.test(full))    { promoLabel="Last minute"; promoPercent=15; }
  else if (/early[\s-]?booking/i.test(full))  { promoLabel="Early booking"; promoPercent=10; }
  else if (/petit[\s-]?d[eé]j/i.test(full))  { promoLabel="PDJ inclus"; }
  else if (/annulation\s*gratuite/i.test(full)){ promoLabel="Annulation gratuite"; }
  else { const pm=full.match(/-(\d{1,2})\s*%/); if(pm){ promoPercent=parseInt(pm[1]); promoLabel=`-${promoPercent}%`; } }

  const ratingM = text.match(/(\d[,.]?\d?)\s*\/\s*10|note\s*[^:]*:\s*(\d[,.]?\d?)/i);
  const rating = ratingM ? parseFloat((ratingM[1]||ratingM[2]).replace(",",".")) : null;

  const feeM = text.match(/(?:frais\s*(?:de\s*)?m[eé]nage|cleaning fee)\s*:?\s*([\d\s]+)\s*€/i);
  const cleaningFee = feeM ? parseFloat(feeM[1].replace(/\s/g,"")) : 0;

  const capM = text.match(/(\d)\s*(?:personnes?|pers\.|voyageurs?|guests?)/i);
  const detectedCap = capM ? parseInt(capM[1]) : capacity;

  const isNight = /par nuit|\/nuit|per night|nightly/i.test(text);
  const nightPrices = prices.filter(p => p < 500);
  const weekPrices  = prices.filter(p => p >= 200 && p <= 5000);
  let priceWeek = 0, priceNight = 0;
  if (isNight && nightPrices.length) {
    priceNight = nightPrices[Math.floor(nightPrices.length/2)];
    priceWeek  = Math.round(priceNight * 7);
  } else if (weekPrices.length) {
    priceWeek  = weekPrices[Math.floor(weekPrices.length/2)];
    priceNight = Math.round(priceWeek / 7);
  } else if (prices.length) {
    priceWeek  = prices[0];
    priceNight = Math.round(priceWeek / 7);
  }

  return {
    allPrices: prices, warning: !priceWeek ? "Aucun prix détecté. Vérifiez le texte collé." : null,
    priceWeek, priceNight, originalPrice, promoLabel, promoPercent, cleaningFee, rating, detectedCap,
  };
}

// ══ UI HELPERS ═══════════════════════════════════════════════════
const C = { blue:"#1B3A6B", blueL:"#2E5FAC", bluePale:"#EEF4FF", green:"#1A7A5E", greenL:"#E6F4EF", orange:"#D45400", orangeL:"#FFF0E6", red:"#B91C1C", redL:"#FEE2E2", purple:"#6D28D9", purpleL:"#EDE9FE", gold:"#92400E", goldL:"#FEF3C7", gray:"#6B7280", grayL:"#F3F4F6", grayM:"#E5E7EB", white:"#FFF", text:"#111827", textS:"#6B7280" };
const fmt     = n => typeof n==="number" ? n.toLocaleString("fr-FR") : "—";
const fmtPct  = n => (n>=0?"+":"")+Math.round(n)+"%";
const daysSince = d => d ? Math.floor((Date.now()-new Date(d))/864e5) : 999;
const CAT_C   = { haute:"#D45400", moyenne:C.blueL, basse:C.green };
const CAT_L   = { haute:"Haute saison", moyenne:"Moy. saison", basse:"Basse saison" };

function Badge({ label, color, bg, size=10 }) {
  return <span style={{ fontSize:size, fontWeight:700, background:bg, color, padding:"2px 6px", borderRadius:4, whiteSpace:"nowrap" }}>{label}</span>;
}
function ReliaBadge({ status }) {
  const m = { réel:{bg:C.greenL,c:C.green}, "saisi manuellement":{bg:C.bluePale,c:C.blue}, "importé CSV":{bg:C.purpleL,c:C.purple}, "copier-coller":{bg:"#F3E8FF",c:C.purple}, "à vérifier":{bg:C.goldL,c:C.orange}, estimé:{bg:C.goldL,c:C.gold}, "scraping-auto":{bg:"#F0FDF4",c:"#166534"} }[status]||{bg:C.grayL,c:C.gray};
  return <span style={{ fontSize:9, fontWeight:600, background:m.bg, color:m.c, padding:"1px 5px", borderRadius:4 }}>{status}</span>;
}
function PromoBadge({ label }) {
  if (!label) return null;
  const m = { "Genius -10%":{bg:"#DBEAFE",c:"#1D40AE"}, "Last minute":{bg:C.redL,c:C.red}, "Early booking":{bg:C.greenL,c:C.green}, "PDJ inclus":{bg:C.purpleL,c:C.purple}, "Annulation gratuite":{bg:C.greenL,c:C.green} }[label]||{bg:C.orangeL,c:C.orange};
  const short = label.replace("Genius -10%","GENIUS").replace("Last minute","LAST MIN").replace("Early booking","EARLY").replace("PDJ inclus","PDJ").replace("Annulation gratuite","ANNUL.").slice(0,12);
  return <span style={{ fontSize:9, fontWeight:700, background:m.bg, color:m.c, padding:"2px 5px", borderRadius:4 }}>{short}</span>;
}

// ══ LOGIN SCREEN (défini hors de App pour éviter le re-mount à chaque frappe) ══
function LoginScreen({ loginErr, SB_READY, loginEmail, setLE, loginPwd, setLP, loginLoading, handleLogin }) {
  const sml = { fontSize:10, fontWeight:700, color:C.gray, margin:"12px 2px 5px", letterSpacing:"0.06em", textTransform:"uppercase" };
  const inp = (extra={}) => ({ width:"100%", padding:"8px 10px", fontSize:13, border:`1px solid ${C.grayM}`, borderRadius:9, background:C.white, color:C.text, boxSizing:"border-box", ...extra });
  const btn = (dis,bg=C.blue,fg=C.white) => ({ width:"100%", padding:"12px", fontSize:14, fontWeight:600, background:dis?"#C7C7CC":bg, color:fg, border:"none", borderRadius:11, cursor:dis?"not-allowed":"pointer", marginBottom:6 });
  return (
    <div style={{ padding:"60px 28px 0" }}>
      <div style={{ width:52, height:52, background:C.blue, borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:22 }}><span style={{ fontSize:26 }}>⛰</span></div>
      <h1 style={{ margin:"0 0 5px", fontSize:21, fontWeight:700, color:C.text }}>Benchmark Été</h1>
      <p style={{ margin:"0 0 30px", fontSize:12, color:C.textS }}>Les Cimes du Val d'Allos · Accès privé</p>
      {loginErr && <div style={{ background:C.redL, borderRadius:9, padding:"9px 12px", marginBottom:10 }}><p style={{ margin:0, fontSize:12, color:C.red, fontWeight:600 }}>✗ {loginErr}</p></div>}
      {!SB_READY && <div style={{ background:C.goldL, borderRadius:9, padding:"9px 12px", marginBottom:10 }}><p style={{ margin:0, fontSize:10, color:C.gold }}>Mode démo — saisir n'importe quel email/mot de passe.</p></div>}
      <p style={sml}>Email</p>
      <input type="email" style={{ ...inp(), marginBottom:10 }} value={loginEmail} onChange={e=>setLE(e.target.value)} placeholder="votre@email.com" autoComplete="email"/>
      <p style={sml}>Mot de passe</p>
      <input type="password" style={{ ...inp(), marginBottom:16 }} value={loginPwd} onChange={e=>setLP(e.target.value)} placeholder="••••••••" autoComplete="current-password" onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
      <button style={btn(loginLoading)} onClick={handleLogin} disabled={loginLoading}>{loginLoading?"Connexion…":"Se connecter →"}</button>
      <p style={{ fontSize:9, color:C.gray, textAlign:"center", marginTop:12, lineHeight:1.5 }}>Application privée · Données confidentielles<br/>Config : VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY dans .env.local</p>
    </div>
  );
}

// ══ APP ══════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen]       = useState("login");
  const [user, setUser]           = useState(null);
  const [loginEmail, setLE]       = useState("");
  const [loginPwd, setLP]         = useState("");
  const [loginErr, setLErr]       = useState("");
  const [loginLoading, setLL]     = useState(false);

  const [yr, setYr]               = useState(2026);
  const [cap, setCap]             = useState("6p");
  const [selWeekId, setSWId]      = useState("2026_w7");
  const [competitors, setComps]   = useState(DEFAULT_COMPETITORS);
  const [rates, setRates]         = useState([]);
  const [ratesLoading, setRL]     = useState(false);
  const [showExamples, setSE]     = useState(false);
  const [tab, setTab]             = useState("detail");
  const [collectMode, setCM]      = useState(null);
  const [formSaved, setFS]        = useState(null);
  const [deleteConfirm, setDC]    = useState(null);
  const [history, setHistory]     = useState([]);
  const [imports, setImports]     = useState([]);
  const [iaText, setIaText]       = useState(null);
  const [iaLoading, setIaL]       = useState(false);
  const [iaError, setIaError]     = useState(null);
  const [settings]                = useState({ thresholdLow:15, thresholdHigh:20, obsoleteDays:7, minScore:70 });

  const [csvText, setCsvText]     = useState("");
  const [csvResult, setCsvResult] = useState(null);
  const [csvLoading, setCsvLoad]  = useState(false);

  // ── NOUVEAU : état scraping automatique ──────────────────────
  const [scraping, setScraping]       = useState(false);
  const [scrapedRates, setScrapedRates] = useState([]);
  const [scrapeError, setScrapeError]   = useState("");
  const [scrapeSaved, setScrapeSaved]   = useState({});

  const emptyForm = { weekId:"2026_w7", competitorId:"cv", source:"", type:"résidence", capacity:6, priceWeek:"", priceNight:"", originalPrice:"", promoLabel:"", promoPercent:"", cleaningFee:"", url:"", collectedAt:new Date().toISOString().slice(0,10), notes:"" };
  const [form, setForm] = useState(emptyForm);

  const [pasteSrc, setPasteSrc]   = useState("Booking");
  const [pasteWeekId, setPWId]    = useState("2026_w7");
  const [pasteCap, setPCap]       = useState(6);
  const [pasteCompId, setPComp]   = useState("cv");
  const [pasteRaw, setPasteRaw]   = useState("");
  const [pasteEdit, setPasteEdit] = useState(null);
  const [pasteSaving, setPasteSaving] = useState(false);

  const [lastImportStats, setLastImportStats] = useState(null);
  const fileRef = useRef();

  const selWeek   = STATIC_WEEKS.find(w => w.id === selWeekId) || STATIC_WEEKS[6];
  const capNum    = parseInt(cap);
  const ourPrice  = OUR_TARIFS[cap]?.[selWeek?.season_type] || 0;
  const ourNight  = Math.round(ourPrice / 7);
  const reco      = calcReco(ourPrice, rates, settings);

  // ── Auth ──────────────────────────────────────────────────────
  useEffect(() => {
    const restored = sb.restoreSession();
    if (restored) { setUser(restored); setScreen("dashboard"); }
  }, []);

  async function handleLogin() {
    setLErr(""); setLL(true);
    try {
      if (SB_READY) {
        const d = await sb.signIn(loginEmail, loginPwd);
        setUser({ email: d.user?.email || loginEmail, id: d.user?.id });
      } else {
        if (!loginEmail || !loginPwd) { setLErr("Email et mot de passe requis."); setLL(false); return; }
        setUser({ email: loginEmail, demo: true });
      }
      setScreen("dashboard");
    } catch(e) { setLErr(e.message); }
    setLL(false);
  }

  function handleLogout() { sb.signOut(); setUser(null); setScreen("login"); setRates([]); }

  // ── Charger relevés ───────────────────────────────────────────
  const loadRates = useCallback(async () => {
    if (!selWeekId || !capNum) return;
    setRL(true);
    setScrapedRates([]);
    setScrapeSaved({});
    setScrapeError("");
    try { const d = await getCompetitorRates({ weekId:selWeekId, capacity:capNum, showExamples }, competitors); setRates(d||[]); }
    catch(e) { console.error(e); setRates([]); }
    setRL(false);
  }, [selWeekId, capNum, showExamples, competitors]);

  useEffect(() => { if (user) loadRates(); }, [loadRates, user]);

  useEffect(() => {
    if (user) getImports().then(setImports).catch(() => {});
  }, [user]);

  // ── Sauver saisie manuelle ────────────────────────────────────
  async function handleSaveForm() {
    if (!form.priceWeek) return;
    const comp = competitors.find(c => c.id === form.competitorId);
    try {
      await saveCompetitorRate({
        week_id: form.weekId, competitor_id: form.competitorId || null,
        source: form.source || comp?.source || "",
        property_name: comp?.name || form.source,
        property_type: comp?.property_type || form.type,
        capacity: parseInt(form.capacity) || capNum,
        price_week: parseFloat(form.priceWeek) || 0,
        price_night: form.priceNight ? parseFloat(form.priceNight) : Math.round((parseFloat(form.priceWeek)||0)/7),
        original_price: form.originalPrice ? parseFloat(form.originalPrice) : null,
        promo_label: form.promoLabel||null, promo_percent: parseFloat(form.promoPercent)||0,
        cleaning_fee: parseFloat(form.cleaningFee)||0,
        url: form.url, collected_at: form.collectedAt, notes: form.notes,
        collection_type:"manuelle", reliability_status:"saisi manuellement", is_example:false,
      }, competitors);
      setFS("ok"); setForm({ ...emptyForm, weekId:form.weekId }); loadRates();
    } catch(e) { setFS(e.message.includes("DUPLICATE") ? "duplicate" : "error"); }
    setTimeout(() => setFS(null), 3000);
  }

  // ── Copier-coller ─────────────────────────────────────────────
  function handleParse() {
    if (!pasteRaw.trim()) return;
    const ex = parsePaste(pasteRaw, pasteSrc, pasteWeekId, pasteCap);
    setPasteEdit({
      priceWeek:    ex.priceWeek || "",
      priceNight:   ex.priceNight || "",
      originalPrice:ex.originalPrice || "",
      promoLabel:   ex.promoLabel || "",
      promoPercent: ex.promoPercent || 0,
      cleaningFee:  ex.cleaningFee || 0,
      rating:       ex.rating || "",
      capacity:     ex.detectedCap || pasteCap,
      source:       pasteSrc,
      competitorId: pasteCompId,
      warning:      ex.warning,
      allPrices:    ex.allPrices,
    });
  }

  async function handleSavePaste() {
    if (!pasteEdit?.priceWeek) return;
    setPasteSaving(true);
    const comp = competitors.find(c => c.id === pasteEdit.competitorId);
    try {
      await saveCompetitorRate({
        week_id: pasteWeekId, competitor_id: pasteEdit.competitorId || null,
        source: pasteEdit.source, property_name: comp?.name || pasteEdit.source,
        property_type: comp?.property_type || "particulier",
        capacity: parseInt(pasteEdit.capacity) || pasteCap,
        price_week: parseFloat(pasteEdit.priceWeek) || 0,
        price_night: parseFloat(pasteEdit.priceNight) || Math.round((parseFloat(pasteEdit.priceWeek)||0)/7),
        original_price: pasteEdit.originalPrice ? parseFloat(pasteEdit.originalPrice) : null,
        promo_label: pasteEdit.promoLabel || null, promo_percent: parseFloat(pasteEdit.promoPercent)||0,
        cleaning_fee: parseFloat(pasteEdit.cleaningFee)||0, booking_rating: parseFloat(pasteEdit.rating)||null,
        collected_at: new Date().toISOString().slice(0,10),
        collection_type: "copier-coller", reliability_status: "à vérifier", is_example: false,
        notes: `Extrait de ${pasteEdit.source} via copier-coller. Vérifié et validé manuellement.`,
      }, competitors);
      setPasteEdit(null); setPasteRaw(""); setFS("ok"); loadRates();
    } catch(e) { setFS(e.message.includes("DUPLICATE") ? "duplicate" : "error"); }
    setPasteSaving(false);
    setTimeout(() => setFS(null), 3000);
  }

  // ── Import CSV ────────────────────────────────────────────────
  async function handleImportCsv() {
    if (!csvText.trim()) return;
    setCsvLoad(true);
    const lines = csvText.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) { setCsvResult({ ok:0, dup:0, skipped:0, errors:["Fichier vide ou sans données"] }); setCsvLoad(false); return; }
    const sep = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/[^a-z_]/g,""));
    const rows = lines.slice(1).map((line) => {
      const vals = line.split(sep).map(v => v.trim().replace(/^"|"$/g,""));
      const o = {}; headers.forEach((h,i) => o[h] = vals[i]||"");
      const week = STATIC_WEEKS.find(w => w.week_start === o.week_start || w.id === o.week_id);
      const pw = parseFloat(o.price_week)||0;
      const pn = parseFloat(o.price_night)||Math.round(pw/7);
      const comp = competitors.find(c => c.name === o.property_name || c.source === o.source);
      return {
        week_id: week?.id || "",
        source: o.source, property_name: o.property_name || o.source,
        property_type: o.property_type || comp?.property_type || "particulier",
        competitor_id: comp?.id || null,
        capacity: parseInt(o.capacity) || capNum,
        price_week: pw, price_night: pn,
        original_price: parseFloat(o.original_price)||null,
        promo_label: o.promo_label||null, promo_percent: parseFloat(o.promo_percent)||0,
        cleaning_fee: parseFloat(o.cleaning_fee)||0,
        tourist_tax: parseFloat(o.tourist_tax)||0,
        url: o.url||"",
        collected_at: o.collected_at||new Date().toISOString().slice(0,10),
        reliability_status: o.reliability_status||"importé CSV",
        collection_type: "csv", is_example: false,
      };
    }).filter(r => r.week_id);

    let ok=0, dup=0, skipped=0; const errors=[];
    for (const row of rows) {
      if (!row.price_week || !row.source) { skipped++; continue; }
      try { await saveCompetitorRate(row, competitors); ok++; }
      catch(e) { if (e.message?.includes("DUPLICATE")) dup++; else errors.push(e.message); }
    }
    const log = { import_source:"CSV", rows_total:rows.length+skipped, rows_imported:ok, rows_skipped:skipped, rows_duplicate:dup, rows_error:errors.length, status:errors.length===0?"ok":ok>0?"partiel":"erreur" };
    await saveImportLog(log);
    setCsvResult({ ok, dup, skipped, errors:errors.slice(0,4) });
    if (ok > 0) { loadRates(); getImports().then(setImports).catch(()=>{}); }
    setCsvLoad(false);
  }

  // ── Supprimer relevé ──────────────────────────────────────────
  async function handleDelete(rate) {
    await deleteCompetitorRate(rate.id, rate.week_id, rate.capacity);
    setDC(null); loadRates();
  }

  // ── Analyse IA ────────────────────────────────────────────────
  async function runIA() {
    setIaL(true); setIaText(null); setIaError(null);
    const payload = {
      weekLabel: selWeek?.label, weekYear: selWeek?.year,
      seasonType: CAT_L[selWeek?.season_type] || "", eventLabel: selWeek?.event_label || "",
      cap, ourPrice, ourNight,
      rates: rates.slice(0, 8).map(r => ({
        source: r.source, competitor_name: r.competitor_name,
        price_week: r.price_week, promo_label: r.promo_label,
        reliability_status: r.reliability_status, collected_at: r.collected_at,
        comparability_score: r.comparability_score,
      })),
      reco: { medRes: reco.medRes, medPart: reco.medPart, medAll: reco.medAll,
              action: reco.action, confidence: reco.confidence, confScore: reco.confScore,
              ratesCount: reco.ratesCount, excludedCount: reco.excludedCount,
              recentCount: reco.recentCount, hasOld: reco.hasOld },
      settings,
    };
    try {
      let res = await fetch(IA_ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 404) {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 800,
            messages: [{ role: "user", content: buildIAPrompt(payload) }] }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error((d.error?.message || `HTTP ${res.status}`) + "\n→ Déployer api/analyse-reco.js sur Vercel avec ANTHROPIC_API_KEY.");
        }
        const d = await res.json();
        const raw = d.content?.map(b => b.text || "").join("") || "";
        setIaText(raw.split("---").map(s => s.replace(/^\s*\d\.\s*(POSITIONNEMENT|RISQUES|RECOMMANDATION|ACTION.*?)\s*:?\s*/i, "").trim()));
      } else {
        if (!res.ok) { const d = await res.json().catch(()=>{}); throw new Error(d?.error || `HTTP ${res.status}`); }
        const d = await res.json();
        setIaText(d.parts || []);
      }
    } catch(e) { setIaError(e.message); }
    setIaL(false);
  }

  function buildIAPrompt({ weekLabel, weekYear, seasonType, eventLabel, cap, ourPrice, ourNight, rates, reco, settings }) {
    const ratesSummary = (rates||[]).map(r=>`- ${r.competitor_name||r.source}${r.promo_label?` [${r.promo_label}]`:""}: ${r.price_week}€/sem · score ${r.comparability_score||"?"}/100 · ${r.reliability_status} · il y a ${daysSince(r.collected_at)}j`).join("\n")||"Aucun relevé.";
    return `Expert revenue management résidence Les Cimes du Val d'Allos 3*** (piscine, sauna, ski aux pieds).

SEMAINE : ${weekLabel} ${weekYear} — ${seasonType}${eventLabel?` — ${eventLabel}`:""}
NOS TARIFS : ${ourPrice}€/sem (${ourNight}€/nuit) — ${cap}

RELEVÉS CONCURRENTS (${rates?.length||0}) :
${ratesSummary}

Médianes (vraie médiane statistique) : résidences ${fmt(reco?.medRes)}€ | particuliers ${fmt(reco?.medPart)}€ | global ${fmt(reco?.medAll)}€
Recommandation : ${reco?.action} · confiance ${reco?.confidence} (${reco?.confScore}/100)
Concurrents qualifiés (score≥${settings?.minScore||70}) : ${reco?.ratesCount} · exclus : ${reco?.excludedCount} · récents : ${reco?.recentCount}${reco?.hasOld?" ⚠ données obsolètes":""}

ANALYSE 4 BLOCS séparés par "---" (2 phrases max chacun) :
1. POSITIONNEMENT : tarif vs résidences, écarts en €, concurrents les plus agressifs
2. RISQUES : menace principale (données, promo, sur/sous-tarification)
3. RECOMMANDATION : prix cible €/sem + €/nuit, fourchette basse/cible/haute
4. ACTION : une action immédiate et concrète`;
  }

  // ── NOUVEAU : Scraping automatique via /api/scrape-market (Vercel) ──
  async function scrapeMarket() {
    setScraping(true);
    setScrapeError("");
    setScrapedRates([]);
    setScrapeSaved({});

    const w = selWeek;

    try {
      const res = await fetch("/api/scrape-market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekLabel: w?.label || "",
          weekStart: w?.week_start || "",
          capacity: capNum,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.warning) setScrapeError("⚠ " + data.warning);
      if (!data.listings?.length) throw new Error("Aucun logement trouvé. Réessayez.");
      setScrapedRates(data.listings);

    } catch(e) {
      setScrapeError("Erreur : " + e.message);
    }
    setScraping(false);
  }

  async function saveScrapedRate(item, idx) {
    const pw = item.price_week ? Math.round(item.price_week) : item.price_night ? Math.round(item.price_night * 7) : 0;
    const pn = item.price_night ? Math.round(item.price_night) : pw ? Math.round(pw / 7) : 0;
    try {
      await saveCompetitorRate({
        week_id: selWeekId,
        source: item.platform || "Scraping",
        property_name: item.name,
        property_type: item.property_type || "particulier",
        competitor_id: null,
        capacity: capNum,
        price_week: pw,
        price_night: pn,
        booking_rating: item.rating || null,
        url: item.url || "",
        collected_at: new Date().toISOString().slice(0, 10),
        collection_type: "scraping-auto",
        reliability_status: "à vérifier",
        is_example: false,
        notes: `Collecté automatiquement via web search depuis ${item.platform || "Booking/Airbnb"}.`,
      }, competitors);
      setScrapeSaved(prev => ({ ...prev, [idx]: "ok" }));
      loadRates();
    } catch(e) {
      setScrapeSaved(prev => ({ ...prev, [idx]: e.message?.includes("DUPLICATE") ? "dup" : "err" }));
    }
  }

  // ── Styles ────────────────────────────────────────────────────
  const ph   = { width:390, margin:"0 auto", fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", background:C.grayL, minHeight:760, borderRadius:44, overflow:"hidden", border:`0.5px solid ${C.grayM}` };
  const sbar = { height:46, display:"flex", alignItems:"flex-end", justifyContent:"space-between", padding:"0 20px 6px", background:C.grayL };
  const cnt  = { padding:"0 14px 80px" };
  const cd   = (r=14,mb=8) => ({ background:C.white, borderRadius:r, overflow:"hidden", marginBottom:mb });
  const rw   = last => ({ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 13px", borderBottom:last?"none":`0.5px solid ${C.grayL}` });
  const btn  = (dis,bg=C.blue,fg=C.white) => ({ width:"100%", padding:"12px", fontSize:14, fontWeight:600, background:dis?"#C7C7CC":bg, color:fg, border:"none", borderRadius:11, cursor:dis?"not-allowed":"pointer", marginBottom:6 });
  const sml  = { fontSize:10, fontWeight:700, color:C.gray, margin:"12px 2px 5px", letterSpacing:"0.06em", textTransform:"uppercase" };
  const inp  = (extra={}) => ({ width:"100%", padding:"8px 10px", fontSize:13, border:`1px solid ${C.grayM}`, borderRadius:9, background:C.white, color:C.text, boxSizing:"border-box", ...extra });
  const tabB = a => ({ flex:1, padding:"8px 2px", fontSize:11, fontWeight:a?700:400, background:a?C.white:"transparent", color:a?C.blue:C.gray, border:"none", borderRadius:8, cursor:"pointer" });

  const SBar = ({ title }) => (
    <div style={sbar}>
      <span style={{ fontSize:13, fontWeight:600, color:C.text }}>{title||"Benchmark Été"}</span>
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        {user && <button onClick={handleLogout} style={{ fontSize:10, color:C.gray, background:"none", border:"none", cursor:"pointer" }}>Déco.</button>}
        <Badge label={SB_READY?"SUPABASE":"LOCAL"} color={SB_READY?C.green:C.gold} bg={SB_READY?C.greenL:C.goldL} size={9}/>
      </div>
    </div>
  );

  const SaveFeedback = () => formSaved ? (
    <div style={{ ...cd(9), padding:"9px 12px", background:formSaved==="ok"?C.greenL:formSaved==="duplicate"?C.goldL:C.redL, marginBottom:6 }}>
      <p style={{ margin:0, fontSize:12, fontWeight:700, color:formSaved==="ok"?C.green:formSaved==="duplicate"?C.gold:C.red }}>
        {formSaved==="ok" ? `✓ Enregistré dans ${SB_READY?"Supabase":"mémoire locale"}` : formSaved==="duplicate" ? "⚠ Doublon — relevé déjà existant pour cette date et ce concurrent" : "✗ Erreur d'enregistrement"}
      </p>
    </div>
  ) : null;

  const NAV = [{id:"dashboard",icon:"▣",l:"Dashboard"},{id:"weeks",icon:"📅",l:"Semaines"},{id:"collect",icon:"✏️",l:"Saisie"},{id:"import",icon:"📥",l:"Import"},{id:"diag",icon:"🔬",l:"Diagnostic"}];
  const BNav = () => (
    <div style={{ position:"sticky", bottom:0, background:C.white, borderTop:`0.5px solid ${C.grayM}`, display:"flex", padding:"6px 0 16px", zIndex:10 }}>
      {NAV.map(n => (
        <button key={n.id} onClick={()=>{ setScreen(n.id); setCM(null); setIaText(null); setPasteEdit(null); }} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
          <span style={{ fontSize:16 }}>{n.icon}</span>
          <span style={{ fontSize:9, fontWeight:screen===n.id?700:400, color:screen===n.id?C.blue:C.gray }}>{n.l}</span>
        </button>
      ))}
    </div>
  );

  // ══ ÉCRANS ════════════════════════════════════════════════════



  const Dashboard = () => (
    <div><SBar title="Dashboard"/>
      <div style={{ background:`linear-gradient(135deg,${C.blue},${C.blueL})`, padding:"10px 16px 16px" }}>
        <p style={{ margin:0, fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.5)", textTransform:"uppercase" }}>Les Cimes du Val d'Allos · Veille tarifaire</p>
        <h1 style={{ margin:"2px 0", fontSize:18, fontWeight:700, color:C.white }}>Benchmark Été {yr}</h1>
        <p style={{ margin:0, fontSize:11, color:"rgba(255,255,255,0.65)" }}>{user?.email} · {cap} · {STATIC_WEEKS.filter(w=>w.year===yr).length} semaines</p>
      </div>
      <div style={cnt}>
        <div style={{ display:"flex", gap:6, marginTop:10 }}>
          <div style={{ flex:1 }}>
            <p style={sml}>Capacité</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4 }}>
              {["2p","4p","6p","8p"].map(c=><button key={c} onClick={()=>setCap(c)} style={{ padding:"6px 0", background:cap===c?C.blue:C.white, border:"none", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:cap===c?700:400, color:cap===c?C.white:C.text }}>{c}</button>)}
            </div>
          </div>
          <div>
            <p style={sml}>Année</p>
            <div style={{ display:"flex", background:C.grayM, borderRadius:8, padding:2 }}>
              {[2026,2027].map(y=><button key={y} onClick={()=>setYr(y)} style={{ padding:"6px 9px", fontSize:11, fontWeight:yr===y?700:400, background:yr===y?C.white:"transparent", color:yr===y?C.blue:C.gray, border:"none", borderRadius:6, cursor:"pointer" }}>{y}</button>)}
            </div>
          </div>
        </div>
        <div style={{ ...cd(11), padding:"10px 13px", background:SB_READY?C.greenL:C.goldL, marginTop:8 }}>
          <p style={{ margin:"0 0 1px", fontSize:11, fontWeight:700, color:SB_READY?C.green:C.gold }}>{SB_READY?"✓ Données persistées en Supabase":"⚠ Mode local — données non persistées"}</p>
          <p style={{ margin:0, fontSize:10, color:SB_READY?C.green:C.gold }}>{SB_READY?"Session restaurée au refresh (sessionStorage).":"Configurer VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY."}</p>
        </div>
        <div style={{ ...cd(11), padding:"10px 13px", display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:0 }}>
          <div><p style={{ margin:0, fontSize:13, fontWeight:500, color:C.text }}>Données exemple</p><p style={{ margin:0, fontSize:10, color:C.textS }}>Désactiver en production</p></div>
          <button onClick={()=>setSE(p=>!p)} style={{ width:44, height:26, borderRadius:13, background:showExamples?C.blue:C.grayM, border:"none", cursor:"pointer", position:"relative" }}>
            <div style={{ position:"absolute", top:3, left:showExamples?21:3, width:20, height:20, borderRadius:"50%", background:C.white, transition:"left 0.15s" }}/>
          </button>
        </div>
        <p style={sml}>Accès rapides</p>
        <div style={cd()}>
          {[
            { icon:"✏️", l:"Saisir un relevé",        s:"collect", m:"manuelle" },
            { icon:"📋", l:"Copier-coller Booking/Airbnb", s:"collect", m:"copier-coller" },
            { icon:"📥", l:"Importer un CSV",          s:"import" },
            { icon:"🔬", l:"Diagnostic système",       s:"diag" },
          ].map((item,i,arr)=>(
            <div key={i} style={{ ...rw(i===arr.length-1), cursor:"pointer" }} onClick={()=>{ setScreen(item.s); if(item.m) setCM(item.m); }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}><span style={{ fontSize:16 }}>{item.icon}</span><span style={{ fontSize:13, fontWeight:500, color:C.text }}>{item.l}</span></div>
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={C.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          ))}
        </div>
      </div><BNav/>
    </div>
  );

  const Weeks = () => {
    const ws = STATIC_WEEKS.filter(w=>w.year===yr);
    const grouped = {};
    ws.forEach(w=>{ if(!grouped[w.month_label]) grouped[w.month_label]=[]; grouped[w.month_label].push(w); });
    return (
      <div><SBar title={`Semaines ${yr}`}/>
        <div style={{ padding:"4px 14px 0" }}>
          <div style={{ display:"flex", gap:5, marginBottom:6 }}>
            {[2026,2027].map(y=><button key={y} onClick={()=>setYr(y)} style={{ padding:"5px 10px", fontSize:11, fontWeight:yr===y?700:400, background:yr===y?C.blue:C.white, color:yr===y?C.white:C.text, border:"none", borderRadius:16, cursor:"pointer" }}>{y}</button>)}
          </div>
        </div>
        <div style={{ ...cnt, paddingTop:2 }}>
          {Object.entries(grouped).map(([ml,wks])=>(
            <div key={ml}><p style={sml}>{ml}</p>
              <div style={cd()}>
                {wks.map((w,i)=>{
                  const op = OUR_TARIFS[cap]?.[w.season_type]||0;
                  return (
                    <div key={w.id} onClick={()=>{ setSWId(w.id); setTab("detail"); setIaText(null); setScreen("week"); }} style={{ ...rw(i===wks.length-1), cursor:"pointer" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
                          <div style={{ width:5, height:5, borderRadius:"50%", background:CAT_C[w.season_type] }}/>
                          <span style={{ fontSize:12, fontWeight:500, color:C.text }}>{w.label}</span>
                          {w.event_label && <span style={{ fontSize:8, background:C.purpleL, color:C.purple, padding:"1px 4px", borderRadius:3, fontWeight:600 }}>{w.event_label.slice(0,10)}</span>}
                        </div>
                        <div style={{ marginLeft:10 }}><Badge label={CAT_L[w.season_type]} color={CAT_C[w.season_type]} bg={w.season_type==="haute"?"#FFF0E6":w.season_type==="moyenne"?C.bluePale:C.greenL} size={9}/></div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        {op>0 && <><p style={{ margin:0, fontSize:12, fontWeight:600, color:C.blue }}>{fmt(Math.round(op/7))}€/n</p><p style={{ margin:0, fontSize:9, color:C.gray }}>{fmt(op)}€/sem</p></>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div><BNav/>
      </div>
    );
  };

  const WeekDetail = () => {
    const w = selWeek;
    const pct = reco.ref ? Math.round((ourPrice-reco.ref)/reco.ref*100) : null;
    const allP = rates.map(r=>Number(r.price_week)).filter(Boolean);
    const allMin = allP.length?Math.min(...allP):0, allMax=allP.length?Math.max(...allP):0;
    const oPct = allMax>allMin&&ourPrice ? Math.min(96,Math.max(4,Math.round((ourPrice-allMin)/(allMax-allMin)*100))) : 50;
    const mPct = allMax>allMin&&reco.ref  ? Math.min(96,Math.max(4,Math.round((reco.ref-allMin)/(allMax-allMin)*100)))  : 50;
    const wColor = CAT_C[w?.season_type]||C.blue;

    // Médiane des scrapedRates pour affichage dans le bouton
    const scrapePrices = scrapedRates.map(i => i.price_week || (i.price_night * 7)).filter(p => p > 0);
    const scrapeMedian = median(scrapePrices);

    return (
      <div><SBar title={w?.label}/>
        <div style={{ background:`linear-gradient(135deg,${wColor}CC,${wColor})`, padding:"8px 14px 12px" }}>
          <button onClick={()=>setScreen("weeks")} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.8)", fontSize:12, padding:"0 0 4px", display:"flex", alignItems:"center", gap:3 }}>← Semaines</button>
          <p style={{ margin:"0 0 1px", fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.65)", textTransform:"uppercase" }}>{CAT_L[w?.season_type]} · {cap}</p>
          <p style={{ margin:"0 0 2px", fontSize:15, fontWeight:700, color:C.white }}>{w?.label} {w?.year}</p>
          {w?.event_label && <span style={{ fontSize:9, background:"rgba(255,255,255,0.2)", color:"#fff", padding:"2px 7px", borderRadius:10 }}>{w.event_label}</span>}
        </div>
        <div style={{ display:"flex", background:C.grayM, margin:"8px 14px", padding:2, borderRadius:9 }}>
          {[{id:"detail",l:"Résumé"},{id:"table",l:"Concurrents"},{id:"history",l:"Historique"},{id:"reco",l:"IA"}].map(t=>(
            <button key={t.id} style={tabB(tab===t.id)} onClick={()=>setTab(t.id)}>{t.l}</button>
          ))}
        </div>
        <div style={{ ...cnt, paddingTop:0 }}>
          {ratesLoading && <p style={{ textAlign:"center", padding:20, color:C.gray, fontSize:13 }}>Chargement…</p>}

          {tab==="detail" && !ratesLoading && (<>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
              <div style={{ ...cd(11,0), padding:"10px 11px", background:C.bluePale }}>
                <p style={{ margin:"0 0 1px", fontSize:8, color:C.blueL, fontWeight:700, textTransform:"uppercase" }}>Nos tarifs · {cap}</p>
                <p style={{ margin:0, fontSize:18, fontWeight:700, color:C.blue }}>{fmt(ourNight)}€/n</p>
                <p style={{ margin:0, fontSize:10, color:C.blueL }}>{fmt(ourPrice)}€/sem · Goélia -19%</p>
              </div>
              <div style={{ ...cd(11,0), padding:"10px 11px", background:C.grayL }}>
                <p style={{ margin:"0 0 1px", fontSize:8, color:C.gray, fontWeight:700, textTransform:"uppercase" }}>Médiane marché ({reco.ratesCount})</p>
                <p style={{ margin:0, fontSize:18, fontWeight:700, color:C.text }}>{reco.ref?fmt(Math.round(reco.ref/7))+"€/n":"—"}</p>
                <p style={{ margin:0, fontSize:10, color:C.gray }}>{reco.ref?fmt(reco.ref)+"€/sem":"Insuffisant"}</p>
              </div>
            </div>
            {pct!==null&&reco.ref&&(
              <div style={{ ...cd(10), padding:"8px 11px", background:pct<-settings.thresholdLow?C.redL:pct>settings.thresholdHigh?C.goldL:C.greenL, marginBottom:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:12, fontWeight:700, color:pct<-settings.thresholdLow?C.red:pct>settings.thresholdHigh?C.gold:C.green }}>{pct<-settings.thresholdLow?"↓ Trop bas":pct>settings.thresholdHigh?"↑ Trop haut":"✓ Bien placé"} · {fmtPct(pct)}</span>
                <span style={{ fontSize:9, fontWeight:600, background:C.white, padding:"2px 7px", borderRadius:10, color:{fort:C.green,moyen:C.orange,faible:C.red}[reco.confidence] }}>{reco.confidence} ({reco.confScore}/100)</span>
              </div>
            )}
            {allMax>allMin&&ourPrice>0&&(
              <div style={{ ...cd(11), padding:"10px 12px" }}>
                <p style={{ margin:"0 0 4px", fontSize:10, color:C.gray }}>Position sur le marché</p>
                <div style={{ position:"relative", height:6, borderRadius:6, background:`linear-gradient(to right,${C.greenL},#FEF3C7,${C.redL})` }}>
                  <div style={{ position:"absolute", top:-2, left:`calc(${mPct}% - 1px)`, width:2, height:10, background:C.gray, borderRadius:1 }}/>
                  <div style={{ position:"absolute", top:-4, left:`calc(${oPct}% - 7px)`, width:14, height:14, borderRadius:"50%", background:pct<0?C.red:pct>settings.thresholdHigh?C.gold:C.green, border:`2px solid ${C.white}` }}/>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:C.gray, marginTop:3 }}><span>{fmt(allMin)}€</span><span style={{ fontWeight:600 }}>{fmt(reco.ref||0)}€ méd.</span><span>{fmt(allMax)}€</span></div>
              </div>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:5 }}>
              {[{l:"Résidences",v:reco.medRes,c:C.blue},{l:"Particuliers",v:reco.medPart,c:"#FF5A5F"},{l:"Hôtels",v:reco.medHot,c:C.purple}].map((s,i)=>(
                <div key={i} style={{ ...cd(10,0), padding:"8px", textAlign:"center" }}>
                  <p style={{ margin:"0 0 1px", fontSize:8, color:C.gray, fontWeight:700, textTransform:"uppercase" }}>{s.l}</p>
                  <p style={{ margin:0, fontSize:13, fontWeight:700, color:s.c }}>{s.v?fmt(s.v)+"€":"—"}</p>
                  {ourPrice&&s.v?<p style={{ margin:0, fontSize:9, fontWeight:700, color:(ourPrice-s.v)>0?C.green:C.red }}>{(ourPrice-s.v)>0?"+":""}{fmt(ourPrice-s.v)}€</p>:null}
                </div>
              ))}
            </div>
            {rates.length===0&&<div style={{ ...cd(11), padding:"14px", textAlign:"center", border:`2px dashed ${C.grayM}`, marginTop:8 }}><p style={{ margin:"0 0 8px", fontSize:12, color:C.gray }}>Aucun relevé pour cette semaine.</p><button style={{ ...btn(false,C.blue), width:"auto", padding:"7px 14px", margin:0 }} onClick={()=>{ setForm({...emptyForm,weekId:selWeekId}); setScreen("collect"); setCM("manuelle"); }}>+ Saisir un relevé</button></div>}
          </>)}

          {tab==="table" && !ratesLoading && (<>
            {/* ── Relevés existants ── */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <p style={sml}>{rates.length} relevé(s) · {cap}</p>
              <button onClick={()=>{ setForm({...emptyForm,weekId:selWeekId}); setScreen("collect"); setCM("manuelle"); }} style={{ fontSize:11, color:C.blue, background:"none", border:"none", cursor:"pointer", fontWeight:600, marginTop:12 }}>+ Ajouter</button>
            </div>
            <div style={cd()}>
              <div style={{ ...rw(false), background:C.bluePale }}>
                <div><div style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ fontSize:11, fontWeight:700, color:C.blue }}>Les Cimes (nous)</span><ReliaBadge status="réel"/></div><p style={{ margin:0, fontSize:9, color:C.blueL }}>Goélia -19% · vérifié avr. 2026</p></div>
                <div style={{ textAlign:"right" }}><p style={{ margin:0, fontSize:12, fontWeight:700, color:C.blue }}>{fmt(ourNight)}€/n</p><p style={{ margin:0, fontSize:9, color:C.blueL }}>{fmt(ourPrice)}€/sem</p></div>
              </div>
              {rates.map((r,i)=>{
                const diff = ourPrice ? ourPrice - Number(r.price_week) : null;
                const age  = daysSince(r.collected_at);
                return deleteConfirm===r.id ? (
                  <div key={r.id} style={{ padding:"10px 13px", background:C.redL, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <span style={{ fontSize:12, color:C.red }}>Supprimer ce relevé ?</span>
                    <div style={{ display:"flex", gap:8 }}>
                      <button onClick={()=>handleDelete(r)} style={{ fontSize:11, color:C.white, background:C.red, border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontWeight:700 }}>Oui</button>
                      <button onClick={()=>setDC(null)} style={{ fontSize:11, color:C.text, background:C.grayL, border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>Non</button>
                    </div>
                  </div>
                ) : (
                  <div key={r.id} style={rw(i===rates.length-1)}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:2, flexWrap:"wrap" }}>
                        <span style={{ fontSize:11, fontWeight:500, color:C.text }}>{r.competitor_name||r.source}</span>
                        {r.promo_label&&<PromoBadge label={r.promo_label}/>}
                        <ReliaBadge status={r.reliability_status}/>
                        <span style={{ fontSize:9, color:C.gray }}>score {r.comparability_score||"?"}/100</span>
                      </div>
                      <div style={{ display:"flex", gap:5 }}>
                        <span style={{ fontSize:9, color:C.gray }}>{r.collection_type}</span>
                        <span style={{ fontSize:9, color:age>settings.obsoleteDays?C.orange:C.gray }}>il y a {age}j</span>
                        {r.is_example&&<Badge label="EXEMPLE" color={C.gold} bg={C.goldL} size={8}/>}
                      </div>
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0, display:"flex", alignItems:"center", gap:8 }}>
                      <div>
                        <p style={{ margin:0, fontSize:11, fontWeight:600, color:C.text }}>{fmt(Number(r.price_night))}€/n</p>
                        {r.original_price&&<p style={{ margin:0, fontSize:9, color:C.gray, textDecoration:"line-through" }}>{fmt(Math.round(Number(r.original_price)/7))}€</p>}
                        {diff!==null&&<p style={{ margin:0, fontSize:9, fontWeight:700, color:diff>0?C.green:C.red }}>{diff>0?"+":""}{fmt(diff)}€</p>}
                      </div>
                      <button onClick={()=>setDC(r.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.gray, padding:2 }}>🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ══ SCRAPING AUTOMATIQUE ══════════════════════════════ */}
            <div style={{ marginTop:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <p style={{ ...sml, margin:0 }}>Recherche automatique</p>
                {scrapeMedian && (
                  <span style={{ fontSize:10, color:C.blueL, fontWeight:600 }}>
                    Médiane web : {fmt(scrapeMedian)}€/sem
                  </span>
                )}
              </div>

              {/* Bouton principal */}
              <button
                style={{ ...btn(scraping, C.blueL), background: scraping ? "#93C5FD" : C.blueL }}
                onClick={scrapeMarket}
                disabled={scraping}
              >
                {scraping
                  ? "⏳ Recherche Booking & Airbnb (20–40s)…"
                  : `🔍 Rechercher sur Booking & Airbnb · ${selWeek?.label}`}
              </button>

              {/* Erreur */}
              {scrapeError && (
                <div style={{ ...cd(9), padding:"8px 12px", background:C.redL, marginBottom:6 }}>
                  <p style={{ margin:0, fontSize:11, color:C.red }}>{scrapeError}</p>
                </div>
              )}

              {/* Résultats scrapés */}
              {scrapedRates.length > 0 && (
                <div style={{ ...cd(), marginBottom:6 }}>
                  {/* Info */}
                  <div style={{ padding:"8px 13px", background:C.bluePale, borderBottom:`0.5px solid ${C.grayM}` }}>
                    <p style={{ margin:0, fontSize:11, fontWeight:600, color:C.blueL }}>
                      {scrapedRates.length} logements trouvés · Appuyez sur <strong style={{ color:C.blue }}>+</strong> pour enregistrer
                    </p>
                    <p style={{ margin:"2px 0 0", fontSize:9, color:C.gray, fontStyle:"italic" }}>
                      Données web search — à vérifier avant usage tarifaire
                    </p>
                  </div>

                  {/* Groupes par catégorie */}
                  {["résidence","particulier","hôtel"].map(cat => {
                    const items = scrapedRates.filter(i => i.property_type === cat);
                    if (!items.length) return null;
                    const catLabel = { résidence:"Résidences", particulier:"Particuliers", hôtel:"Hôtels" }[cat];
                    return (
                      <div key={cat}>
                        <div style={{ padding:"4px 13px", background:C.grayL, borderBottom:`0.5px solid ${C.grayM}` }}>
                          <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".06em", color:C.gray }}>
                            {catLabel} ({items.length})
                          </span>
                        </div>
                        {items.map((item, i) => {
                          const globalIdx = scrapedRates.indexOf(item);
                          const pw = item.price_week ? Math.round(item.price_week) : item.price_night ? Math.round(item.price_night * 7) : 0;
                          const pn = item.price_night ? Math.round(item.price_night) : pw ? Math.round(pw / 7) : 0;
                          const diff = ourPrice && pw ? ourPrice - pw : null;
                          const state = scrapeSaved[globalIdx];
                          return (
                            <div key={i} style={{ ...rw(i===items.length-1), padding:"8px 13px", gap:8 }}>
                              <div style={{ flex:1, minWidth:0 }}>
                                <p style={{ margin:0, fontSize:12, fontWeight:500, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                  {item.url
                                    ? <a href={item.url} target="_blank" rel="noreferrer" style={{ color:C.text, textDecoration:"none" }}>{item.name}</a>
                                    : item.name
                                  }
                                </p>
                                <p style={{ margin:0, fontSize:9, color:C.gray }}>
                                  {item.platform}{item.rating ? ` · ${item.rating}★` : ""}
                                </p>
                              </div>
                              <div style={{ textAlign:"right", flexShrink:0 }}>
                                <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.text }}>{fmt(pw)}€<span style={{ fontSize:9, fontWeight:400, color:C.gray }}>/sem</span></p>
                                {diff !== null && (
                                  <p style={{ margin:0, fontSize:9, fontWeight:700, color:diff>0?C.green:C.red }}>
                                    {diff>0?"+":""}{fmt(diff)}€
                                  </p>
                                )}
                              </div>
                              <button
                                onClick={() => saveScrapedRate(item, globalIdx)}
                                disabled={!!state}
                                style={{
                                  width:28, height:28, borderRadius:8, border:"none", flexShrink:0,
                                  background: state==="dup" ? C.goldL : state==="ok" ? C.greenL : C.bluePale,
                                  color: state==="dup" ? C.gold : state==="ok" ? C.green : C.blue,
                                  fontWeight:700, fontSize:16, cursor:state?"default":"pointer",
                                  display:"flex", alignItems:"center", justifyContent:"center",
                                }}
                              >
                                {state==="dup" ? "=" : state==="ok" ? "✓" : "+"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>)}

          {tab==="history" && (<>
            <p style={sml}>Historique par concurrent</p>
            <div style={cd()}>
              {competitors.filter(c=>c.property_type==="résidence").map((c,i,arr)=>(
                <div key={c.id} style={{ ...rw(i===arr.length-1), cursor:"pointer" }} onClick={()=>getHistoricalRates({weekId:selWeekId,competitorId:c.id,capacity:capNum}).then(setHistory).catch(()=>{})}>
                  <span style={{ fontSize:12, fontWeight:500, color:C.text }}>{c.name}</span>
                  <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={C.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              ))}
            </div>
            {history.length>0&&(<>
              <p style={sml}>Évolution des prix</p>
              <div style={cd()}>
                {history.map((r,i)=>{
                  const prev = history[i-1];
                  const trend = prev ? Number(r.price_week)-Number(prev.price_week) : 0;
                  return (
                    <div key={r.id} style={rw(i===history.length-1)}>
                      <div><p style={{ margin:0, fontSize:12, fontWeight:500, color:C.text }}>{r.collected_at}</p><div style={{ display:"flex", gap:4, marginTop:2 }}><ReliaBadge status={r.reliability_status}/>{r.promo_label&&<PromoBadge label={r.promo_label}/>}</div></div>
                      <div style={{ textAlign:"right" }}>
                        <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.text }}>{fmt(Number(r.price_week))}€/sem</p>
                        {trend!==0&&<p style={{ margin:0, fontSize:10, fontWeight:700, color:trend>0?C.red:C.green }}>{trend>0?"↑":"↓"} {fmt(Math.abs(trend))}€</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>)}
          </>)}

          {tab==="reco" && (<>
            <div style={{ ...cd(13), padding:"12px" }}>
              <p style={{ margin:"0 0 6px", fontSize:9, fontWeight:700, color:C.gray, textTransform:"uppercase" }}>Recommandation · vraie médiane statistique</p>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:5, marginBottom:8 }}>
                {[{l:"Bas",v:reco.low,c:C.green},{l:"Cible",v:reco.target,c:C.blue},{l:"Haut",v:reco.high,c:C.gold}].map((r,i)=>(
                  <div key={i} style={{ background:i===1?C.bluePale:C.grayL, borderRadius:9, padding:"8px", textAlign:"center" }}>
                    <p style={{ margin:"0 0 1px", fontSize:8, color:C.gray, fontWeight:700 }}>{r.l}</p>
                    <p style={{ margin:0, fontSize:14, fontWeight:700, color:r.c }}>{fmt(r.v)}€</p>
                    <p style={{ margin:0, fontSize:8, color:C.gray }}>sem.</p>
                  </div>
                ))}
              </div>
              <div style={{ background:C.grayL, borderRadius:8, padding:"8px 10px", marginBottom:6 }}>
                <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:C.text }}>{reco.action}</p>
                <p style={{ margin:0, fontSize:11, color:C.textS, lineHeight:1.5 }}>{reco.explanation}</p>
              </div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                <Badge label={`${reco.confidence} (${reco.confScore}/100)`} color={{fort:C.green,moyen:C.orange,faible:C.red}[reco.confidence]} bg={{fort:C.greenL,moyen:C.orangeL,faible:C.redL}[reco.confidence]}/>
                <Badge label={`${reco.ratesCount} qualifiés`} color={C.blue} bg={C.bluePale}/>
                {reco.excludedCount>0&&<Badge label={`${reco.excludedCount} exclus`} color={C.gray} bg={C.grayL}/>}
                {reco.dataAgeDays!==null&&<Badge label={`Max ${reco.dataAgeDays}j`} color={reco.dataAgeDays>settings.obsoleteDays?C.orange:C.green} bg={reco.dataAgeDays>settings.obsoleteDays?C.orangeL:C.greenL}/>}
              </div>
            </div>
            {iaError&&<div style={{ ...cd(10), padding:"9px 12px", background:C.redL, marginBottom:6 }}><p style={{ margin:0, fontSize:11, color:C.red }}>✗ {iaError}</p></div>}
            {!iaText&&<button style={btn(iaLoading,C.blue)} onClick={runIA} disabled={iaLoading}>{iaLoading?"Analyse…":"Analyse IA →"}</button>}
            {iaLoading&&<div style={{ height:3, background:C.grayM, borderRadius:3, overflow:"hidden", marginBottom:8 }}><div style={{ height:"100%", background:C.blue, borderRadius:3, animation:"prog 4s linear forwards" }}/><style>{`@keyframes prog{from{width:0}to{width:100%}}`}</style></div>}
            {iaText&&<div>{[{t:"Positionnement",i:"📊"},{t:"Risques",i:"⚠"},{t:"Recommandation",i:"💡"},{t:"Action",i:"📱"}].map((s,idx)=>iaText[idx]&&<div key={idx} style={{ ...cd(11), padding:"10px 12px" }}><p style={{ margin:"0 0 3px", fontSize:9, fontWeight:700, color:C.gray, textTransform:"uppercase" }}>{s.i} {s.t}</p><p style={{ margin:0, fontSize:12, lineHeight:1.6, color:C.text }}>{iaText[idx]}</p></div>)}<button style={btn(false,C.grayL,C.blue)} onClick={()=>setIaText(null)}>Relancer</button></div>}
          </>)}
        </div><BNav/>
      </div>
    );
  };

  const Collect = () => {
    if (collectMode==="copier-coller") return (
      <div><SBar title="Copier-coller"/>
        <div style={cnt}>
          <button onClick={()=>{ setCM(null); setPasteEdit(null); setPasteRaw(""); }} style={{ background:"none", border:"none", cursor:"pointer", color:C.blue, fontSize:13, padding:"8px 0" }}>← Retour</button>
          {!pasteEdit ? (<>
            <div style={{ ...cd(11), padding:"10px 13px", background:C.bluePale, marginBottom:8 }}>
              <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:C.blueL }}>Mode copier-coller</p>
              <p style={{ margin:0, fontSize:10, color:C.blueL, lineHeight:1.5 }}>1. Ouvre Booking/Airbnb dans ton navigateur<br/>2. Sélectionne tout le texte de la page (Ctrl+A, Ctrl+C)<br/>3. Colle ici → extraction automatique<br/>4. Valide et corrige le formulaire avant enregistrement</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={sml}>Source</p><select value={pasteSrc} onChange={e=>setPasteSrc(e.target.value)} style={inp()}>{["Booking","Airbnb","Abritel","Vacancéole","Labellemontagne","Goélia","PAP"].map(s=><option key={s}>{s}</option>)}</select></div>
              <div><p style={sml}>Semaine</p><select value={pasteWeekId} onChange={e=>setPWId(e.target.value)} style={inp()}>{STATIC_WEEKS.map(w=><option key={w.id} value={w.id}>{w.label?.slice(0,14)} {w.year}</option>)}</select></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={sml}>Capacité</p><select value={pasteCap} onChange={e=>setPCap(parseInt(e.target.value))} style={inp()}>{[2,4,6,8].map(n=><option key={n} value={n}>{n} pers.</option>)}</select></div>
              <div><p style={sml}>Concurrent</p><select value={pasteCompId} onChange={e=>setPComp(e.target.value)} style={inp()}>{competitors.map(c=><option key={c.id} value={c.id}>{c.name.slice(0,22)}</option>)}</select></div>
            </div>
            <p style={sml}>Texte collé depuis la page</p>
            <textarea value={pasteRaw} onChange={e=>setPasteRaw(e.target.value)} placeholder={"Colle ici le texte de la page Booking, Airbnb ou Abritel..."} style={{ width:"100%", minHeight:110, padding:"9px", fontSize:11, border:`1px solid ${C.grayM}`, borderRadius:10, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
            <button style={btn(!pasteRaw.trim(),C.purple)} onClick={handleParse} disabled={!pasteRaw.trim()}>🔍 Analyser le texte →</button>
          </>) : (<>
            <div style={{ ...cd(11), padding:"10px 13px", background:pasteEdit.warning?C.orangeL:C.greenL, marginBottom:8 }}>
              <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:pasteEdit.warning?C.orange:C.green }}>
                {pasteEdit.warning ? `⚠ ${pasteEdit.warning}` : `✓ Extraction réussie — vérifiez et corrigez si nécessaire`}
              </p>
              {pasteEdit.allPrices?.length>0&&<p style={{ margin:0, fontSize:10, color:C.textS }}>Prix détectés : {pasteEdit.allPrices.map(p=>`${p}€`).join(" · ")}</p>}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={sml}>Prix / semaine € *</p><input type="number" style={inp()} value={pasteEdit.priceWeek} onChange={e=>setPasteEdit({...pasteEdit,priceWeek:e.target.value,priceNight:Math.round(parseFloat(e.target.value||0)/7)})}/></div>
              <div><p style={sml}>Prix / nuit €</p><input type="number" style={inp()} value={pasteEdit.priceNight} onChange={e=>setPasteEdit({...pasteEdit,priceNight:e.target.value})}/></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={sml}>Prix barré €</p><input type="number" style={inp()} value={pasteEdit.originalPrice} onChange={e=>setPasteEdit({...pasteEdit,originalPrice:e.target.value})}/></div>
              <div><p style={sml}>Frais ménage €</p><input type="number" style={inp()} value={pasteEdit.cleaningFee} onChange={e=>setPasteEdit({...pasteEdit,cleaningFee:e.target.value})}/></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={sml}>Promotion</p><select value={pasteEdit.promoLabel} onChange={e=>setPasteEdit({...pasteEdit,promoLabel:e.target.value})} style={inp()}><option value="">Aucune</option>{["Genius -10%","Last minute","Early booking","PDJ inclus","Annulation gratuite","-5%","-8%","-10%","-15%","-19%","-20%"].map(p=><option key={p} value={p}>{p}</option>)}</select></div>
              <div><p style={sml}>Note (/10)</p><input type="number" step="0.1" min="0" max="10" style={inp()} value={pasteEdit.rating} onChange={e=>setPasteEdit({...pasteEdit,rating:e.target.value})}/></div>
            </div>
            <SaveFeedback/>
            <button style={btn(pasteSaving||!pasteEdit.priceWeek,C.blue)} onClick={handleSavePaste} disabled={pasteSaving||!pasteEdit.priceWeek}>{pasteSaving?"Enregistrement…":"Valider et enregistrer ✓"}</button>
            <button style={{ ...btn(false,C.grayL,C.textS), marginTop:-2 }} onClick={()=>setPasteEdit(null)}>← Recommencer</button>
          </>)}
        </div><BNav/>
      </div>
    );

    return (
      <div><SBar title="Saisie rapide"/>
        <div style={cnt}>
          <SaveFeedback/>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
            <div style={{ ...cd(12,0), padding:"11px 13px", cursor:"pointer", border:`1.5px solid ${collectMode==="manuelle"?C.blue:C.grayM}` }} onClick={()=>setCM("manuelle")}>
              <p style={{ margin:"0 0 2px", fontSize:18 }}>✏️</p>
              <p style={{ margin:"0 0 1px", fontSize:13, fontWeight:600, color:C.text }}>Saisie manuelle</p>
              <p style={{ margin:0, fontSize:10, color:C.textS }}>Formulaire complet</p>
            </div>
            <div style={{ ...cd(12,0), padding:"11px 13px", cursor:"pointer", border:`1.5px solid ${C.purple}` }} onClick={()=>setCM("copier-coller")}>
              <p style={{ margin:"0 0 2px", fontSize:18 }}>📋</p>
              <p style={{ margin:"0 0 1px", fontSize:13, fontWeight:600, color:C.text }}>Copier-coller</p>
              <p style={{ margin:0, fontSize:10, color:C.textS }}>Booking / Airbnb</p>
            </div>
          </div>
          <p style={sml}>Semaine</p>
          <select value={form.weekId} onChange={e=>setForm({...form,weekId:e.target.value})} style={{ ...inp(), marginBottom:6 }}>{STATIC_WEEKS.map(w=><option key={w.id} value={w.id}>{w.label} {w.year}</option>)}</select>
          <p style={sml}>Concurrent *</p>
          <select value={form.competitorId} onChange={e=>{ const c=competitors.find(x=>x.id===e.target.value); setForm({...form,competitorId:e.target.value,source:c?.source||"",type:c?.property_type||"résidence"}); }} style={{ ...inp(), marginBottom:6 }}>{competitors.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
            <div><p style={sml}>Source</p><input style={inp()} placeholder="Booking…" value={form.source} onChange={e=>setForm({...form,source:e.target.value})}/></div>
            <div><p style={sml}>Capacité</p><select value={form.capacity} onChange={e=>setForm({...form,capacity:parseInt(e.target.value)})} style={inp()}>{[2,4,6,8].map(n=><option key={n} value={n}>{n} pers.</option>)}</select></div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
            <div><p style={sml}>Prix / semaine € *</p><input type="number" style={inp()} placeholder="650" value={form.priceWeek} onChange={e=>setForm({...form,priceWeek:e.target.value,priceNight:e.target.value?Math.round(parseFloat(e.target.value)/7):""})} /></div>
            <div><p style={sml}>Prix barré €</p><input type="number" style={inp()} placeholder="Optionnel" value={form.originalPrice} onChange={e=>setForm({...form,originalPrice:e.target.value})}/></div>
          </div>
          <p style={sml}>Promotion</p>
          <select value={form.promoLabel} onChange={e=>setForm({...form,promoLabel:e.target.value})} style={{ ...inp(), marginBottom:6 }}><option value="">Aucune</option>{["Genius -10%","Remise 7 nuits -5%","Last minute","Early booking","PDJ inclus","Annulation gratuite","Promo -19%","-10%","-15%","-20%"].map(p=><option key={p} value={p}>{p}</option>)}</select>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
            <div><p style={sml}>Frais ménage €</p><input type="number" style={inp()} placeholder="0" value={form.cleaningFee} onChange={e=>setForm({...form,cleaningFee:e.target.value})}/></div>
            <div><p style={sml}>Date relevé *</p><input type="date" style={inp()} value={form.collectedAt} onChange={e=>setForm({...form,collectedAt:e.target.value})}/></div>
          </div>
          <div><p style={sml}>URL annonce</p><input style={{ ...inp(), marginBottom:6 }} placeholder="https://…" value={form.url} onChange={e=>setForm({...form,url:e.target.value})}/></div>
          <button style={btn(!form.priceWeek)} onClick={handleSaveForm} disabled={!form.priceWeek}>Enregistrer ✓</button>
          <p style={{ fontSize:9, color:C.gray, textAlign:"center" }}>Les anciens relevés ne sont jamais écrasés</p>
        </div><BNav/>
      </div>
    );
  };

  const ImportScreen = () => (
    <div><SBar title="Import CSV"/>
      <div style={cnt}>
        <div style={{ ...cd(11), padding:"10px 13px", background:C.bluePale, marginBottom:8 }}>
          <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:C.blueL }}>Colonnes CSV (séparateur ; ou ,)</p>
          <p style={{ margin:0, fontSize:9, color:C.blueL, fontFamily:"monospace", lineHeight:1.6 }}>week_start · source · property_name · property_type · capacity · price_week · price_night · original_price · promo_label · cleaning_fee · url · collected_at</p>
        </div>
        {csvResult&&(
          <div style={{ ...cd(10), padding:"10px 12px", background:csvResult.errors.length===0?C.greenL:C.goldL, marginBottom:8 }}>
            <p style={{ margin:"0 0 3px", fontSize:12, fontWeight:700, color:csvResult.errors.length===0?C.green:C.gold }}>Résultat de l'import</p>
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.green }}>✓ Importées : {csvResult.ok}</p>
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.gold }}>⊘ Doublons ignorés : {csvResult.dup}</p>
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.gray }}>⊝ Ignorées : {csvResult.skipped}</p>
            {csvResult.errors.map((e,i)=><p key={i} style={{ margin:0, fontSize:10, color:C.red }}>✗ {e}</p>)}
          </div>
        )}
        <p style={sml}>Coller le CSV</p>
        <textarea value={csvText} onChange={e=>setCsvText(e.target.value)}
          placeholder={"week_start;source;property_name;property_type;capacity;price_week\n2026-08-01;Airbnb;Appt 6p La Foux;particulier;6;680"}
          style={{ width:"100%", minHeight:100, padding:"8px", fontSize:10, fontFamily:"monospace", border:`1px solid ${C.grayM}`, borderRadius:9, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setCsvText(ev.target.result); r.readAsText(f,"UTF-8"); }} style={{ display:"none" }}/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
          <button onClick={()=>fileRef.current?.click()} style={{ ...btn(false,C.grayL,C.text), margin:0 }}>📂 Fichier .CSV</button>
          <button onClick={()=>{
            const template = [
              "week_start;source;competitor_id;property_name;property_type;capacity;price_week;price_night;original_price;promo_label;promo_percent;cleaning_fee;url;collected_at;reliability_status",
              "2026-08-01;Booking;cv;Les Chalets du Verdon;résidence;6;620;89;680;Genius -10%;10;0;https://booking.com;"+new Date().toISOString().slice(0,10)+";réel",
            ].join("\n");
            const b=new Blob([template],{type:"text/csv;charset=utf-8"});
            const u=URL.createObjectURL(b); const a=document.createElement("a");
            a.href=u; a.download="template_benchmark_v2.csv"; a.click();
          }} style={{ ...btn(false,C.grayL,C.blueL), margin:0, border:`1px solid ${C.blueL}` }}>⬇ Modèle CSV</button>
        </div>
        <button style={btn(csvLoading||!csvText.trim())} onClick={handleImportCsv} disabled={csvLoading||!csvText.trim()}>{csvLoading?"Import en cours…":"Importer →"}</button>
        {imports.length>0&&(<><p style={sml}>Imports précédents</p><div style={cd()}>{imports.slice(0,3).map((im,i)=><div key={im.id||i} style={rw(i===Math.min(imports.length,3)-1)}><div><p style={{ margin:0, fontSize:12, fontWeight:500, color:C.text }}>{im.import_source}</p><p style={{ margin:0, fontSize:10, color:C.gray }}>{im.imported_at?.slice(0,10)} · {im.rows_imported} lignes</p></div><Badge label={im.status?.toUpperCase()||"OK"} color={im.status==="ok"?C.green:C.orange} bg={im.status==="ok"?C.greenL:C.orangeL}/></div>)}</div></>)}
      </div><BNav/>
    </div>
  );

  const Diagnostic = () => {
    const qualified  = rates.filter(r => !r.is_example && (r.comparability_score??50) >= settings.minScore);
    const excluded   = rates.filter(r => !r.is_example && (r.comparability_score??50) < settings.minScore);
    const oldRates   = rates.filter(r => daysSince(r.collected_at) > settings.obsoleteDays);
    const noCompId   = rates.filter(r => !r.is_example && !r.competitor_id);
    const lastImport = imports[0];
    const localKeys  = Object.keys(localStorage).filter(k => k.startsWith("rates_"));
    const totalLocal = localKeys.reduce((s,k) => s + (ls.get(k).length), 0);

    return (
      <div><SBar title="Diagnostic"/>
        <div style={cnt}>
          <p style={{ margin:"8px 0 4px", fontSize:14, fontWeight:700, color:C.text }}>État du système</p>
          <p style={sml}>Environnement</p>
          <div style={cd()}>
            {[
              { l:"Supabase URL détectée", v:SB_READY?"Oui":"Non (mode démo)", c:SB_READY?C.green:C.red },
              { l:"Mode stockage", v:SB_READY?"Supabase":"Local (localStorage)", c:SB_READY?C.green:C.gold },
              { l:"Session", v:user?.email||"Non connecté", c:user?C.green:C.red },
              { l:"Token persistant", v:sessionStorage.getItem("sb_token")?"Oui":"Non", c:sessionStorage.getItem("sb_token")?C.green:C.gray },
            ].map((r,i,arr) => (
              <div key={r.l} style={rw(i===arr.length-1)}>
                <span style={{ fontSize:11, color:C.text }}>{r.l}</span>
                <span style={{ fontSize:10, fontWeight:600, color:r.c }}>{r.v}</span>
              </div>
            ))}
          </div>
          <p style={sml}>Relevés · {selWeekId} · {cap}</p>
          <div style={cd()}>
            {[
              { l:"Total chargés", v:rates.length, c:rates.length>0?C.green:C.red },
              { l:`Qualifiés (score≥${settings.minScore})`, v:qualified.length, c:qualified.length>=3?C.green:qualified.length>0?C.orange:C.red },
              { l:`Exclus (score<${settings.minScore})`, v:excluded.length, c:excluded.length===0?C.green:C.orange },
              { l:"Sans competitor_id", v:noCompId.length, c:noCompId.length===0?C.green:C.orange },
              { l:`Obsolètes (>${settings.obsoleteDays}j)`, v:oldRates.length, c:oldRates.length===0?C.green:C.orange },
              { l:"Stockés localement", v:totalLocal, c:totalLocal>0?C.blue:C.gray },
            ].map((r,i,arr) => (
              <div key={r.l} style={rw(i===arr.length-1)}>
                <span style={{ fontSize:11, color:C.text }}>{r.l}</span>
                <Badge label={String(r.v)} color={r.c} bg={r.c+"22"} size={11}/>
              </div>
            ))}
          </div>
          <p style={sml}>Recommandation courante</p>
          <div style={cd()}>
            {[
              { l:"Action", v:reco.action, c:reco.urgency==="normal"?C.green:reco.urgency==="haut"?C.red:C.orange },
              { l:"Confiance", v:`${reco.confidence} (${reco.confScore}/100)`, c:{fort:C.green,moyen:C.orange,faible:C.red}[reco.confidence] },
              { l:"Médiane", v:reco.ref?`${fmt(reco.ref)}€/sem`:"—", c:reco.ref?C.blue:C.gray },
              { l:"Données obsolètes", v:reco.hasOld?"Oui":"Non", c:reco.hasOld?C.orange:C.green },
            ].map((r,i,arr) => (
              <div key={r.l} style={rw(i===arr.length-1)}>
                <span style={{ fontSize:11, color:C.text }}>{r.l}</span>
                <span style={{ fontSize:11, fontWeight:600, color:r.c }}>{r.v}</span>
              </div>
            ))}
          </div>
          {lastImport&&(<><p style={sml}>Dernier import</p><div style={{ ...cd(11), padding:"10px 13px" }}><p style={{ margin:"0 0 2px", fontSize:12, fontWeight:500, color:C.text }}>{lastImport.import_source} · {lastImport.imported_at?.slice(0,10)}</p><div style={{ display:"flex", gap:8 }}><Badge label={`✓ ${lastImport.rows_imported}`} color={C.green} bg={C.greenL}/><Badge label={`⊘ ${lastImport.rows_duplicate||0}`} color={C.gold} bg={C.goldL}/></div></div></>)}
          {sbErrors.length>0&&(<><p style={sml}>Erreurs Supabase</p><div style={cd()}>{sbErrors.slice(-3).reverse().map((e,i,arr)=><div key={i} style={rw(i===arr.length-1)}><div><p style={{ margin:0, fontSize:11, color:C.red }}>{e.path}</p><p style={{ margin:0, fontSize:10, color:C.textS }}>{e.ts?.slice(11,19)} — {e.msg?.slice(0,60)}</p></div></div>)}</div></>)}
          <p style={sml}>Checklist production</p>
          <div style={cd()}>
            {[
              { l:"VITE_SUPABASE_URL configuré", ok:SB_READY },
              { l:"Mode Supabase actif", ok:SB_READY },
              { l:"Session persistante", ok:!!sessionStorage.getItem("sb_token") },
              { l:"Données exemple désactivées", ok:!showExamples },
              { l:"≥3 relevés qualifiés chargés", ok:qualified.length>=3 },
              { l:"Route /api/analyse-reco déployée", ok:false, note:"Déployer api/analyse-reco.js sur Vercel avec ANTHROPIC_API_KEY." },
            ].map((c,i,arr)=>(
              <div key={c.l} style={rw(i===arr.length-1)}>
                <div><span style={{ fontSize:11, color:C.text }}>{c.l}</span>{c.note&&<p style={{ margin:"1px 0 0", fontSize:9, color:C.gray }}>{c.note}</p>}</div>
                <Badge label={c.ok?"✓ OK":"✗ NON"} color={c.ok?C.green:C.red} bg={c.ok?C.greenL:C.redL}/>
              </div>
            ))}
          </div>
        </div><BNav/>
      </div>
    );
  };

  return (
    <div style={{ padding:"20px 0 40px", display:"flex", justifyContent:"center" }}>
      <div style={ph}>
        {!user && <LoginScreen loginErr={loginErr} SB_READY={SB_READY} loginEmail={loginEmail} setLE={setLE} loginPwd={loginPwd} setLP={setLP} loginLoading={loginLoading} handleLogin={handleLogin}/>}
        {user && screen==="dashboard" && <Dashboard/>}
        {user && screen==="weeks"     && <Weeks/>}
        {user && screen==="week"      && <WeekDetail/>}
        {user && screen==="collect"   && <Collect/>}
        {user && screen==="import"    && <ImportScreen/>}
        {user && screen==="diag"      && <Diagnostic/>}
      </div>
    </div>
  );
}

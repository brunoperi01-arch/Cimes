import { useState, useEffect, useCallback, useRef } from "react";

// ══ CONFIG ══════════════════════════════════════════════════════
const SB_URL = import.meta.env.VITE_SUPABASE_URL || "DEMO";
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "DEMO";
const SB_READY = SB_URL !== "DEMO" && SB_KEY !== "DEMO"
              && SB_URL.startsWith("https://") && SB_KEY.length > 20;
const IA_ENDPOINT = "/api/analyse-reco";

// ══ SUPABASE REST WRAPPER ════════════════════════════════════════
let _token = null;
let _refreshToken = null;
let _expiresAt = 0;

function clearStoredSession() {
  _token = null;
  _refreshToken = null;
  _expiresAt = 0;

  try {
    sessionStorage.removeItem("sb_token");
    sessionStorage.removeItem("sb_refresh");
    sessionStorage.removeItem("sb_expires_at");
    sessionStorage.removeItem("sb_user");
  } catch {}
}

function storeSession(data) {
  _token = data.access_token;
  _refreshToken = data.refresh_token || _refreshToken;
  _expiresAt = Date.now() + ((data.expires_in || 3600) * 1000);

  try {
    sessionStorage.setItem("sb_token", _token);
    sessionStorage.setItem("sb_refresh", _refreshToken || "");
    sessionStorage.setItem("sb_expires_at", String(_expiresAt));

    if (data.user) {
      sessionStorage.setItem(
        "sb_user",
        JSON.stringify({
          email: data.user?.email,
          id: data.user?.id,
        })
      );
    }
  } catch {}
}

async function refreshSessionIfNeeded() {
  if (!SB_READY || !_token) return;

  const now = Date.now();

  if (_expiresAt && now < _expiresAt - 60000) return;

  if (!_refreshToken) {
    clearStoredSession();
    throw new Error("Session expirée. Déconnecte-toi puis reconnecte-toi.");
  }

  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "apikey": SB_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refresh_token: _refreshToken,
    }),
  });

  const d = await r.json();

  if (!r.ok) {
    clearStoredSession();
    throw new Error("Session expirée. Déconnecte-toi puis reconnecte-toi.");
  }

  storeSession(d);
}

const authHeaders = async () => {
  await refreshSessionIfNeeded();

  return {
    "apikey": SB_KEY,
    "Authorization": `Bearer ${_token || SB_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };
};

const sbErrors = [];

const sb = {
  async rpc(path, body) {
    const r = await fetch(`${SB_URL}${path}`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });

    const d = await r.json();

    if (!r.ok) {
      sbErrors.push({
        ts: new Date().toISOString(),
        msg: d?.message || r.statusText,
        path,
      });
      throw new Error(d?.message || r.statusText);
    }

    return d;
  },

  async select(table, params = "") {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, {
      headers: await authHeaders(),
    });

    if (!r.ok) {
      const t = await r.text();
      sbErrors.push({
        ts: new Date().toISOString(),
        msg: t,
        path: table,
      });
      throw new Error(t);
    }

    return r.json();
  },

  async insert(table, body) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const t = await r.text();

      if (
        t.includes("unique") ||
        t.includes("duplicate") ||
        t.includes("23505")
      ) {
        throw new Error("DUPLICATE:" + t);
      }

      sbErrors.push({
        ts: new Date().toISOString(),
        msg: t,
        path: table,
      });

      throw new Error(t);
    }

    return r.json();
  },

  async update(table, filter, body) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const t = await r.text();
      throw new Error(t);
    }

    return r.json();
  },

  async delete(table, filter) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
      method: "DELETE",
      headers: await authHeaders(),
    });

    if (!r.ok) throw new Error(await r.text());

    return true;
  },

  async signIn(email, pwd) {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "apikey": SB_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password: pwd,
      }),
    });

    const d = await r.json();

    if (!r.ok) {
      throw new Error(
        d.error_description ||
        d.message ||
        "Identifiants incorrects"
      );
    }

    storeSession(d);

    return d;
  },

  signOut() {
    clearStoredSession();
  },

  restoreSession() {
    try {
      const t = sessionStorage.getItem("sb_token");
      const r = sessionStorage.getItem("sb_refresh");
      const e = sessionStorage.getItem("sb_expires_at");
      const u = sessionStorage.getItem("sb_user");

      if (t && r && u) {
        _token = t;
        _refreshToken = r;
        _expiresAt = Number(e || 0);
        return JSON.parse(u);
      }

      clearStoredSession();
    } catch {
      clearStoredSession();
    }

    return null;
  },
};

// ══ DONNÉES STATIQUES ═══════════════════════════════════════════
const DEFAULT_COMPETITORS = [
  { id:"cv",        name:"Les Chalets du Verdon", property_type:"résidence",  source:"Vacancéole",      comparability_score:88, has_pool:true,  has_ski_access:true  },
  { id:"cp",        name:"Central Park",           property_type:"résidence",  source:"Labellemontagne", comparability_score:82, has_pool:false, has_ski_access:false },
  { id:"goe",       name:"Goélia La Foux",          property_type:"résidence",  source:"Goélia",          comparability_score:85, has_pool:true,  has_ski_access:true  },
  { id:"ham",       name:"Hôtel du Hameau",          property_type:"hôtel",      source:"Booking",         comparability_score:55, has_pool:false, has_ski_access:true  },
  { id:"airbnb_lf", name:"Airbnb La Foux",           property_type:"particulier",source:"Airbnb",          comparability_score:60, has_pool:false, has_ski_access:false },
  { id:"bk_lf",    name:"Booking La Foux",           property_type:"particulier",source:"Booking",         comparability_score:58, has_pool:false, has_ski_access:false },
  { id:"abr_lf",   name:"Abritel La Foux",           property_type:"particulier",source:"Abritel",         comparability_score:56, has_pool:false, has_ski_access:false },
  { id:"pap_lf",   name:"PAP Vacances",              property_type:"particulier",source:"PAP",             comparability_score:48, has_pool:false, has_ski_access:false },
];

// Dates métier : ne JAMAIS utiliser toISOString() (décalage de fuseau possible)
function dateISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function dateObjToISO(date) {
  return dateISO(date.getFullYear(), date.getMonth(), date.getDate());
}

const STATIC_WEEKS = (() => {
  const mns=["jan","fév","mar","avr","mai","juin","juil","août","sept"];
  const evts={"2026-07-11":"Vac. zone A","2026-07-14":"Fête Nat.","2026-07-18":"Vac. B/C","2026-08-15":"Assomption","2026-09-05":"Rentrée","2027-07-10":"Vac. zone A","2027-07-14":"Fête Nat.","2027-07-17":"Vac. B/C","2027-08-15":"Assomption","2027-09-04":"Rentrée"};
  const rows=[];
  [2026,2027].forEach(year=>{
    let d=new Date(year,5,20);
    while(d.getDay()!==6) d=new Date(d.getTime()+864e5);
    let wn=1;
    while(d<new Date(year,8,13)){
      const e=new Date(d.getTime()+6*864e5); const m=d.getMonth();
      const fmt=dt=>`${dt.getDate()} ${mns[dt.getMonth()]}`;
      const key=`${year}-${String(m+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      let cat="basse";
      if(m===7) cat="haute"; else if(m===6&&d.getDate()>=11) cat="haute"; else if(m===6) cat="moyenne"; else if(m===5&&d.getDate()>=27) cat="moyenne";
      rows.push({ id:`${year}_w${wn}`, year, week_start:dateObjToISO(d), label:`${fmt(d)} → ${fmt(e)}`, month_label:["Juin","Juil.","Août","Sept."][m-5]||"", season_type:cat, event_label:evts[key]||null });
      d=new Date(d.getTime()+7*864e5); wn++;
    }
  });
  return rows;
})();

const OUR_TARIFS = {
  "2p":{ haute:245, moyenne:195, basse:145 },
  "4p":{ haute:359, moyenne:280, basse:210 },
  "6p":{ haute:428, moyenne:340, basse:259 },
  "8p":{ haute:489, moyenne:390, basse:290 },
};

// Métadonnées de notre grille interne
const OUR_TARIFS_META = { source:"Tarif interne validé", verified_at:"avril 2026", status:"réel" };

// ══ TYPOLOGIES COMMERCIALES LES CIMES ═══════════════════════════
const ACCOMMODATION_ORDER = ["2P6","2P6_SUP","3P6","3P8"];
const ACCOMMODATION_SHORT = { "2P6":"2P6", "2P6_SUP":"2P6 Sup", "3P6":"3P6", "3P8":"3P8" };
// Normalise une typologie depuis accommodation_type OU notes (ordre : SUP avant 2P6 simple). "" si indéterminé.
function normalizeAccommodationType(value, notes = "") {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const n = String(notes || "").toUpperCase();
  if (raw === "2P6_SUP" || raw === "2P6SUP" || n.includes("2P6 SUP") || n.includes("2P6_SUP") || n.includes("2P6SUP")) return "2P6_SUP";
  if (raw === "3P8" || n.includes("3P8")) return "3P8";
  if (raw === "3P6" || n.includes("3P6")) return "3P6";
  if (raw === "2P6" || n.includes("2P6")) return "2P6";
  return "";
}
// Compat : ancienne API renvoie null si indéterminé
function inferAccommodationType(rate) {
  return normalizeAccommodationType(rate?.accommodation_type, rate?.notes || rate?.accommodation_label) || null;
}
function sameDate(a, b) {
  return String(a || "").slice(0, 10) === String(b || "").slice(0, 10);
}
// Retrouve la ligne our_rates pour une cellule de grille : par dates + durée + typologie (jamais par period_id)
function findRateForGridCell(rates, period, accommodationType) {
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

const ACCOMMODATION_TYPES = {
  "2P6":     { label:"2 pièces 6 pers.",            capacity:6, surfaceMin:34, surfaceMax:45, targetMin:2, targetMax:4, comfort:"budget_famille",        segment:"6p_budget"  },
  "2P6_SUP": { label:"2 pièces 6 pers. supérieur",  capacity:6, surfaceMin:42, surfaceMax:45, targetMin:4, targetMax:6, comfort:"confort_intermediaire", segment:"6p_confort" },
  "3P6":     { label:"3 pièces 6 pers.",            capacity:6, surfaceMin:42, surfaceMax:45, targetMin:4, targetMax:6, comfort:"confort",              segment:"6p_confort" },
  "3P8":     { label:"3 pièces 8 pers.",            capacity:8, surfaceMin:57, surfaceMax:57, targetMin:6, targetMax:8, comfort:"famille_premium",      segment:"8p_famille" },
};

// Prix par personne et par nuit selon l'occupation cible
function pricePerPersonNight(priceTotal, stayNights, occupancy) {
  if (!priceTotal || !stayNights || !occupancy) return null;
  return Math.round(priceTotal / stayNights / occupancy);
}

// Score de comparabilité ajusté d'un relevé concurrent selon notre typologie
function scoreRateForAccommodation(rate, accommodationType) {
  const meta = ACCOMMODATION_TYPES[accommodationType];
  if (!meta) return { score: rate?.comparability_score || 50, segment: "Secondaire" };
  const ptype = String(rate?.property_type || "").toLowerCase();
  const isHotel = ptype.includes("hôtel") || ptype.includes("hotel");
  const cap = Number(rate?.detected_capacity || rate?.capacity || 0);
  const rooms = String(rate?.detected_rooms || "").toLowerCase();
  let score = 50, segment = "Secondaire";
  if (isHotel) return { score: 25, segment: "Secondaire" };

  if (accommodationType === "2P6") {
    if (cap===6 || cap===4 || rooms.includes("2")) { score=90; segment="Comparable"; }
    else if (rooms.includes("3")) { score=60; segment="Plus grand"; }
    else if (cap>=8) { score=35; segment="Plus grand"; }
    else { score=50; segment="Budget"; }
  } else if (accommodationType === "2P6_SUP" || accommodationType === "3P6") {
    if ((cap===6 && rooms.includes("3")) || (cap===6 && !rooms)) { score=90; segment="Comparable"; }
    else if (rooms.includes("2") || ptype.includes("studio")) { score=60; segment="Plus petit"; }
    else if (cap>=8) { score=45; segment="Plus grand"; }
    else if (cap<=4) { score=40; segment="Plus petit"; }
    else { score=55; segment="Confort"; }
  } else if (accommodationType === "3P8") {
    if (cap>=8) { score=90; segment="Comparable"; }
    else if (cap===6) { score=60; segment="Plus petit"; }
    else if (cap<=4) { score=30; segment="Plus petit"; }
    else { score=45; segment="Secondaire"; }
  }
  // Bonus confort/premium léger
  if (meta.comfort==="famille_premium" && cap>=8) segment = "Premium";
  if (meta.comfort==="budget_famille" && score>=80) segment = "Budget";
  return { score, segment };
}

// Phrase commerciale de positionnement selon la typologie
function accommodationAdvice(accommodationType) {
  switch (accommodationType) {
    case "2P6": return "Le 2P6 doit être positionné comme offre famille budget. Il peut être attractif pour 4 à 6 personnes, mais ne doit pas être comparé directement à un vrai 3P6 premium.";
    case "2P6_SUP": return "Le 2P6 supérieur se situe entre le budget et le confort. Comparez-le aux 2 pièces récents et bien équipés plutôt qu'aux studios.";
    case "3P6": return "Le 3P6 est un produit confort. Comparez-le aux vrais 3 pièces 6 personnes et aux résidences de bon standing.";
    case "3P8": return "Le 3P8 est un produit familial plus rare. La comparaison doit privilégier les grands appartements 8P et les résidences premium.";
    default: return "";
  }
}

// Statuts considérés comme fiables pour les calculs / recommandations / IA
const TRUSTED_STATUSES = ["réel", "validé", "saisi manuellement", "importé CSV"];

// ══ PLAN DE COLLECTE — PÉRIODES STATIQUES ═══════════════════════
const PLAN_PERIODS = {
  ete_7n: [
    { id:"ete_debut_juil",  label:"Début juillet",            period_start:"2026-07-04", season:"ete",   stay_nights:7 },
    { id:"ete_mi_juil",     label:"Mi-juillet",               period_start:"2026-07-11", season:"ete",   stay_nights:7 },
    { id:"ete_debut_aout",  label:"Début août",               period_start:"2026-08-01", season:"ete",   stay_nights:7 },
    { id:"ete_mi_aout",     label:"Mi-août",                  period_start:"2026-08-15", season:"ete",   stay_nights:7 },
    { id:"ete_fin_aout",    label:"Fin août",                 period_start:"2026-08-22", season:"ete",   stay_nights:7 },
  ],
  hiver_7n: [
    { id:"hiver_noel",          label:"Noël",                      period_start:"2026-12-19", season:"hiver", stay_nights:7 },
    { id:"hiver_nouvel_an",     label:"Nouvel An",                 period_start:"2026-12-26", season:"hiver", stay_nights:7 },
    { id:"hiver_janv_hors_vac", label:"Janvier hors vacances",     period_start:"2027-01-09", season:"hiver", stay_nights:7 },
    { id:"hiver_fev_vac",       label:"Fév. vacances scolaires",   period_start:"2027-02-06", season:"hiver", stay_nights:7 },
    { id:"hiver_mars",          label:"Mars",                      period_start:"2027-03-06", season:"hiver", stay_nights:7 },
    { id:"hiver_fin_saison",    label:"Fin de saison",             period_start:"2027-03-27", season:"hiver", stay_nights:7 },
  ],
  hiver_2n: [
    { id:"hiver_2n_janv",    label:"Week-end janvier",          period_start:"2027-01-16", season:"hiver", stay_nights:2 },
    { id:"hiver_2n_fev_vac", label:"Week-end vacances février", period_start:"2027-02-13", season:"hiver", stay_nights:2 },
    { id:"hiver_2n_mars",    label:"Week-end mars",             period_start:"2027-03-13", season:"hiver", stay_nights:2 },
    { id:"hiver_2n_forte",   label:"Week-end forte demande",    period_start:"2027-02-20", season:"hiver", stay_nights:2 },
  ],
};

const PLAN_MODES = [
  { id:"ete_7n",   label:"Été 7 nuits",   season:"ete",   nights:7 },
  { id:"hiver_7n", label:"Hiver 7 nuits", season:"hiver", nights:7 },
  { id:"hiver_2n", label:"Hiver 2 nuits", season:"hiver", nights:2 },
  { id:"custom",   label:"Personnalisé",  season:null,    nights:null },
];

// ══ PÉRIODES HIVER STATIQUES ════════════════════════════════════
const WINTER_PERIODS = [
  // ── 7 nuits ─────────────────────────────────────────────────
  { id:"hiver_2026_noel_7",     year:2026, season:"hiver", stay_nights:7, period_start:"2026-12-19", period_end:"2026-12-26", week_start:"2026-12-19", label:"Noël",                    subtitle:"19 déc → 26 déc", month_label:"Déc.",  season_type:"haute",   event_label:"Noël"           },
  { id:"hiver_2026_nouvelan_7", year:2027, season:"hiver", stay_nights:7, period_start:"2026-12-26", period_end:"2027-01-02", week_start:"2026-12-26", label:"Nouvel An",               subtitle:"26 déc → 2 jan",  month_label:"Janv.", season_type:"haute",   event_label:"Nouvel An"      },
  { id:"hiver_2027_janv_7",     year:2027, season:"hiver", stay_nights:7, period_start:"2027-01-09", period_end:"2027-01-16", week_start:"2027-01-09", label:"Janvier hors vacances",   subtitle:"9 jan → 16 jan",  month_label:"Janv.", season_type:"basse",   event_label:null             },
  { id:"hiver_2027_fevvac_7",   year:2027, season:"hiver", stay_nights:7, period_start:"2027-02-06", period_end:"2027-02-13", week_start:"2027-02-06", label:"Fév. vacances scolaires", subtitle:"6 fév → 13 fév",  month_label:"Fév.",  season_type:"haute",   event_label:"Vac. scolaires" },
  { id:"hiver_2027_mars_7",     year:2027, season:"hiver", stay_nights:7, period_start:"2027-03-06", period_end:"2027-03-13", week_start:"2027-03-06", label:"Mars",                    subtitle:"6 mar → 13 mar",  month_label:"Mars",  season_type:"moyenne", event_label:null             },
  { id:"hiver_2027_fin_7",      year:2027, season:"hiver", stay_nights:7, period_start:"2027-03-27", period_end:"2027-04-03", week_start:"2027-03-27", label:"Fin de saison",           subtitle:"27 mar → 3 avr",  month_label:"Mars",  season_type:"basse",   event_label:null             },
  // ── 2 nuits ─────────────────────────────────────────────────
  { id:"hiver_2027_janv_we_2",  year:2027, season:"hiver", stay_nights:2, period_start:"2027-01-16", period_end:"2027-01-18", week_start:"2027-01-16", label:"Week-end janvier",         subtitle:"16 jan → 18 jan", month_label:"Janv.", season_type:"basse",   event_label:"2 nuits"        },
  { id:"hiver_2027_fevvac_we_2",year:2027, season:"hiver", stay_nights:2, period_start:"2027-02-13", period_end:"2027-02-15", week_start:"2027-02-13", label:"Week-end vac. février",    subtitle:"13 fév → 15 fév", month_label:"Fév.",  season_type:"haute",   event_label:"Vac. scolaires" },
  { id:"hiver_2027_forte_we_2", year:2027, season:"hiver", stay_nights:2, period_start:"2027-02-20", period_end:"2027-02-22", week_start:"2027-02-20", label:"Week-end forte demande",   subtitle:"20 fév → 22 fév", month_label:"Fév.",  season_type:"haute",   event_label:"Forte demande"  },
  { id:"hiver_2027_mars_we_2",  year:2027, season:"hiver", stay_nights:2, period_start:"2027-03-13", period_end:"2027-03-15", week_start:"2027-03-13", label:"Week-end mars",            subtitle:"13 mar → 15 mar", month_label:"Mars",  season_type:"moyenne", event_label:"2 nuits"        },
];

// Périodes combinées (été normalisé + hiver) pour selWeek lookup
function _d(s,n){ const d=new Date(s+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
const ALL_PERIODS = [
  ...STATIC_WEEKS.map(w=>({ ...w, season:"ete", stay_nights:7, period_start:w.week_start, period_end:_d(w.week_start,7), subtitle:w.label })),
  ...WINTER_PERIODS,
];

// ══ HELPERS ══════════════════════════════════════════════════════
function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function fmtDateShort(dateStr) {
  if (!dateStr) return "";
  const mns = ["jan","fév","mar","avr","mai","juin","juil","août","sept","oct","nov","déc"];
  const d = new Date(dateStr + "T12:00:00Z");
  return `${d.getUTCDate()} ${mns[d.getUTCMonth()]}`;
}

// Libellé d'une période pour le sélecteur du relevé (utilise les vraies dates Booking)
function periodOptionLabel(p) {
  const start = p.period_start || p.week_start;
  const nights = Number(p.stay_nights || 7);
  const end = p.period_end || addDaysStr(start, nights);
  return `${fmtDateShort(start)} → ${fmtDateShort(end)} · ${nights} nuits`;
}

// Contexte de travail partagé (relevé / promotions / benchmark)
function getWorkContext({ mode, selectedPeriodId, customCheckin, customCheckout, stayNights, capacity, accommodationType, season }) {
  const n = Number(stayNights || 7);
  const cap = Number(capacity || 0);
  if (mode === "period" || (mode == null && selectedPeriodId)) {
    const p = ALL_PERIODS.find(x => x.id === selectedPeriodId);
    if (p) {
      const start = p.period_start || p.week_start;
      const end = p.period_end || addDaysStr(start, Number(p.stay_nights || n));
      return {
        periodId: p.id,
        label: periodOptionLabel(p),
        checkin: start,
        checkout: end,
        stayNights: Number(p.stay_nights || n),
        capacity: cap,
        accommodationType: accommodationType || null,
        season: season || p.season || "ete",
      };
    }
  }
  // Mode dates personnalisées
  const checkin = customCheckin || "";
  const checkout = customCheckout || (checkin ? addDaysStr(checkin, n) : "");
  return {
    periodId: checkin && checkout ? `custom_${checkin}_${checkout}_${cap}p` : "",
    label: checkin && checkout ? `${fmtDateShort(checkin)} → ${fmtDateShort(checkout)} · ${n} nuits` : "Dates à définir",
    checkin,
    checkout,
    stayNights: n,
    capacity: cap,
    accommodationType: accommodationType || null,
    season: season || "ete",
  };
}

// Lien Booking par localisation + dates corrigées (résidences/appart = property_type 204)
function bookingSearchUrl({ location, periodStart, periodEnd, capacity, propertyTypeCode = "204" }) {
  const ss = encodeURIComponent(location || "La Foux d'Allos");
  return `https://www.booking.com/searchresults.html?ss=${ss}&checkin=${periodStart}&checkout=${periodEnd}&group_adults=${capacity}&nflt=property_type%3D${propertyTypeCode}`;
}

// Lien Booking ciblé sur le nom d'un logement précis
function bookingItemUrl(item, result) {
  const query = encodeURIComponent(`${item.name} La Foux d'Allos`);
  const checkin = result.period_start;
  const checkout = result.period_end;
  const adults = result.capacity || 2;
  return `https://www.booking.com/searchresults.fr.html?ss=${query}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}&no_rooms=1&group_children=0`;
}

// URL sûre : garde l'URL source si elle paraît valide, sinon recherche Booking/Google
function safeListingUrl(item, result) {
  const raw = item.url || "";
  if (raw && raw.startsWith("https://") && !raw.includes("...")) return raw;
  if ((item.platform || "").toLowerCase().includes("booking")) return bookingItemUrl(item, result);
  return `https://www.google.com/search?q=${encodeURIComponent(item.name + " La Foux d'Allos")}`;
}

// Détecte notre propre établissement pour l'exclure des concurrents
function isOwnProperty(name) {
  const n = String(name || "").toLowerCase();
  return (
    n.includes("les cimes du val d'allos") ||
    n.includes("les cimes val d'allos") ||
    n.includes("résidence les cimes") ||
    n.includes("residence les cimes")
  );
}

function isDuplicate(existing, rate) {
  if (rate.competitor_id) return existing.some(r=>r.week_id===rate.week_id&&r.competitor_id===rate.competitor_id&&r.capacity===rate.capacity&&r.collected_at===rate.collected_at&&r.source===rate.source);
  return existing.some(r=>!r.competitor_id&&r.week_id===rate.week_id&&r.property_name===rate.property_name&&r.source===rate.source&&r.capacity===rate.capacity&&r.collected_at===rate.collected_at);
}

function enrichRates(rawRates, competitors) {
  return (rawRates||[]).map(r=>{
    const priceWeek=Number(r.price_week??r.price??0);
    const priceNight=Number(r.price_night??(priceWeek?Math.round(priceWeek/7):0));
    const comp=competitors.find(c=>c.id===r.competitor_id||c.source===r.source||c.name===r.competitor||c.name===r.property_name);
    return { ...r, price_week:priceWeek, price_night:priceNight, property_name:r.property_name??r.competitor??r.source, competitor_name:r.competitor_name??r.property_name??r.competitor??comp?.name??r.source, competitor:r.competitor??r.property_name??r.source, price:Number(r.price??r.price_week??0), source_url:r.source_url??r.url??"", comparability_score:r.competitors?.comparability_score??comp?.comparability_score??50, property_type:r.competitors?.property_type??comp?.property_type??r.property_type??r.type??"particulier", reliability_status:r.reliability_status??"à vérifier", collection_type:r.collection_type??"scraping" };
  });
}

const ls = {
  get: k=>{ try { return JSON.parse(localStorage.getItem(k)||"[]"); } catch { return []; } },
  set: (k,v)=>{ try { localStorage.setItem(k,JSON.stringify(v)); } catch {} },
  push: (k,item)=>{ const arr=ls.get(k); ls.set(k,[...arr.filter(x=>x.id!==item.id),item]); },
};

function stripUserId(rate) { const { user_id, ...rest } = rate; return rest; }

async function getCompetitorRates({ weekId, capacity, showExamples=false }, allCompetitors) {
  let raw=[];
  if (SB_READY) {
    const q=[`week_id=eq.${encodeURIComponent(weekId)}`,`capacity=eq.${encodeURIComponent(capacity)}`,`order=collected_at.desc`,`select=*`].join("&");
    raw=await sb.select("competitor_rates",q);
    if (!showExamples) raw=(raw||[]).filter(r=>r.is_example!==true);
  } else {
    raw=ls.get(`rates_${weekId}_${capacity}`).filter(r=>showExamples||!r.is_example);
  }
  return enrichRates(raw||[],allCompetitors);
}

function isMissingColumnError(error) {
  const msg = String(error?.message || error || "");
  return (
    msg.includes("PGRST204") ||
    msg.includes("Could not find") ||
    msg.includes("column") ||
    msg.includes("schema cache")
  );
}

async function saveCompetitorRate(rate, allCompetitors) {
  const clean = stripUserId(rate);

  const competitorName =
    clean.competitor ||
    clean.property_name ||
    clean.competitor_name ||
    clean.source ||
    "Concurrent";

  const priceValue = Number(
    clean.price_total ??
    clean.price ??
    clean.price_week ??
    clean.priceWeek ??
    0
  );

  const stayNights = Number(clean.stay_nights || 7);

  const priceNight = Number(
    clean.price_night ??
    (priceValue ? Math.round(priceValue / stayNights) : 0)
  );

  const priceWeekEquiv = Number(
    clean.price_week_equiv ??
    (priceNight ? Math.round(priceNight * 7) : 0)
  );

  const collectedAt =
    clean.collected_at ||
    clean.collectedAt ||
    new Date().toISOString().slice(0, 10);

  const sourceValue =
    clean.source ||
    clean.platform ||
    clean.collection_type ||
    "Scraping";

  const sourceUrl = clean.source_url || clean.url || "";
  const propertyType = clean.property_type || clean.type || "particulier";

  if (!priceValue) {
    throw new Error("Prix manquant : impossible d'enregistrer ce relevé.");
  }

  if (SB_READY) {
    const dupQ = [
      `week_id=eq.${encodeURIComponent(clean.week_id)}`,
      `capacity=eq.${encodeURIComponent(clean.capacity)}`,
      `competitor=eq.${encodeURIComponent(competitorName)}`,
      `source=eq.${encodeURIComponent(sourceValue)}`,
      `collected_at=eq.${encodeURIComponent(collectedAt)}`,
      `select=id`,
    ].join("&");

    const existing = await sb.select("competitor_rates", dupQ);
    if (existing?.length) throw new Error("DUPLICATE");

    const basePayload = {
      week_id: clean.week_id,
      capacity: Number(clean.capacity),
      competitor: competitorName,
      price: priceValue,
      source: sourceValue,
      source_url: sourceUrl,
      collected_at: collectedAt,
    };

    const fullPayload = {
      ...basePayload,
      property_type: propertyType,
      collection_type: clean.collection_type || "scraping-batch",
      reliability_status: clean.reliability_status || "à vérifier",
      is_example: clean.is_example ?? false,
      price_total: priceValue,
      price_night: priceNight,
      price_week_equiv: priceWeekEquiv,
      stay_nights: stayNights,
      ...(clean.period_start && { period_start: clean.period_start }),
      ...(clean.period_end && { period_end: clean.period_end }),
      ...(clean.season && { season: clean.season }),
      ...(clean.source_search_url && { source_search_url: clean.source_search_url }),
      ...(clean.validation_notes && { validation_notes: clean.validation_notes }),
      ...(clean.validated_at && { validated_at: clean.validated_at }),
      ...(clean.source_channel && { source_channel: clean.source_channel }),
      ...(clean.source_label && { source_label: clean.source_label }),
      ...(clean.original_detected_price != null && { original_detected_price: clean.original_detected_price }),
      ...(clean.market_segment && { market_segment: clean.market_segment }),
      ...(clean.is_private_rental != null && { is_private_rental: clean.is_private_rental }),
    };

    try {
      return await sb.insert("competitor_rates", fullPayload);
    } catch (e) {
      // Si une colonne V2 manque encore dans Supabase, on sauvegarde au minimum.
      if (isMissingColumnError(e)) {
        return await sb.insert("competitor_rates", basePayload);
      }
      throw e;
    }
  }

  const id = "r_" + Date.now();
  const full = {
    ...clean,
    id,
    competitor: competitorName,
    property_name: competitorName,
    property_type: propertyType,
    price: priceValue,
    price_week: priceValue,
    price_total: priceValue,
    price_night: priceNight,
    price_week_equiv: priceWeekEquiv,
    stay_nights: stayNights,
    source: sourceValue,
    source_url: sourceUrl,
    url: sourceUrl,
    collected_at: collectedAt,
  };

  const key = `rates_${clean.week_id}_${clean.capacity}`;
  const existingLocal = ls.get(key);
  if (isDuplicate(existingLocal, full)) throw new Error("DUPLICATE");
  ls.push(key, full);
  return full;
}

async function deleteCompetitorRate(id, weekId, capacity) {
  if (SB_READY) return sb.delete("competitor_rates",`id=eq.${id}`);
  const key=`rates_${weekId}_${capacity}`;
  ls.set(key,ls.get(key).filter(r=>r.id!==id));
}

async function getHistoricalRates({ weekId, competitorId, capacity }) {
  if (SB_READY) return sb.select("competitor_rates",`week_id=eq.${weekId}&competitor_id=eq.${competitorId}&capacity=eq.${capacity}&order=collected_at.asc&select=*,competitors(name)`);
  return ls.get(`rates_${weekId}_${capacity}`).filter(r=>r.competitor_id===competitorId).sort((a,b)=>a.collected_at.localeCompare(b.collected_at));
}

async function getImports() {
  if (SB_READY) return sb.select("imports","order=imported_at.desc&limit=5");
  return ls.get("imports").slice(-5).reverse();
}

async function saveImportLog(log) {
  if (SB_READY) return sb.insert("imports",log);
  ls.push("imports",{ ...log, id:"imp_"+Date.now() });
}

// ══ TARIFS LES CIMES (our_rates) ════════════════════════════════
const OUR_RATES_LS = "our_rates";

async function getOurRates() {
  if (SB_READY) {
    try { return await sb.select("our_rates", "is_active=eq.true&order=updated_at.desc&select=*"); }
    catch { return []; }
  }
  return ls.get(OUR_RATES_LS);
}

async function getOurRate(periodId, capacity, stayNights=7) {
  const all = await getOurRates();
  return (all||[]).find(r =>
    r.period_id===periodId &&
    Number(r.capacity)===Number(capacity) &&
    Number(r.stay_nights||7)===Number(stayNights) &&
    r.is_active!==false
  ) || null;
}

// Récupère le tarif Les Cimes correspondant au contexte : priorité aux dates réelles, puis period_id
function getOurRateForContext(ourRates, ctx, accommodationType) {
  if (!ourRates?.length || !ctx) return null;
  const capacity = Number(ctx.capacity);
  const stayNights = Number(ctx.stayNights || ctx.stay_nights || 7);
  const start = ctx.checkin || ctx.period_start || ctx.week_start;
  const end = ctx.checkout || ctx.period_end;
  const active = ourRates.filter(r => r.is_active !== false);
  const accType = String(accommodationType || "");
  // 1. Priorité absolue : dates + durée + capacité + typologie
  if (accType) {
    const byDatesAndType = active.find(r =>
      String(r.period_start || "") === String(start || "") &&
      String(r.period_end || "") === String(end || "") &&
      Number(r.capacity) === capacity &&
      Number(r.stay_nights || 7) === stayNights &&
      String(r.accommodation_type || "") === accType
    );
    if (byDatesAndType) return { ...byDatesAndType, match_type: "dates+typologie" };
  }
  // 2. Fallback : dates + capacité + durée (sans typologie)
  const byDates = active.find(r =>
    String(r.period_start || "") === String(start || "") &&
    String(r.period_end || "") === String(end || "") &&
    Number(r.capacity) === capacity &&
    Number(r.stay_nights || 7) === stayNights
  );
  if (byDates) return { ...byDates, match_type: "dates" };
  // 3. Fallback : period_id + capacité + durée (+ typologie si fournie)
  if (accType) {
    const byPeriodIdAndType = active.find(r =>
      String(r.period_id || "") === String(ctx.periodId || ctx.period_id || "") &&
      Number(r.capacity) === capacity &&
      Number(r.stay_nights || 7) === stayNights &&
      String(r.accommodation_type || "") === accType
    );
    if (byPeriodIdAndType) return { ...byPeriodIdAndType, match_type: "period_id+typologie" };
  }
  const byPeriodId = active.find(r =>
    String(r.period_id || "") === String(ctx.periodId || ctx.period_id || "") &&
    Number(r.capacity) === capacity &&
    Number(r.stay_nights || 7) === stayNights
  );
  if (byPeriodId) return { ...byPeriodId, match_type: "period_id" };
  return null;
}

async function saveOurRate(rate) {
  const stayNights = Number(rate.stay_nights || 7);
  const priceTotal = Number(rate.price_total || 0);
  if (!priceTotal) throw new Error("Prix total manquant.");
  if (!rate.period_id || !rate.capacity) throw new Error("Période et capacité requises.");
  const priceNight = rate.price_night ? Number(rate.price_night) : Math.round(priceTotal / stayNights);
  const basePayload = {
    period_id:    rate.period_id,
    period_label: rate.period_label || null,
    period_start: rate.period_start || null,
    period_end:   rate.period_end || null,
    season:       rate.season || "ete",
    stay_nights:  stayNights,
    capacity:     Number(rate.capacity),
    price_total:  priceTotal,
    price_night:  priceNight,
    source:       rate.source || "saisie",
    notes:        rate.notes || null,
    is_active:    true,
  };
  // Champs typologie (optionnels, dérivés de accommodation_type si fourni)
  const meta = rate.accommodation_type ? ACCOMMODATION_TYPES[rate.accommodation_type] : null;
  const payload = {
    ...basePayload,
    ...(rate.accommodation_type && {
      accommodation_type:    rate.accommodation_type,
      accommodation_label:   rate.accommodation_label || meta?.label || rate.accommodation_type,
      surface_min:           rate.surface_min ?? meta?.surfaceMin ?? null,
      surface_max:           rate.surface_max ?? meta?.surfaceMax ?? null,
      target_occupancy_min:  rate.target_occupancy_min ?? meta?.targetMin ?? null,
      target_occupancy_max:  rate.target_occupancy_max ?? meta?.targetMax ?? null,
      comfort_level:         rate.comfort_level || meta?.comfort || "standard",
    }),
  };

  if (SB_READY) {
    const filter = [
      `period_id=eq.${encodeURIComponent(payload.period_id)}`,
      `capacity=eq.${encodeURIComponent(payload.capacity)}`,
      `stay_nights=eq.${encodeURIComponent(payload.stay_nights)}`,
      `select=id`,
    ].join("&");
    try {
      const existing = await sb.select("our_rates", filter);
      if (existing?.length) return await sb.update("our_rates", `id=eq.${existing[0].id}`, payload);
      return await sb.insert("our_rates", payload);
    } catch (e) {
      // Si les colonnes typologie manquent encore en base, on enregistre sans
      if (isMissingColumnError(e)) {
        const existing = await sb.select("our_rates", filter);
        if (existing?.length) return await sb.update("our_rates", `id=eq.${existing[0].id}`, basePayload);
        return await sb.insert("our_rates", basePayload);
      }
      throw e;
    }
  }

  // localStorage : upsert par period_id + capacity + stay_nights
  const all = ls.get(OUR_RATES_LS);
  const idx = all.findIndex(r => r.period_id===payload.period_id && Number(r.capacity)===payload.capacity && Number(r.stay_nights||7)===payload.stay_nights);
  if (idx>=0) { all[idx] = { ...all[idx], ...payload, updated_at:new Date().toISOString() }; }
  else { all.push({ ...payload, id:"or_"+Date.now(), created_at:new Date().toISOString(), updated_at:new Date().toISOString() }); }
  ls.set(OUR_RATES_LS, all);
  return all;
}

async function deleteOurRate(id) {
  if (SB_READY) return sb.delete("our_rates", `id=eq.${id}`);
  ls.set(OUR_RATES_LS, ls.get(OUR_RATES_LS).filter(r=>r.id!==id));
  return true;
}

async function importOurRatesCsv(csvText, allPeriods) {
  const lines = csvText.trim().split("\n").filter(l=>l.trim());
  if (lines.length<2) return { ok:0, updated:0, skipped:0, errors:["Fichier vide"] };
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h=>h.trim().toLowerCase().replace(/[^a-z_]/g,""));
  let ok=0, updated=0, skipped=0; const errors=[];

  for (const line of lines.slice(1)) {
    const vals = line.split(sep).map(v=>v.trim().replace(/^"|"$/g,""));
    const o={}; headers.forEach((h,i)=>o[h]=vals[i]||"");
    // Retrouver la période : par period_id, sinon par period_start
    let period = allPeriods.find(p=>p.id===o.period_id);
    if (!period && o.period_start) period = allPeriods.find(p=>(p.period_start||p.week_start)===o.period_start);
    const periodId = o.period_id || period?.id;
    const capacity = parseInt(o.capacity)||0;
    const priceTotal = parseFloat(o.price_total)||0;
    if (!periodId || !capacity || !priceTotal) { skipped++; continue; }
    const stayNights = parseInt(o.stay_nights)||period?.stay_nights||7;
    const periodStart = o.period_start || period?.period_start || period?.week_start || null;
    const periodEnd = o.period_end || period?.period_end || (periodStart?addDaysStr(periodStart,stayNights):null);
    try {
      // détecter update vs insert pour le compteur
      const existing = await getOurRate(periodId, capacity, stayNights);
      await saveOurRate({
        period_id:    periodId,
        period_label: o.period_label || period?.label || null,
        period_start: periodStart,
        period_end:   periodEnd,
        season:       o.season || period?.season || "ete",
        stay_nights:  stayNights,
        capacity,
        accommodation_type: (o.accommodation_type||o.accommodationtype) ? String(o.accommodation_type||o.accommodationtype).toUpperCase().replace(/\s/g,"") : null,
        price_total:  priceTotal,
        notes:        o.notes || null,
        source:       "import CSV",
      });
      if (existing) updated++; else ok++;
    } catch(e) { errors.push(e.message); }
  }
  return { ok, updated, skipped, errors:errors.slice(0,4) };
}

// ══ CATALOGUE CONCURRENTS SUIVIS (competitor_catalog) ═══════════
const CATALOG_LS = "competitor_catalog";

async function getCompetitorCatalog() {
  let rows = [];
  if (SB_READY) {
    try { rows = await sb.select("competitor_catalog", "is_active=eq.true&order=property_type.asc,name.asc&select=*"); }
    catch { rows = []; }
  } else {
    rows = ls.get(CATALOG_LS).filter(r=>r.is_active!==false);
  }
  return (rows||[]).filter(r=>!isOwnProperty(r.name));
}

async function saveCompetitorCatalogItem(item) {
  if (!item.name) throw new Error("Nom du concurrent requis.");
  if (isOwnProperty(item.name)) throw new Error("Les Cimes ne peut pas être enregistré comme concurrent.");
  const isPrivate = item.is_private_rental === true || item.market_segment === "private" || item.property_type === "particulier" || item.property_type === "studio";
  const PRIVATE_SUBTYPES = ["particulier","studio"];
  const basePayload = {
    name:                String(item.name).trim(),
    property_type:       isPrivate ? (PRIVATE_SUBTYPES.includes(item.property_type) ? item.property_type : "particulier") : (item.property_type || "résidence"),
    platform:            item.platform || "Booking.com",
    booking_url:         item.booking_url ? normalizeBookingBaseUrl(item.booking_url) : null,
    search_location:     item.search_location || "La Foux d'Allos",
    comparability_score: Number(item.comparability_score || (isPrivate ? 60 : 80)),
    notes:               item.notes || null,
    is_active:           item.is_active !== false,
  };
  const payload = {
    ...basePayload,
    direct_url:          item.direct_url || null,
    preferred_channel:   item.preferred_channel || "booking",
    market_segment:      isPrivate ? "private" : "residence",
    is_private_rental:   isPrivate,
    ...(item.detected_capacity != null && item.detected_capacity !== "" && { detected_capacity: Number(item.detected_capacity) }),
    ...(item.detected_rooms && { detected_rooms: item.detected_rooms }),
    ...(item.detected_surface != null && item.detected_surface !== "" && { detected_surface: Number(item.detected_surface) }),
  };
  if (SB_READY) {
    try {
      if (item.id) return await sb.update("competitor_catalog", `id=eq.${item.id}`, { ...payload, updated_at:new Date().toISOString() });
      return await sb.insert("competitor_catalog", payload);
    } catch (e) {
      // Si direct_url / preferred_channel manquent encore en base, on enregistre sans.
      if (isMissingColumnError(e)) {
        if (item.id) return await sb.update("competitor_catalog", `id=eq.${item.id}`, { ...basePayload, updated_at:new Date().toISOString() });
        return await sb.insert("competitor_catalog", basePayload);
      }
      throw e;
    }
  }
  const all = ls.get(CATALOG_LS);
  if (item.id) {
    const idx = all.findIndex(r=>r.id===item.id);
    if (idx>=0) { all[idx] = { ...all[idx], ...payload, updated_at:new Date().toISOString() }; ls.set(CATALOG_LS, all); return all[idx]; }
  }
  const created = { ...payload, id:"cc_"+Date.now(), created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
  all.push(created); ls.set(CATALOG_LS, all); return created;
}

async function deleteCompetitorCatalogItem(id) {
  if (SB_READY) return sb.delete("competitor_catalog", `id=eq.${id}`);
  ls.set(CATALOG_LS, ls.get(CATALOG_LS).filter(r=>r.id!==id));
  return true;
}

async function importCatalogCsv(csvText) {
  const lines = csvText.trim().split("\n").filter(l=>l.trim());
  if (lines.length<2) return { ok:0, skipped:0, errors:["Fichier vide"] };
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h=>h.trim().toLowerCase().replace(/[^a-z_]/g,""));
  let ok=0, skipped=0; const errors=[];
  for (const line of lines.slice(1)) {
    const vals = line.split(sep).map(v=>v.trim().replace(/^"|"$/g,""));
    const o={}; headers.forEach((h,i)=>o[h]=vals[i]||"");
    if (!o.name || isOwnProperty(o.name)) { skipped++; continue; }
    const seg = (o.market_segment||"").toLowerCase()==="private" ? "private" : (o.market_segment||"").toLowerCase()==="residence" ? "residence" : null;
    const isPrivate = seg==="private" || (o.property_type||"").toLowerCase()==="particulier";
    try {
      const saved = await saveCompetitorCatalogItem({
        name:o.name,
        property_type:o.property_type||(isPrivate?"particulier":"résidence"),
        market_segment: seg || (isPrivate?"private":"residence"),
        is_private_rental: isPrivate,
        preferred_channel:o.preferred_channel||"booking",
        platform:o.platform||"Booking.com",
        booking_url:(o.source_type==="booking"&&o.source_url)?o.source_url:(o.booking_url||null),
        direct_url:o.direct_url||null,
        search_location:o.search_location||"La Foux d'Allos",
        comparability_score:parseFloat(o.comparability_score)||(isPrivate?60:80), notes:o.notes||null,
      });
      // Nouveau format : créer la source associée si source_type/source_url fournis
      if (o.source_type && o.source_url) {
        const compId = saved?.id || saved?.[0]?.id;
        if (compId) {
          try { await saveCompetitorSource({ competitor_id:compId, source_type:o.source_type, source_name:o.source_name||o.source_type, source_url:o.source_url, notes:o.notes||null, is_active:true }); } catch {}
        }
      }
      ok++;
    } catch(e) { errors.push(e.message); }
  }
  return { ok, skipped, errors:errors.slice(0,4) };
}

// Lien Booking fiable pour un concurrent suivi (URL exacte si fournie)
function daysBetween(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start + "T12:00:00");
  const b = new Date(end + "T12:00:00");
  return Math.max(0, Math.round((b - a) / 86400000));
}

// Nettoie une URL Booking : on garde domaine + chemin, jamais les anciens paramètres (dates, etc.)
function normalizeBookingBaseUrl(rawUrl) {
  if (!rawUrl) return "https://www.booking.com/searchresults.html";
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("booking.com")) {
      return rawUrl;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return "https://www.booking.com/searchresults.html";
  }
}

function buildTrackedBookingUrl(competitor, ctx) {
  const checkin = ctx.checkin;
  const checkout = ctx.checkout;
  const capacity = Number(ctx.capacity || 2);
  const cleanBase = normalizeBookingBaseUrl(competitor.booking_url);
  const url = new URL(cleanBase);
  url.searchParams.set("checkin", checkin);
  url.searchParams.set("checkout", checkout);
  url.searchParams.set("group_adults", String(capacity));
  url.searchParams.set("req_adults", String(capacity));
  url.searchParams.set("group_children", "0");
  url.searchParams.set("req_children", "0");
  url.searchParams.set("no_rooms", "1");
  url.searchParams.set("room1", Array.from({ length: capacity }, () => "A").join(","));
  url.searchParams.set("sb_price_type", "total");
  if (url.pathname.includes("searchresults")) {
    url.searchParams.set("ss", competitor.search_location || competitor.name || "La Foux d'Allos");
  }
  return url.toString();
}

// Lien site direct : URL telle quelle (on n'injecte pas de dates)
function buildTrackedDirectUrl(competitor) {
  return competitor.direct_url || "";
}

// ══ SOURCES MULTIPLES PAR CONCURRENT (competitor_sources) ═══════
const SOURCES_LS = "competitor_sources";
// Familles de sources
const SOURCE_FAMILIES = [
  { type:"booking",       name:"Booking.com" },
  { type:"direct",        name:"Site direct" },
  { type:"tour_operator", name:"Tour opérateur" },
  { type:"marketplace",   name:"Marketplace / OTA" },
  { type:"other",         name:"Autre page internet" },
];
const TOUR_OPERATORS = ["Maeva","La France du Nord au Sud","Travelski","Locasun","Vacancéole","Montagne Vacances","Autre tour opérateur"];
const MARKETPLACES   = ["Airbnb","Abritel","Expedia","Booking.com","Booking particulier","PAP vacances","Leboncoin","Autre marketplace"];
// Segment d'un concurrent : "private" (particulier) ou "residence" (pro)
function competitorSegment(c) {
  if (!c) return "residence";
  if (c.is_private_rental === true || c.market_segment === "private" || c.property_type === "particulier" || c.property_type === "studio") return "private";
  return "residence";
}
function isPrivateCompetitor(c) { return competitorSegment(c) === "private"; }
// Conservé pour compat (anciens types maeva/airbnb/…) — utilisé par les boutons rapides
const SOURCE_TYPES = [
  { type:"booking", name:"Booking.com" },
  { type:"direct",  name:"Site direct" },
  { type:"maeva",   name:"Maeva" },
  { type:"airbnb",  name:"Airbnb" },
  { type:"abritel", name:"Abritel" },
  { type:"expedia", name:"Expedia" },
  { type:"other",   name:"Autre" },
];
// Badge (label + couleur) selon le type de source, gère aussi les anciens types
function sourceBadgeMeta(type) {
  switch (type) {
    case "booking":       return { l:"Booking", c:"#0A6CFF", bg:"#E8F1FF" };
    case "direct":        return { l:"Direct",  c:"#1DB954", bg:"#E6F9EE" };
    case "tour_operator": return { l:"TO",      c:"#7C3AED", bg:"#F1E9FF" };
    case "marketplace":   return { l:"OTA",     c:"#F5A623", bg:"#FFF4E0" };
    case "maeva":         return { l:"TO",      c:"#7C3AED", bg:"#F1E9FF" };
    case "airbnb": case "abritel": case "expedia": return { l:"OTA", c:"#F5A623", bg:"#FFF4E0" };
    default:              return { l:"Autre",   c:"#8E8E93", bg:"#F2F2F7" };
  }
}

async function getCompetitorSources() {
  if (SB_READY) {
    try { return await sb.select("competitor_sources", "is_active=eq.true&order=source_type.asc&select=*"); }
    catch { return []; }
  }
  return ls.get(SOURCES_LS).filter(r=>r.is_active!==false);
}

async function saveCompetitorSource(source) {
  if (!source.competitor_id) throw new Error("Concurrent requis.");
  if (!source.source_url) throw new Error("URL de la source requise.");
  // Nettoyage spécifique La France du Nord au Sud : on stocke une URL vierge (sans dates)
  const isLfdnas = String(source.source_name||"").toLowerCase().includes("france du nord") || String(source.source_url||"").toLowerCase().includes("lafrancedunordausud.fr");
  const cleanedUrl = isLfdnas ? normalizeLfdnasBaseUrl(source.source_url) : source.source_url;
  const payload = {
    competitor_id: source.competitor_id,
    source_name:   source.source_name || "Autre",
    source_type:   source.source_type || "other",
    source_url:    cleanedUrl,
    notes:         source.notes || null,
    is_active:     source.is_active !== false,
  };
  if (SB_READY) {
    if (source.id) return await sb.update("competitor_sources", `id=eq.${source.id}`, { ...payload, updated_at:new Date().toISOString() });
    // Anti-doublon : même concurrent + type + URL → mise à jour
    try {
      const existing = await sb.select("competitor_sources", `competitor_id=eq.${source.competitor_id}&source_type=eq.${encodeURIComponent(source.source_type||"other")}&source_url=eq.${encodeURIComponent(cleanedUrl)}&select=id`);
      if (existing && existing.length) return await sb.update("competitor_sources", `id=eq.${existing[0].id}`, { ...payload, updated_at:new Date().toISOString() });
    } catch { /* si la requête échoue on insère */ }
    return await sb.insert("competitor_sources", payload);
  }
  const all = ls.get(SOURCES_LS);
  if (source.id) {
    const idx = all.findIndex(r=>r.id===source.id);
    if (idx>=0) { all[idx] = { ...all[idx], ...payload, updated_at:new Date().toISOString() }; ls.set(SOURCES_LS, all); return all[idx]; }
  }
  const dupIdx = all.findIndex(r=>r.competitor_id===source.competitor_id && r.source_type===payload.source_type && r.source_url===payload.source_url);
  if (dupIdx>=0) { all[dupIdx] = { ...all[dupIdx], ...payload, updated_at:new Date().toISOString() }; ls.set(SOURCES_LS, all); return all[dupIdx]; }
  const created = { ...payload, id:"cs_"+Date.now(), created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
  all.push(created); ls.set(SOURCES_LS, all); return created;
}

async function deleteCompetitorSource(id) {
  if (SB_READY) return sb.delete("competitor_sources", `id=eq.${id}`);
  ls.set(SOURCES_LS, ls.get(SOURCES_LS).filter(r=>r.id!==id));
  return true;
}

// Normalise une URL saisie : www.→https://www., ww.→https://www., sans http→https://
function normalizeSourceUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (/^www\./i.test(u)) return "https://" + u;
  if (/^ww\./i.test(u)) return "https://www." + u.replace(/^ww\./i, "");
  return "https://" + u;
}

// Import CSV : competitor_name;source_type;source_name;source_url;notes
async function importSourcesCsv(csvText, catalog) {
  const lines = String(csvText||"").trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { added:0, skipped:0, errors:["CSV vide"] };
  const start = /competitor_name/i.test(lines[0]) ? 1 : 0;
  let added=0, skipped=0; const errors=[];
  const findComp = (name) => {
    const n = String(name||"").trim();
    if (!n) return null;
    // 1. nom exact
    let c = (catalog||[]).find(x=>String(x.name).trim()===n);
    if (c) return c;
    // 2. insensible à la casse
    c = (catalog||[]).find(x=>String(x.name).trim().toLowerCase()===n.toLowerCase());
    if (c) return c;
    // 3. partiel (includes)
    c = (catalog||[]).find(x=>String(x.name).toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(String(x.name).toLowerCase()));
    return c || null;
  };
  for (let i=start; i<lines.length; i++) {
    const cols = lines[i].split(";").map(s=>s.trim());
    const [cname, stype, sname, surl, notes] = cols;
    if (!cname) { errors.push(`Ligne ${i+1} : nom de concurrent manquant`); skipped++; continue; }
    if (!surl)  { errors.push(`Ligne ${i+1} (${cname}) : URL manquante`); skipped++; continue; }
    const comp = findComp(cname);
    if (!comp) { errors.push(`Concurrent introuvable : ${cname}`); skipped++; continue; }
    try {
      await saveCompetitorSource({ competitor_id:comp.id, source_type:stype||"other", source_name:sname||stype||"Autre", source_url:normalizeSourceUrl(surl), notes:notes||null, is_active:true });
      added++;
    } catch(e) { errors.push(`${cname}/${sname||stype} : ${e.message}`); skipped++; }
  }
  return { added, skipped, errors };
}

// Lien Booking à partir d'une URL source (nettoyée) + dates
function buildTrackedBookingUrlFromSource(rawUrl, competitor, ctx) {
  return buildTrackedBookingUrl({ ...competitor, booking_url: rawUrl }, ctx);
}

// Nettoie une URL "La France du Nord au Sud" : garde domaine+chemin+residence_cle+ordreSeo, retire les dates
function normalizeLfdnasBaseUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    let fixed = String(rawUrl).trim();
    if (fixed.startsWith("ww.")) fixed = "https://www." + fixed.slice(3);
    else if (fixed.startsWith("www.")) fixed = "https://" + fixed;
    else if (!fixed.startsWith("http://") && !fixed.startsWith("https://")) fixed = "https://" + fixed;
    const url = new URL(fixed);
    if (!url.hostname.includes("lafrancedunordausud.fr")) return fixed;
    const clean = new URL(url.origin + url.pathname);
    const residenceCle = url.searchParams.get("residence_cle") || (url.pathname.match(/_(\d+)\.html/)?.[1] || "");
    if (residenceCle) clean.searchParams.set("residence_cle", residenceCle);
    clean.searchParams.set("ordreSeo", url.searchParams.get("ordreSeo") || "prixAsc");
    return clean.toString();
  } catch {
    return rawUrl;
  }
}

// Reconstruit l'URL LFDNAS avec les dates + capacité du contexte de relevé
function buildLfdnasUrl(source, ctx) {
  const base = normalizeLfdnasBaseUrl(source.source_url);
  const url = new URL(base);
  url.searchParams.set("date_debut", ctx.checkin);
  url.searchParams.set("date_fin", ctx.checkout);
  url.searchParams.set("nbPax", String(ctx.capacity));
  url.searchParams.set("adultePax", String(ctx.capacity));
  url.searchParams.set("enfantPax", "0");
  url.searchParams.set("babiePax", "0");
  if (!url.searchParams.get("ordreSeo")) url.searchParams.set("ordreSeo", "prixAsc");
  return url.toString();
}

// Détecte un prix peu plausible (miroir de la logique API)
function isSuspiciousDetectedPrice(price, ctx, source) {
  const p = Number(price || 0);
  if (!p) return true;
  if (source.source_type === "direct" && (p === 300 || p === 250 || p === 350)) return true;
  if (Number(ctx.stayNights) >= 7 && p < 400) return true;
  if (Number(ctx.capacity) >= 6 && Number(ctx.stayNights) >= 7 && p < 500) return true;
  return false;
}

function isLfdnasSource(source) {
  const name = String(source.source_name || "").toLowerCase();
  const raw = String(source.source_url || "").toLowerCase();
  return name.includes("france du nord") || raw.includes("lafrancedunordausud.fr");
}

// URL d'une source : Booking et LFDNAS reçoivent les dates, les autres sont ouvertes telles quelles
function buildSourceUrl(source, competitor, ctx) {
  if (source.source_type === "booking") {
    return buildTrackedBookingUrlFromSource(source.source_url, competitor, ctx);
  }
  if (isLfdnasSource(source)) {
    return buildLfdnasUrl(source, ctx);
  }
  return source.source_url;
}

// Charge l'historique complet des relevés (1000 derniers)
async function getAllCompetitorRatesHistory() {
  if (SB_READY) {
    try { return await sb.select("competitor_rates", "order=collected_at.desc&limit=1000&select=*"); }
    catch { return []; }
  }
  const keys = Object.keys(localStorage).filter(k=>k.startsWith("rates_"));
  const all = keys.flatMap(k=>ls.get(k));
  return all.sort((a,b)=>String(b.collected_at).localeCompare(String(a.collected_at))).slice(0,1000);
}

// Corrige un relevé existant (erreur de saisie) + trace l'audit dans competitor_rate_edits
async function correctCompetitorRate(rate, newPriceTotal, reason) {
  const newTotal = Number(newPriceTotal) || 0;
  if (!newTotal) throw new Error("Prix corrigé invalide.");
  const stayNights = Number(rate.stay_nights || 7) || 7;
  const newNight = Math.round(newTotal / stayNights);
  const oldTotal = Number(rate.price_total || rate.price_week || rate.price || 0);
  const oldNight = Number(rate.price_night || (oldTotal ? Math.round(oldTotal / stayNights) : 0));
  const editRow = {
    competitor_rate_id: rate.id,
    old_price_total: oldTotal, new_price_total: newTotal,
    old_price_night: oldNight, new_price_night: newNight,
    edit_reason: reason || null,
  };
  const ratePatch = {
    price_total: newTotal, price: newTotal, price_week: newTotal,
    price_night: newNight, price_week_equiv: Math.round(newNight * 7),
    edited_at: new Date().toISOString(), edit_reason: reason || null,
  };
  if (SB_READY) {
    try { await sb.insert("competitor_rate_edits", editRow); } catch { /* table peut manquer */ }
    try { return await sb.update("competitor_rates", `id=eq.${rate.id}`, ratePatch); }
    catch (e) {
      if (isMissingColumnError(e)) {
        const { edited_at, edit_reason, price_week_equiv, ...safe } = ratePatch;
        return await sb.update("competitor_rates", `id=eq.${rate.id}`, safe);
      }
      throw e;
    }
  }
  // localStorage : retrouver la ligne dans son bucket rates_*
  const keys = Object.keys(localStorage).filter(k=>k.startsWith("rates_"));
  for (const k of keys) {
    const arr = ls.get(k); const i = arr.findIndex(r=>r.id===rate.id);
    if (i>=0) { arr[i] = { ...arr[i], ...ratePatch }; ls.set(k, arr); break; }
  }
  const edits = ls.get("competitor_rate_edits");
  edits.push({ ...editRow, id:"cre_"+Date.now(), edited_at:new Date().toISOString() });
  ls.set("competitor_rate_edits", edits);
  return true;
}

async function getRateEditsFor(rateId) {
  if (SB_READY) {
    try { return await sb.select("competitor_rate_edits", `competitor_rate_id=eq.${rateId}&order=edited_at.desc&select=*`); }
    catch { return []; }
  }
  return ls.get("competitor_rate_edits").filter(e=>e.competitor_rate_id===rateId);
}

// ══ DÉCISIONS COMMERCIALES (commercial_decisions) ═══════════════
const DECISIONS_LS = "commercial_decisions";

async function getCommercialDecisions() {
  if (SB_READY) {
    try { return await sb.select("commercial_decisions", "order=created_at.desc&limit=300&select=*"); }
    catch { return []; }
  }
  return ls.get(DECISIONS_LS).slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,300);
}

async function saveCommercialDecision(decision) {
  const payload = { ...decision };
  delete payload.id;
  if (SB_READY) return await sb.insert("commercial_decisions", payload);
  const all = ls.get(DECISIONS_LS);
  const created = { ...payload, id:"cd_"+Date.now(), created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
  all.push(created); ls.set(DECISIONS_LS, all); return created;
}

async function updateCommercialDecision(id, patch) {
  if (SB_READY) return await sb.update("commercial_decisions", `id=eq.${id}`, { ...patch, updated_at:new Date().toISOString() });
  const all = ls.get(DECISIONS_LS);
  const idx = all.findIndex(r=>r.id===id);
  if (idx>=0) { all[idx] = { ...all[idx], ...patch, updated_at:new Date().toISOString() }; ls.set(DECISIONS_LS, all); return all[idx]; }
  return null;
}

async function deleteCommercialDecision(id) {
  if (SB_READY) return sb.delete("commercial_decisions", `id=eq.${id}`);
  ls.set(DECISIONS_LS, ls.get(DECISIONS_LS).filter(r=>r.id!==id));
  return true;
}

// Calcul local de la décision commerciale (relevés validés uniquement)
function calcBenchmarkDecision({ ourPrice, marketRates, stayNights }) {
  const priceOf = r => Number(r.price_total || r.price_week || r.price || 0);
  const all = (marketRates||[]).map(priceOf).filter(Boolean);
  const res = (marketRates||[]).filter(r=>r.property_type==="résidence").map(priceOf).filter(Boolean);
  const marketMedian = median(res.length ? res : all);
  const marketMin = all.length ? Math.min(...all) : null;
  const marketMax = all.length ? Math.max(...all) : null;
  const validatedCount = all.length;

  if (validatedCount < 3 || !marketMedian) {
    return { marketMedian, marketMin, marketMax, validatedCount, actionType:"need_data", actionLabel:"Relevés insuffisants", priority:"high", recommendedPrice:ourPrice||null, directPrice:ourPrice?Math.round(ourPrice*0.95):null, gapPct:null, potentialGain:null };
  }
  const gapPct = ourPrice ? Math.round(((ourPrice - marketMedian) / marketMedian) * 100) : null;
  let actionType="maintain", actionLabel="Maintenir", priority="normal", recommendedPrice=marketMedian;
  if (ourPrice && gapPct < -15) { actionType="increase"; actionLabel="Augmenter"; priority="high"; recommendedPrice=Math.round(marketMedian*0.98); }
  else if (ourPrice && gapPct > 20) { actionType="promo"; actionLabel="Baisser / promo"; priority="medium"; recommendedPrice=Math.round(marketMedian*1.02); }
  else { actionType="maintain"; actionLabel="Maintenir"; priority="normal"; recommendedPrice=ourPrice||marketMedian; }
  const directPrice = recommendedPrice ? Math.round(recommendedPrice * 0.95) : null;
  const potentialGain = (ourPrice && recommendedPrice) ? recommendedPrice - ourPrice : null;
  return { marketMedian, marketMin, marketMax, validatedCount, actionType, actionLabel, priority, recommendedPrice, directPrice, gapPct, potentialGain };
}

// ══ PROMOTIONS & COURTS SÉJOURS ════════════════════════════════
const PROMO_OPP_LS = "promo_opportunities";
const PROMO_RULES_LS = "promo_rules";

async function getPromoOpportunities() {
  if (SB_READY) {
    try { return await sb.select("promo_opportunities", "order=created_at.desc&limit=300&select=*"); }
    catch { return []; }
  }
  return ls.get(PROMO_OPP_LS).slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,300);
}
async function savePromoOpportunity(opp) {
  const payload = { ...opp }; delete payload.id;
  if (SB_READY) return await sb.insert("promo_opportunities", payload);
  const all = ls.get(PROMO_OPP_LS);
  const created = { ...payload, id:"po_"+Date.now(), created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
  all.push(created); ls.set(PROMO_OPP_LS, all); return created;
}
async function updatePromoOpportunity(id, patch) {
  if (SB_READY) return await sb.update("promo_opportunities", `id=eq.${id}`, { ...patch, updated_at:new Date().toISOString() });
  const all = ls.get(PROMO_OPP_LS); const i = all.findIndex(r=>r.id===id);
  if (i>=0) { all[i] = { ...all[i], ...patch, updated_at:new Date().toISOString() }; ls.set(PROMO_OPP_LS, all); return all[i]; }
  return null;
}
async function deletePromoOpportunity(id) {
  if (SB_READY) return sb.delete("promo_opportunities", `id=eq.${id}`);
  ls.set(PROMO_OPP_LS, ls.get(PROMO_OPP_LS).filter(r=>r.id!==id)); return true;
}
async function getPromoRules() {
  if (SB_READY) {
    try { return await sb.select("promo_rules", "is_active=eq.true&select=*"); }
    catch { return []; }
  }
  return ls.get(PROMO_RULES_LS).filter(r=>r.is_active!==false);
}

// ══ COURTS SÉJOURS (short_stay_rules) ══════════════════════════
const SHORT_STAY_LS = "short_stay_rules";
const DEFAULT_SHORT_STAY_RULES = [
  { accommodation_type:"2P6", season:"ete", stay_nights:2, stay_label:"Week-end 2 nuits", multiplier:1.25, min_price:220, direct_discount_pct:5 },
  { accommodation_type:"2P6", season:"ete", stay_nights:3, stay_label:"Court séjour 3 nuits", multiplier:1.15, min_price:300, direct_discount_pct:5 },
  { accommodation_type:"2P6", season:"ete", stay_nights:4, stay_label:"Mid-week 4 nuits", multiplier:1.05, min_price:380, direct_discount_pct:5 },
  { accommodation_type:"3P8", season:"ete", stay_nights:2, stay_label:"Week-end 2 nuits", multiplier:1.25, min_price:300, direct_discount_pct:5 },
  { accommodation_type:"3P8", season:"ete", stay_nights:3, stay_label:"Court séjour 3 nuits", multiplier:1.15, min_price:420, direct_discount_pct:5 },
  { accommodation_type:"3P8", season:"ete", stay_nights:4, stay_label:"Mid-week 4 nuits", multiplier:1.05, min_price:520, direct_discount_pct:5 },
];
async function getShortStayRules() {
  if (SB_READY) {
    try { const r = await sb.select("short_stay_rules", "is_active=eq.true&select=*"); if (r&&r.length) return r; }
    catch { /* table peut manquer */ }
  }
  const ls_rules = ls.get(SHORT_STAY_LS);
  return (ls_rules&&ls_rules.length) ? ls_rules : DEFAULT_SHORT_STAY_RULES;
}
// Retrouve la règle court séjour pour une typologie/saison/durée (défaut si absente)
function findShortStayRule(rules, accommodationType, season, stayNights) {
  const all = (rules&&rules.length) ? rules : DEFAULT_SHORT_STAY_RULES;
  return all.find(r => r.accommodation_type===accommodationType && (!r.season||r.season===season) && Number(r.stay_nights)===Number(stayNights))
      || DEFAULT_SHORT_STAY_RULES.find(r => r.accommodation_type===accommodationType && Number(r.stay_nights)===Number(stayNights))
      || null;
}
// Prix court séjour Les Cimes à partir du prix semaine
function calcShortStayOurPrice({ weeklyPrice, stayNights, rule }) {
  if (!weeklyPrice || !stayNights) return null;
  const baseNight = Number(weeklyPrice) / 7;
  let price = Math.round(baseNight * stayNights * Number(rule?.multiplier || 1));
  if (rule?.min_price) price = Math.max(price, Number(rule.min_price));
  if (rule?.max_price) price = Math.min(price, Number(rule.max_price));
  return price;
}
// Recommandation promo court séjour (marché pro prioritaire, particuliers = alerte)
function calcShortStayPromoRecommendation({ ourShortPrice, marketRates, privateRates, stayNights, rule }) {
  const priceOf = r => Number(r.price_total || r.price_week || r.price || 0);
  const proPrices = (marketRates||[]).map(priceOf).filter(Boolean);
  const privPrices = (privateRates||[]).map(priceOf).filter(Boolean);
  const marketMedian = median(proPrices);
  const privateMedian = median(privPrices);
  const n = Number(stayNights||7);
  let promoType = "semaine";
  if (n===2) promoType = "week_end";
  else if (n===3 || n===4) promoType = "court_sejour";
  else if (n===7) promoType = "semaine";
  // Pression particuliers
  let pressure = "indéterminée";
  if (ourShortPrice && privateMedian) {
    const g = Math.round(((ourShortPrice - privateMedian) / privateMedian) * 100);
    pressure = g>30 ? "forte" : g>=15 ? "moyenne" : "faible";
  }
  if (proPrices.length < 3 || !marketMedian) {
    return { marketMedian, privateMedian, recommendedPrice:null, directPrice:null, promoType, pressure, needData:true, validatedCount:proPrices.length, explanation:"Pas assez de relevés concurrents pour cette durée." };
  }
  let recommendedPrice = Math.round(marketMedian * 0.97);
  if (rule?.min_price) recommendedPrice = Math.max(recommendedPrice, Number(rule.min_price));
  if (rule?.max_price) recommendedPrice = Math.min(recommendedPrice, Number(rule.max_price));
  const directPct = rule?.direct_discount_pct != null ? Number(rule.direct_discount_pct) : 5;
  const directPrice = Math.round(recommendedPrice * (1 - directPct/100));
  let explanation = `Aligné sur la médiane pro (${fmt0(marketMedian)}€) × 0,97.`;
  if (pressure==="forte") explanation += " Pression particuliers forte : offre directe limitée, sans alignement automatique sur les particuliers.";
  return { marketMedian, privateMedian, recommendedPrice, directPrice, promoType, pressure, needData:false, validatedCount:proPrices.length, explanation };
}
function fmt0(n){ return Math.round(Number(n)||0).toLocaleString("fr-FR"); }

// Calcule une opportunité promo locale (sans IA, sans prix non validé)
function calcPromoOpportunity({ ourPrice, marketRates, stayNights, accommodationType, capacity, promoRule, daysToArrival }) {
  const priceOf = r => Number(r.price_total || r.price_week || r.price || 0);
  const all = (marketRates||[]).map(priceOf).filter(Boolean);
  const res = (marketRates||[]).filter(r=>r.property_type==="résidence").map(priceOf).filter(Boolean);
  const marketMedian = median(res.length ? res : all);
  const validatedCount = all.length;
  const n = Number(stayNights||7);
  // Type de promo
  let promoType="semaine", promoLabel="Semaine 7 nuits";
  if (n===2) { promoType="weekend"; promoLabel="Week-end 2 nuits"; }
  else if (n===3 || n===4) { promoType="court_sejour"; promoLabel=`Court séjour ${n} nuits`; }
  else if (n===7) { promoType="semaine"; promoLabel="Semaine 7 nuits"; }
  if (daysToArrival!=null && promoRule && Number(daysToArrival) <= Number(promoRule.last_minute_days||14)) {
    promoType="last_minute"; promoLabel="Dernière minute";
  }
  if (validatedCount < 3 || !marketMedian) {
    return { promoType, promoLabel, marketMedian, validatedCount, recommendedPrice:null, directPrice:null, priority:"high", needData:true };
  }
  let recommendedPrice = Math.round(marketMedian * 0.97);
  // dernière minute : remise supplémentaire
  if (promoType==="last_minute" && promoRule) recommendedPrice = Math.round(recommendedPrice * (1 - Number(promoRule.last_minute_discount_pct||10)/100));
  if (promoType==="weekend" && promoRule?.weekend_premium_pct) recommendedPrice = Math.round(recommendedPrice * (1 + Number(promoRule.weekend_premium_pct)/100));
  // bornes
  if (promoRule?.min_price && recommendedPrice < Number(promoRule.min_price)) recommendedPrice = Number(promoRule.min_price);
  if (promoRule?.max_price && recommendedPrice > Number(promoRule.max_price)) recommendedPrice = Number(promoRule.max_price);
  const directPct = promoRule?.direct_discount_pct != null ? Number(promoRule.direct_discount_pct) : 5;
  const directPrice = Math.round(recommendedPrice * (1 - directPct/100));
  // priorité : si notre prix est très au-dessus du conseillé → opportunité forte
  let priority = "normal";
  if (ourPrice && recommendedPrice < ourPrice * 0.9) priority = "high";
  else if (promoType==="last_minute") priority = "medium";
  return { promoType, promoLabel, marketMedian, validatedCount, recommendedPrice, directPrice, priority, needData:false };
}

// Message promo local (sans IA)
function buildPromoMessage(opportunity) {
  const type = opportunity.promo_type || opportunity.promoType;
  let msg;
  switch (type) {
    case "week_end":
    case "weekend": msg = "Évasion montagne le temps d'un week-end : 2 nuits aux Cimes du Val d'Allos, piscine intérieure chauffée et station à pied."; break;
    case "court_sejour": msg = `Profitez d'un court séjour à La Foux d'Allos : ${opportunity.stay_nights||opportunity.stayNights||3} nuits en appartement tout équipé, accès piscine et espace bien-être inclus.`; break;
    case "last_minute": msg = "Dernière minute aux Cimes : profitez d'un tarif spécial pour un séjour montagne tout confort."; break;
    case "semaine": default: msg = "Séjour famille 7 nuits aux Cimes du Val d'Allos : appartement spacieux, piscine intérieure et activités montagne à proximité.";
  }
  if (opportunity.pressure === "forte") msg += " Offre directe limitée, sans alignement automatique sur les particuliers.";
  return msg;
}

function median(arr) {
  if (!arr.length) return null;
  const sorted=[...arr].sort((a,b)=>a-b); const mid=Math.floor(sorted.length/2);
  return sorted.length%2!==0 ? sorted[mid] : Math.round((sorted[mid-1]+sorted[mid])/2);
}

function calcReco(ourPrice, rates, settings={}) {
  const { thresholdLow=15, thresholdHigh=20, obsoleteDays=7, minScore=70 }=settings;
  const now=new Date(); const age=d=>d?Math.floor((now-new Date(d))/864e5):999;
  const pendingCount=rates.filter(r=>!r.is_example&&r.reliability_status==="à vérifier").length;
  const rejectedCount=rates.filter(r=>!r.is_example&&r.reliability_status==="rejeté").length;
  // Seuls les relevés au statut fiable entrent dans le calcul
  const trusted=rates.filter(r=>!r.is_example&&TRUSTED_STATUSES.includes(r.reliability_status??"à vérifier"));
  const qualified=trusted.filter(r=>(r.comparability_score??50)>=minScore);
  const excluded=trusted.filter(r=>(r.comparability_score??50)<minScore);
  const recent=qualified.filter(r=>age(r.collected_at)<=obsoleteDays);
  const hasOld=qualified.some(r=>age(r.collected_at)>obsoleteDays);
  const maxAge=qualified.length?Math.max(...qualified.map(r=>age(r.collected_at))):null;
  const byType=t=>qualified.filter(r=>r.property_type===t); const prices=arr=>arr.map(r=>Number(r.price_week)).filter(Boolean);
  const medAll=median(prices(qualified)); const medRes=median(prices(byType("résidence"))); const medPart=median(prices(byType("particulier"))); const medHot=median(prices(byType("hôtel"))); const ref=medRes??medAll;
  const hasEnough=qualified.length>=3; const promoCount=trusted.filter(r=>r.promo_label).length;
  const confidence=!hasEnough?"faible":(qualified.length>=5&&recent.length>=3)?"fort":"moyen";
  const confScore={faible:20,moyen:55,fort:85}[confidence];
  let action="Maintenir", urgency="normal", explanation="";
  const low=ref?Math.round(ref*0.95):(ourPrice||0); const target=ref?Math.round(ref*1.02):(ourPrice||0); const high=ref?Math.round(ref*1.18):(ourPrice||0);
  if (!ref) {
    action="Relevé insuffisant"; urgency="haut";
    explanation = qualified.length===0 && pendingCount>0
      ? `Relevés à vérifier : ${pendingCount}. Validez au moins 3 relevés pour obtenir une recommandation fiable.`
      : `${qualified.length} relevé(s) validé(s) qualifié(s) (score ≥${minScore}). Minimum 3 requis.`;
  }
  else if (ourPrice) {
    const pct=(ourPrice-ref)/ref*100;
    if (pct<-thresholdLow) { action="Augmenter le tarif"; urgency="haut"; explanation=`Tarif ${Math.abs(Math.round(pct))}% sous la médiane résidences (${ref.toLocaleString("fr-FR")}€). Potentiel +${(ref-ourPrice).toLocaleString("fr-FR")}€/sem.`; }
    else if (pct>thresholdHigh) { action="Baisser ou créer une promo"; urgency="moyen"; explanation=`Tarif ${Math.round(pct)}% au-dessus de la médiane (${ref.toLocaleString("fr-FR")}€).`; }
    else if (promoCount>=3) { action="Surveiller les promotions"; urgency="moyen"; explanation=`${promoCount} concurrents en promotion.`; }
    else { action="Maintenir"; urgency="normal"; explanation=`Bien positionné (${pct>=0?"+":""}${Math.round(pct)}% vs ${ref.toLocaleString("fr-FR")}€ médiane).`; }
  }
  if (hasOld) explanation+=" ⚠ Relevés partiellement obsolètes.";
  return { medAll, medRes, medPart, medHot, ref, low, target, high, action, urgency, confidence, confScore, explanation, hasEnough, promoCount, ratesCount:qualified.length, excludedCount:excluded.length, recentCount:recent.length, dataAgeDays:maxAge, hasOld, pendingCount, rejectedCount, trustedCount:trusted.length };
}

function parsePaste(text, source, weekId, capacity) {
  const full=text.toLowerCase(); const priceRe=/(\d[\d\s]{1,5})\s*€|€\s*(\d[\d\s]{1,5})|\b(\d{2,4})\b(?=\s*(?:€|eur|\s*\/\s*(?:nuit|sem|semaine)))/gi;
  const pricesSet=new Set(); let m;
  while((m=priceRe.exec(text))!==null){ const v=parseFloat((m[1]||m[2]||m[3]).replace(/\s/g,"")); if(v>=30&&v<=8000) pricesSet.add(v); }
  const prices=[...pricesSet].sort((a,b)=>a-b);
  let originalPrice=null; const barreM=text.match(/(?:de|était|barré|avant|au lieu de)\s*:?\s*([\d\s]{3,6})\s*€/i); if(barreM){ const v=parseFloat(barreM[1].replace(/\s/g,"")); if(v>0) originalPrice=v; }
  let promoLabel=null, promoPercent=0;
  if(/genius/i.test(full)){ promoLabel="Genius -10%"; promoPercent=10; } else if(/last[\s-]?minute/i.test(full)){ promoLabel="Last minute"; promoPercent=15; } else if(/early[\s-]?booking/i.test(full)){ promoLabel="Early booking"; promoPercent=10; } else if(/petit[\s-]?d[eé]j/i.test(full)){ promoLabel="PDJ inclus"; } else if(/annulation\s*gratuite/i.test(full)){ promoLabel="Annulation gratuite"; } else { const pm=full.match(/-(\d{1,2})\s*%/); if(pm){ promoPercent=parseInt(pm[1]); promoLabel=`-${promoPercent}%`; } }
  const ratingM=text.match(/(\d[,.]?\d?)\s*\/\s*10|note\s*[^:]*:\s*(\d[,.]?\d?)/i); const rating=ratingM?parseFloat((ratingM[1]||ratingM[2]).replace(",",".")):null;
  const feeM=text.match(/(?:frais\s*(?:de\s*)?m[eé]nage|cleaning fee)\s*:?\s*([\d\s]+)\s*€/i); const cleaningFee=feeM?parseFloat(feeM[1].replace(/\s/g,"")):0;
  const capM=text.match(/(\d)\s*(?:personnes?|pers\.|voyageurs?|guests?)/i); const detectedCap=capM?parseInt(capM[1]):capacity;
  const isNight=/par nuit|\/nuit|per night|nightly/i.test(text); const nightPrices=prices.filter(p=>p<500); const weekPrices=prices.filter(p=>p>=200&&p<=5000);
  let priceWeek=0, priceNight=0;
  if(isNight&&nightPrices.length){ priceNight=nightPrices[Math.floor(nightPrices.length/2)]; priceWeek=Math.round(priceNight*7); } else if(weekPrices.length){ priceWeek=weekPrices[Math.floor(weekPrices.length/2)]; priceNight=Math.round(priceWeek/7); } else if(prices.length){ priceWeek=prices[0]; priceNight=Math.round(priceWeek/7); }
  return { allPrices:prices, warning:!priceWeek?"Aucun prix détecté. Vérifiez le texte collé.":null, priceWeek, priceNight, originalPrice, promoLabel, promoPercent, cleaningFee, rating, detectedCap };
}

// ══ UI HELPERS ═══════════════════════════════════════════════════
const C = { blue:"#1B3A6B", blueL:"#2E5FAC", bluePale:"#EEF4FF", green:"#1A7A5E", greenL:"#E6F4EF", orange:"#D45400", orangeL:"#FFF0E6", red:"#B91C1C", redL:"#FEE2E2", purple:"#6D28D9", purpleL:"#EDE9FE", gold:"#92400E", goldL:"#FEF3C7", gray:"#6B7280", grayL:"#F3F4F6", grayM:"#E5E7EB", white:"#FFF", text:"#111827", textS:"#6B7280" };
const fmt=n=>typeof n==="number"?n.toLocaleString("fr-FR"):"—";
const fmtPct=n=>(n>=0?"+":"")+Math.round(n)+"%";
const daysSince=d=>d?Math.floor((Date.now()-new Date(d))/864e5):999;
const CAT_C={ haute:"#D45400", moyenne:C.blueL, basse:C.green };
const CAT_L={ haute:"Haute saison", moyenne:"Moy. saison", basse:"Basse saison" };

function Badge({ label, color, bg, size=10 }) { return <span style={{ fontSize:size, fontWeight:700, background:bg, color, padding:"2px 6px", borderRadius:4, whiteSpace:"nowrap" }}>{label}</span>; }
function ReliaBadge({ status }) { const m={ réel:{bg:C.greenL,c:C.green}, "validé":{bg:C.greenL,c:C.green}, "saisi manuellement":{bg:C.bluePale,c:C.blue}, "importé CSV":{bg:C.purpleL,c:C.purple}, "copier-coller":{bg:"#F3E8FF",c:C.purple}, "à vérifier":{bg:C.goldL,c:C.orange}, "rejeté":{bg:C.redL,c:C.red}, estimé:{bg:C.goldL,c:C.gold}, "scraping-auto":{bg:"#F0FDF4",c:"#166534"}, "scraping-batch":{bg:"#F0FDF4",c:"#166534"} }[status]||{bg:C.grayL,c:C.gray}; return <span style={{ fontSize:9, fontWeight:600, background:m.bg, color:m.c, padding:"1px 5px", borderRadius:4 }}>{status}</span>; }
function PromoBadge({ label }) { if(!label) return null; const m={ "Genius -10%":{bg:"#DBEAFE",c:"#1D40AE"}, "Last minute":{bg:C.redL,c:C.red}, "Early booking":{bg:C.greenL,c:C.green}, "PDJ inclus":{bg:C.purpleL,c:C.purple}, "Annulation gratuite":{bg:C.greenL,c:C.green} }[label]||{bg:C.orangeL,c:C.orange}; const short=label.replace("Genius -10%","GENIUS").replace("Last minute","LAST MIN").replace("Early booking","EARLY").replace("PDJ inclus","PDJ").replace("Annulation gratuite","ANNUL.").slice(0,12); return <span style={{ fontSize:9, fontWeight:700, background:m.bg, color:m.c, padding:"2px 5px", borderRadius:4 }}>{short}</span>; }

// ══ LOGIN SCREEN (hors App pour éviter re-mount) ═════════════════
function LoginScreen({ loginErr, SB_READY, loginEmail, setLE, loginPwd, setLP, loginLoading, handleLogin }) {
  const sml={ fontSize:10, fontWeight:700, color:C.gray, margin:"12px 2px 5px", letterSpacing:"0.06em", textTransform:"uppercase" };
  const inp=(extra={})=>({ width:"100%", padding:"8px 10px", fontSize:13, border:`1px solid ${C.grayM}`, borderRadius:9, background:C.white, color:C.text, boxSizing:"border-box", ...extra });
  const btn=(dis,bg=C.blue,fg=C.white)=>({ width:"100%", padding:"12px", fontSize:14, fontWeight:600, background:dis?"#C7C7CC":bg, color:fg, border:"none", borderRadius:11, cursor:dis?"not-allowed":"pointer", marginBottom:6 });
  return (
    <div style={{ padding:"60px 28px 0" }}>
      <div style={{ width:52, height:52, background:C.blue, borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:22 }}><span style={{ fontSize:26 }}>⛰</span></div>
      <h1 style={{ margin:"0 0 5px", fontSize:21, fontWeight:700, color:C.text }}>Benchmark Les Cimes</h1>
      <p style={{ margin:"0 0 30px", fontSize:12, color:C.textS }}>Val d'Allos · Accès privé</p>
      {loginErr&&<div style={{ background:C.redL, borderRadius:9, padding:"9px 12px", marginBottom:10 }}><p style={{ margin:0, fontSize:12, color:C.red, fontWeight:600 }}>✗ {loginErr}</p></div>}
      {!SB_READY&&<div style={{ background:C.goldL, borderRadius:9, padding:"9px 12px", marginBottom:10 }}><p style={{ margin:0, fontSize:10, color:C.gold }}>Mode démo — saisir n'importe quel email/mot de passe.</p></div>}
      <p style={sml}>Email</p>
      <input type="email" style={{ ...inp(), marginBottom:10 }} value={loginEmail} onChange={e=>setLE(e.target.value)} placeholder="votre@email.com" autoComplete="email"/>
      <p style={sml}>Mot de passe</p>
      <input type="password" style={{ ...inp(), marginBottom:16 }} value={loginPwd} onChange={e=>setLP(e.target.value)} placeholder="••••••••" autoComplete="current-password" onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
      <button style={btn(loginLoading)} onClick={handleLogin} disabled={loginLoading}>{loginLoading?"Connexion…":"Se connecter →"}</button>
      <p style={{ fontSize:9, color:C.gray, textAlign:"center", marginTop:12, lineHeight:1.5 }}>Application privée · Données confidentielles<br/>Config : VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY</p>
    </div>
  );
}

// ══ APP ══════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen]     = useState("login");
  const [user, setUser]         = useState(null);
  const [loginEmail, setLE]     = useState("");
  const [loginPwd, setLP]       = useState("");
  const [loginErr, setLErr]     = useState("");
  const [loginLoading, setLL]   = useState(false);

  const [yr, setYr]             = useState(2026);
  const [cap, setCap]           = useState("6p");
  const [selWeekId, setSWId]    = useState("2026_w7");
  const [competitors, setComps] = useState(DEFAULT_COMPETITORS);
  const [rates, setRates]       = useState([]);
  const [ratesLoading, setRL]   = useState(false);
  const [showExamples, setSE]   = useState(false);
  const [tab, setTab]           = useState("detail");
  const [collectMode, setCM]    = useState(null);
  const [formSaved, setFS]      = useState(null);
  const [deleteConfirm, setDC]  = useState(null);
  const [history, setHistory]   = useState([]);
  const [histFilter, setHF]     = useState({ season:"", nights:0 });
  const [imports, setImports]   = useState([]);
  const [iaText, setIaText]     = useState(null);
  const [iaLoading, setIaL]     = useState(false);
  const [iaError, setIaError]   = useState(null);
  const [settings]              = useState({ thresholdLow:15, thresholdHigh:20, obsoleteDays:7, minScore:70 });

  // ── Responsive : desktop prioritaire, mobile secondaire ───────
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 700 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 700);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isDesktop = !isMobile;

  const [csvText, setCsvText]   = useState("");
  const [csvResult, setCsvResult] = useState(null);
  const [csvLoading, setCsvLoad]  = useState(false);

  // ── Scraping simple ──────────────────────────────────────────
  const [scraping, setScraping]           = useState(false);
  const [scrapedRates, setScrapedRates]   = useState([]);
  const [scrapeError, setScrapeError]     = useState("");
  const [scrapeSaved, setScrapeSaved]     = useState({});

  // ── Plan de collecte ──────────────────────────────────────────
  const [planMode, setPlanMode]           = useState("ete_7n");
  const [planSeason, setPlanSeason]       = useState("ete");
  const [planNights, setPlanNights]       = useState(7);
  const [planPeriods, setPlanPeriods]     = useState([]);
  const [planCaps, setPlanCaps]           = useState([6]);
  const [planTypes, setPlanTypes]         = useState(["résidence", "particulier"]);
  const [planPlatforms, setPlanPlatforms] = useState(["Booking.com"]);
  const [planForceRefresh, setPlanForce]  = useState(false);
  const [planLoading, setPlanLoading]     = useState(false);
  const [planResults, setPlanResults]     = useState(null);
  const [planSaved, setPlanSaved]         = useState({});
  const [planVerifyPrice, setPlanVerifyPrice] = useState({});
  const [planError, setPlanError]         = useState("");
  const [showPlan, setShowPlan]           = useState(false);

  // ── Mode vue Périodes ─────────────────────────────────────────
  const [periodMode, setPeriodMode]       = useState("ete_7");

  // ── Tarifs Les Cimes (our_rates) ──────────────────────────────
  const [ourRates, setOurRates]           = useState([]);
  // ── Concurrents suivis (competitor_catalog) ───────────────────
  const [catalog, setCatalog]             = useState([]);
  const [catForm, setCatForm]             = useState(null); // null = fermé ; objet = formulaire ouvert
  const [competitorFormSources, setCompetitorFormSources] = useState([]);
  const [catSaving, setCatSaving]         = useState(false);
  const [catCsvText, setCatCsvText]       = useState("");
  const [srcCsvText, setSrcCsvText]       = useState("");
  const [srcCsvResult, setSrcCsvResult]   = useState(null);
  const [catCsvResult, setCatCsvResult]   = useState(null);
  const [catVerifyPrice, setCatVerifyPrice] = useState({});
  const [catChannel, setCatChannel]       = useState({});
  // ── Relevé concurrents suivis : dates personnalisables ────────
  const [trackedMode, setTrackedMode]       = useState("period"); // period | custom
  const [trackSegment, setTrackSegment]     = useState("residence"); // residence | private
  const [trackedSeason, setTrackedSeason]   = useState("ete");
  const [trackedStayNights, setTrackedStayNights] = useState(7);
  const [trackedPeriodId, setTrackedPeriodId] = useState("");
  const [trackedCheckin, setTrackedCheckin] = useState("");
  const [trackedCheckout, setTrackedCheckout] = useState("");
  const [trackedCapacity, setTrackedCapacity] = useState(6);
  const [trackedLinksVisible, setTrackedLinksVisible] = useState(false);
  const [trackedScraping, setTrackedScraping]         = useState(false);
  const [trackedScrapeResults, setTrackedScrapeResults] = useState([]);
  const [trackedScrapeError, setTrackedScrapeError]   = useState("");
  const [trackedScrapeEditedPrices, setTrackedScrapeEditedPrices] = useState({});
  const [trackedScrapeSaved, setTrackedScrapeSaved]   = useState({});
  // ── Sources multiples + page Suivi prix ───────────────────────
  const [sources, setSources]             = useState([]);
  const [sourceForm, setSourceForm]       = useState(null); // {competitor_id,...} quand ouvert
  const [sourcesOpenFor, setSourcesOpenFor] = useState(null); // competitor_id dont les sources sont dépliées
  const [trackPrices, setTrackPrices]     = useState({});  // saisie prix par clé source
  const [trackSaved, setTrackSaved]       = useState({});
  const [duplicateRatePrompt, setDuplicateRatePrompt] = useState(null); // {key, existingRate, competitor, source, price}
  const [histAll, setHistAll]             = useState([]);
  const [histLoading, setHistLoading]     = useState(false);
  const [histFilters, setHistFilters]     = useState({ competitor:"", source:"", capacity:0, status:"", segment:"" });
  // ── Décisions commerciales ────────────────────────────────────
  const [decisions, setDecisions]         = useState([]);
  const [decForm, setDecForm]             = useState({ action_type:"maintain", our_price_after:"", direct_price:"", decision_status:"à faire", notes:"" });
  const [decSaving, setDecSaving]         = useState(false);
  const [decMsg, setDecMsg]               = useState(null);
  const [benchSourceFilter, setBenchSourceFilter] = useState({ booking:true, direct:true, tour_operator:true, marketplace:false, other:false });
  const [benchAccType, setBenchAccType]   = useState("2P6");
  const [benchOccupancy, setBenchOccupancy] = useState(6);
  // ── Promotions & courts séjours ───────────────────────────────
  const [promoOpps, setPromoOpps]         = useState([]);
  const [promoRules, setPromoRules]       = useState([]);
  const [shortStayRules, setShortStayRules] = useState(DEFAULT_SHORT_STAY_RULES);
  const [promoStayNights, setPromoStayNights] = useState(3);
  const [promoAccType, setPromoAccType]   = useState("2P6");
  const [promoCheckin, setPromoCheckin]   = useState("");
  const [promoCheckout, setPromoCheckout] = useState("");
  const [promoSeason, setPromoSeason]     = useState("ete");
  const [promoMsg, setPromoMsg]           = useState(null);
  const [promoMsgPreview, setPromoMsgPreview] = useState(null);
  const [promoSourceFilter, setPromoSourceFilter] = useState({ booking:true, direct:true, tour_operator:true, marketplace:false, other:false });
  const [catSaved, setCatSaved]           = useState({});
  const [ourForm, setOurForm]             = useState({ priceTotal:"", notes:"" });
  const [ourSaving, setOurSaving]         = useState(false);
  const [ourSaved, setOurSaved]           = useState(null);
  const [ourCsvText, setOurCsvText]       = useState("");
  const [ourCsvResult, setOurCsvResult]   = useState(null);
  const [ourCsvLoading, setOurCsvLoading] = useState(false);

  // ── Dashboard : gestion tarifs Les Cimes ──────────────────────
  const [dashTarifTab, setDashTarifTab]   = useState("grille"); // grille | saisie | import | liste
  const [gridFilters, setGridFilters]     = useState({ year:0, season:"", nights:7, accType:"", source:"" });
  const [tarifCell, setTarifCell]         = useState(null); // {periodId, accType, nights, existing} édition cellule
  const [tarifCellPrice, setTarifCellPrice] = useState("");
  const [tarifCellNotes, setTarifCellNotes] = useState("");
  const [tarifCellMsg, setTarifCellMsg]   = useState(null);
  const [dashOurPeriodId, setDashOurPeriodId] = useState("2026_w7");
  const [dashOurCap, setDashOurCap]       = useState(6);
  // Filtres globaux Dashboard (pilotage)
  const [dashFilters, setDashFilters]     = useState({ season:"ete", nights:7, periodId:"2026_w7", capacity:6, accType:"2P6" });
  const [dashCompSegment, setDashCompSegment] = useState("residence");
  const [dismissedActions, setDismissedActions] = useState([]);
  const resetDashFilters = ()=>setDashFilters({ season:"ete", nights:7, periodId:"2026_w7", capacity:6, accType:"2P6" });
  const [dashOurPrice, setDashOurPrice]   = useState("");
  const [dashOurNotes, setDashOurNotes]   = useState("");
  const [dashOurSaved, setDashOurSaved]   = useState(null);
  const [dashOurSaving, setDashOurSaving] = useState(false);
  const [dashListFilter, setDashListFilter] = useState({ year:0, cap:0, nights:0 });

  const emptyForm = { weekId:"2026_w7", competitorId:"cv", source:"", type:"résidence", capacity:6, priceWeek:"", priceNight:"", originalPrice:"", promoLabel:"", promoPercent:"", cleaningFee:"", url:"", collectedAt:new Date().toISOString().slice(0,10), notes:"" };
  const [form, setForm]               = useState(emptyForm);
  const [pasteSrc, setPasteSrc]       = useState("Booking");
  const [pasteWeekId, setPWId]        = useState("2026_w7");
  const [pasteCap, setPCap]           = useState(6);
  const [pasteCompId, setPComp]       = useState("cv");
  const [pasteRaw, setPasteRaw]       = useState("");
  const [pasteEdit, setPasteEdit]     = useState(null);
  const [pasteSaving, setPasteSaving] = useState(false);
  const fileRef = useRef();

  const selWeek  = ALL_PERIODS.find(p=>p.id===selWeekId) || ALL_PERIODS[0];
  const capNum   = parseInt(cap);
  const _nights  = selWeek?.stay_nights || 7;
  const currentCtx = {
    periodId: selWeekId,
    checkin: selWeek?.period_start || selWeek?.week_start,
    checkout: selWeek?.period_end || addDaysStr(selWeek?.period_start || selWeek?.week_start, _nights),
    stayNights: _nights,
    capacity: capNum,
  };
  const currentOurRate = getOurRateForContext(ourRates, currentCtx);
  const fallbackOurPrice = OUR_TARIFS[cap]?.[selWeek?.season_type] || 0;
  const ourPrice = currentOurRate
    ? Number(currentOurRate.price_total || currentOurRate.price_week || currentOurRate.price || 0)
    : fallbackOurPrice;
  const ourNight = ourPrice ? Math.round(ourPrice / _nights) : 0;
  const ourRateSource = currentOurRate
    ? (currentOurRate.match_type === "dates" ? "Supabase · correspondance dates" : "Supabase · correspondance period_id")
    : "Grille interne fallback";
  const reco     = calcReco(ourPrice,rates,settings);

  // ── Relevé concurrents suivis : périodes disponibles ──────────
  const trackedAvailablePeriods = ALL_PERIODS.filter(p =>
    p.id !== "custom" &&
    (trackedSeason === "all" || p.season === trackedSeason) &&
    Number(p.stay_nights || 7) === Number(trackedStayNights)
  );
  // 3/4 nuits (ou toute durée sans période prédéfinie) → forcer les dates personnalisées
  useEffect(() => {
    if (trackedAvailablePeriods.length === 0 && trackedMode === "period") setTrackedMode("custom");
  }, [trackedStayNights, trackedSeason]);

  // Initialise la période et la capacité depuis la période ouverte ailleurs
  useEffect(() => {
    const base = ALL_PERIODS.find(p=>p.id===selWeekId);
    if (base && base.id!=="custom") {
      setTrackedSeason(base.season || "ete");
      setTrackedStayNights(Number(base.stay_nights || 7));
      setTrackedPeriodId(base.id);
    }
    setTrackedCapacity(capNum);
    const start = selWeek?.period_start || selWeek?.week_start || "";
    const nights = selWeek?.stay_nights || 7;
    setTrackedCheckin(start);
    setTrackedCheckout(selWeek?.period_end || (start ? addDaysStr(start, nights) : ""));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selWeekId, capNum]);

  // Si la période sélectionnée n'est plus valide après changement saison/durée → 1ère dispo
  useEffect(() => {
    if (trackedMode!=="period") return;
    const stillValid = trackedAvailablePeriods.some(p=>p.id===trackedPeriodId);
    if (!stillValid && trackedAvailablePeriods.length) setTrackedPeriodId(trackedAvailablePeriods[0].id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedSeason, trackedStayNights, trackedMode]);

  function getTrackedPeriodContext() {
    if (trackedMode === "custom") {
      const checkin = trackedCheckin;
      const checkout = trackedCheckout;
      const nights = daysBetween(trackedCheckin, trackedCheckout);
      const capacity = Number(trackedCapacity || capNum);
      return { periodId:`custom_${checkin}_${checkout}_${capacity}p`, label:`${checkin} → ${checkout}`, checkin, checkout, capacity, stayNights:nights, season:trackedSeason || "ete" };
    }
    const period = ALL_PERIODS.find(p => p.id === trackedPeriodId) || selWeek;
    const checkin = period.period_start || period.week_start;
    const stayNights = Number(period.stay_nights || trackedStayNights || 7);
    const checkout = period.period_end || addDaysStr(checkin, stayNights);
    const capacity = Number(trackedCapacity || capNum);
    return {
      periodId: period.id,
      label: period.label || period.subtitle || `${checkin} → ${checkout}`,
      checkin, checkout, capacity, stayNights,
      season: period.season || trackedSeason || "ete",
    };
  }
  function isTrackedCtxValid(ctx) {
    return !!(ctx.checkin && ctx.checkout && ctx.checkout > ctx.checkin && ctx.capacity);
  }

  // ── Auth ──────────────────────────────────────────────────────
  useEffect(()=>{ const restored=sb.restoreSession(); if(restored){ setUser(restored); setScreen("dashboard"); } },[]);

  async function handleLogin() {
    setLErr(""); setLL(true);
    try {
      if (SB_READY) { const d=await sb.signIn(loginEmail,loginPwd); setUser({ email:d.user?.email||loginEmail, id:d.user?.id }); }
      else { if(!loginEmail||!loginPwd){ setLErr("Email et mot de passe requis."); setLL(false); return; } setUser({ email:loginEmail, demo:true }); }
      setScreen("dashboard");
    } catch(e) { setLErr(e.message); }
    setLL(false);
  }
  function handleLogout() { sb.signOut(); setUser(null); setScreen("login"); setRates([]); }

  // ── Charger relevés ───────────────────────────────────────────
  const loadRates = useCallback(async()=>{
    if(!selWeekId||!capNum) return; setRL(true);
    try { const d=await getCompetitorRates({ weekId:selWeekId, capacity:capNum, showExamples },competitors); setRates(d||[]); }
    catch(e) { console.error(e); setRates([]); }
    setRL(false);
  },[selWeekId,capNum,showExamples,competitors]);

  useEffect(()=>{ if(user) loadRates(); },[loadRates,user]);
  useEffect(()=>{ if(user) getImports().then(setImports).catch(()=>{}); },[user]);
  useEffect(()=>{ if(user) getOurRates().then(setOurRates).catch(()=>{}); },[user]);
  useEffect(()=>{ if(user) getCompetitorCatalog().then(setCatalog).catch(()=>{}); },[user]);
  useEffect(()=>{ if(user) getCompetitorSources().then(setSources).catch(()=>{}); },[user]);

  async function reloadOurRates() { try { const d=await getOurRates(); setOurRates(d||[]); } catch {} }

  // ── Concurrents suivis : chargement + handlers ────────────────
  async function reloadCatalog() { try { const d=await getCompetitorCatalog(); setCatalog(d||[]); } catch {} }

  function addCompetitorFormSource(kind) {
    const presets = {
      booking:   { source_type:"booking",       source_name:"Booking.com" },
      direct:    { source_type:"direct",         source_name:"Site direct" },
      maeva:     { source_type:"tour_operator",  source_name:"Maeva" },
      lafrance:  { source_type:"tour_operator",  source_name:"La France du Nord au Sud" },
      travelski: { source_type:"tour_operator",  source_name:"Travelski" },
      locasun:   { source_type:"tour_operator",  source_name:"Locasun" },
      abritel:   { source_type:"marketplace",    source_name:"Abritel" },
      airbnb:    { source_type:"marketplace",    source_name:"Airbnb" },
      expedia:   { source_type:"marketplace",    source_name:"Expedia" },
      bookingpart:{ source_type:"marketplace",   source_name:"Booking particulier" },
      pap:       { source_type:"marketplace",    source_name:"PAP vacances" },
      leboncoin: { source_type:"marketplace",    source_name:"Leboncoin" },
      other:     { source_type:"other",          source_name:"" },
    };
    const p = presets[kind] || presets.other;
    setCompetitorFormSources(prev => [...prev, { ...p, source_url:"", notes:"" }]);
  }
  function updateCompetitorFormSource(idx, patch) {
    setCompetitorFormSources(prev => prev.map((s,i)=>i===idx?{ ...s, ...patch }:s));
  }
  function removeCompetitorFormSource(idx) {
    setCompetitorFormSources(prev => prev.filter((_,i)=>i!==idx));
  }
  // Ouvre le formulaire concurrent en préchargeant ses sources existantes (édition)
  function openCatForm(c) {
    if (c) {
      setCatForm({ ...c });
      const existing = (sources||[]).filter(s=>s.competitor_id===c.id && s.is_active!==false)
        .map(s=>({ id:s.id, source_type:s.source_type, source_name:s.source_name, source_url:s.source_url, notes:s.notes||"" }));
      setCompetitorFormSources(existing);
    } else {
      setCatForm({ property_type:"résidence", search_location:"La Foux d'Allos" });
      setCompetitorFormSources([]);
    }
  }

  async function handleSaveCatalogItem() {
    if (!catForm?.name?.trim()) return;
    setCatSaving(true);
    try {
      const saved = await saveCompetitorCatalogItem(catForm);
      const compId = saved?.id || saved?.[0]?.id || catForm.id;
      // Enregistrer les sources renseignées
      if (compId) {
        for (const s of competitorFormSources) {
          if (!s.source_url?.trim()) continue;
          if (s.source_type==="other" && !s.source_name?.trim()) continue;
          await saveCompetitorSource({
            id: s.id,
            competitor_id: compId,
            source_type: s.source_type,
            source_name: s.source_name?.trim() || "Autre",
            source_url: normalizeSourceUrl(s.source_url),
            notes: s.notes || null,
            is_active: true,
          });
        }
        await reloadSources();
      }
      await reloadCatalog();
      setCatForm(null);
      setCompetitorFormSources([]);
    } catch(e) { setCatForm(f=>({ ...f, error:e.message })); }
    setCatSaving(false);
  }

  async function handleDeleteCatalogItem(id) {
    try { await deleteCompetitorCatalogItem(id); await reloadCatalog(); } catch(e) { console.error(e); }
  }

  async function handleImportCatalogCsv() {
    if (!catCsvText.trim()) return;
    try { const r = await importCatalogCsv(catCsvText); setCatCsvResult(r); await reloadCatalog(); }
    catch(e) { setCatCsvResult({ ok:0, skipped:0, errors:[e.message] }); }
  }
  async function handleImportSourcesCsv() {
    if (!srcCsvText.trim()) return;
    try { const r = await importSourcesCsv(srcCsvText, catalog); setSrcCsvResult(r); await reloadSources(); }
    catch(e) { setSrcCsvResult({ added:0, skipped:0, errors:[e.message] }); }
  }

  // Enregistre un prix vérifié pour un concurrent suivi (validé immédiatement)
  async function saveTrackedCompetitorRate(competitor, channel, priceTotal) {
    const price = Number(priceTotal)||0;
    const ctx = getTrackedPeriodContext();
    const key = `${competitor.id}_${channel}`;
    if (!price || isOwnProperty(competitor.name)) return;
    if (!isTrackedCtxValid(ctx)) { setPlanError("Dates invalides : vérifiez arrivée et départ."); return; }
    const isDirect = channel === "direct";
    const sourceLabel = isDirect ? "Site direct" : "Booking.com";
    const sourceUrl = isDirect ? buildTrackedDirectUrl(competitor) : buildTrackedBookingUrl(competitor, ctx);
    try {
      await saveCompetitorRate({
        week_id:            ctx.periodId,
        source:             sourceLabel,
        property_name:      competitor.name,
        competitor:         competitor.name,
        property_type:      competitor.property_type || "résidence",
        competitor_id:      null,
        comparability_score:competitor.comparability_score || 80,
        capacity:           ctx.capacity,
        price:              price,
        price_week:         price,
        price_total:        price,
        price_night:        Math.round(price / ctx.stayNights),
        price_week_equiv:   Math.round((price / ctx.stayNights) * 7),
        stay_nights:        ctx.stayNights,
        period_start:       ctx.checkin,
        period_end:         ctx.checkout,
        season:             ctx.season,
        source_url:         sourceUrl,
        source_search_url:  sourceUrl,
        collected_at:       new Date().toISOString().slice(0,10),
        collection_type:    isDirect ? "relevé manuel direct" : "relevé manuel Booking",
        reliability_status: "validé",
        validated_at:       new Date().toISOString(),
        validation_notes:   "Prix vérifié manuellement depuis concurrent suivi",
        is_example:         false,
      }, competitors);
      setCatSaved(p=>({ ...p, [key]:"ok" }));
      setCatVerifyPrice(p=>({ ...p, [key]:"" }));
      loadRates();
    } catch(e) {
      setCatSaved(p=>({ ...p, [key]:e.message?.includes("DUPLICATE")?"dup":"err" }));
    }
  }

  // Ouvre jusqu'à 5 liens dans de nouveaux onglets
  function openAllLinks(urls) {
    const list = urls.filter(Boolean);
    if (list.length === 0) return;
    if (list.length > 5) { setPlanError("Trop de liens : seuls les 5 premiers seront ouverts (limite navigateur)."); }
    list.slice(0,5).forEach(u => window.open(u, "_blank", "noopener,noreferrer"));
  }

  // ── Scraping ciblé des concurrents suivis (prévalidation) ─────
  async function scrapeTrackedRates(segment) {
    const ctx = getTrackedPeriodContext();
    if (!ctx.checkin || !ctx.checkout || !ctx.stayNights || ctx.stayNights<=0) {
      setTrackedScrapeError("Dates invalides : vérifiez arrivée et départ."); return;
    }
    const seg = segment || trackSegment;
    const list = (catalog||[]).filter(c=>!isOwnProperty(c.name) && competitorSegment(c)===seg).slice(0,5);
    if (!list.length) { setTrackedScrapeError(`Aucun concurrent ${seg==="private"?"particulier":"pro"} à scraper.`); return; }
    setTrackedScraping(true); setTrackedScrapeError(""); setTrackedScrapeResults([]); setTrackedScrapeSaved({});
    try {
      const res = await fetch("/api/scrape-tracked-rates", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          context: ctx,
          competitors: list.map(c=>({ id:c.id, name:c.name, property_type:c.property_type, preferred_channel:c.preferred_channel, booking_url:c.booking_url, direct_url:c.direct_url, search_location:c.search_location, comparability_score:c.comparability_score })),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const results = data.results || [];
      setTrackedScrapeResults(results);
      // Préremplir le champ "Prix vérifié" uniquement pour les prix fiables (pas direct, pas suspect, pas low/warning)
      const ctxF = getTrackedPeriodContext();
      const prefill = {};
      (catalog||[]).forEach(c=>{
        sourcesForCompetitor(c).forEach(s=>{
          const match = results.find(r => {
            const sameComp = String(r.competitor_name||"").toLowerCase()===String(c.name||"").toLowerCase();
            const sn=String(s.source_name||"").toLowerCase(), rs=String(r.source||"").toLowerCase();
            const sameSrc = rs===sn || String(r.channel||"").toLowerCase()===String(s.source_type||"").toLowerCase() || (sn&&rs&&(rs.includes(sn)||sn.includes(rs)));
            return sameComp && sameSrc && r.price_total;
          });
          if (!match) return;
          // Conditions de préremplissage : pas de site direct/other, pas de warning, confiance non low, prix non suspect
          if (s.source_type==="direct" || s.source_type==="other") return;
          if (match.warning || match.confidence==="low") return;
          if (isSuspiciousDetectedPrice(match.price_total, ctxF, s)) return;
          prefill[`${c.id}_${s.id}`] = String(match.price_total);
        });
      });
      if (Object.keys(prefill).length) setTrackPrices(p=>({ ...p, ...prefill }));
      if (results.length===0) setTrackedScrapeError("Aucun résultat. Ouvrez les liens manuellement.");
    } catch(e) {
      setTrackedScrapeError("Erreur scraping : "+e.message+" — vérifiez les liens manuellement.");
    }
    setTrackedScraping(false);
  }

  // Validation manuelle d'un résultat scrapé → enregistré en "validé"
  async function validateTrackedScrapedRate(result, index) {
    const ctx = getTrackedPeriodContext();
    const price = Number(trackedScrapeEditedPrices[index] || 0);
    if (!price) return;
    if (!ctx.checkin || !ctx.checkout || !ctx.stayNights || ctx.stayNights<=0) {
      setTrackedScrapeError("Dates invalides : vérifiez arrivée et départ."); return;
    }
    const competitor = (catalog||[]).find(c=>c.id===result.competitor_id) || { name:result.competitor_name };
    if (isOwnProperty(competitor.name)) return;
    try {
      await saveCompetitorRate({
        week_id:            ctx.periodId,
        competitor:         result.competitor_name,
        property_name:      result.competitor_name,
        property_type:      competitor.property_type || "résidence",
        competitor_id:      null,
        capacity:           ctx.capacity,
        price:              price,
        price_total:        price,
        price_week:         price,
        price_night:        Math.round(price / ctx.stayNights),
        price_week_equiv:   Math.round((price / ctx.stayNights) * 7),
        stay_nights:        ctx.stayNights,
        period_start:       ctx.checkin,
        period_end:         ctx.checkout,
        season:             ctx.season,
        source:             result.source,
        source_url:         result.url,
        source_search_url:  result.url,
        collection_type:    "scraping ciblé vérifié",
        reliability_status: "validé",
        comparability_score:competitor.comparability_score || 80,
        validated_at:       new Date().toISOString(),
        validation_notes:   "Prix détecté automatiquement puis validé manuellement",
        is_example:         false,
      }, competitors);
      setTrackedScrapeSaved(p=>({ ...p, [index]:"ok" }));
      loadRates();
    } catch(e) {
      setTrackedScrapeSaved(p=>({ ...p, [index]:e.message?.includes("DUPLICATE")?"dup":"err" }));
    }
  }
  function ignoreTrackedScrapedRate(index) {
    setTrackedScrapeSaved(p=>({ ...p, [index]:"ignored" }));
  }

  // ── Sources multiples : handlers ──────────────────────────────
  async function reloadSources() { try { const d=await getCompetitorSources(); setSources(d||[]); } catch {} }

  async function handleSaveSource() {
    if (!sourceForm?.source_url?.trim()) { setSourceForm(f=>({ ...f, error:"URL requise." })); return; }
    if (!sourceForm.source_name?.trim()) { setSourceForm(f=>({ ...f, error:"Nom de la source requis." })); return; }
    try { await saveCompetitorSource({ competitor_id:sourceForm.competitor_id, source_type:sourceForm.source_type, source_name:sourceForm.source_name.trim(), source_url:normalizeSourceUrl(sourceForm.source_url), notes:sourceForm.notes, is_active:true }); await reloadSources(); setSourceForm(null); }
    catch(e) { setSourceForm(f=>({ ...f, error:e.message })); }
  }
  async function handleDeleteSource(id) {
    try { await deleteCompetitorSource(id); await reloadSources(); } catch(e) { console.error(e); }
  }

  // Sources effectives d'un concurrent : table competitor_sources + legacy booking_url/direct_url
  function sourcesForCompetitor(c) {
    const fromTable = (sources||[]).filter(s=>s.competitor_id===c.id && s.is_active!==false);
    if (fromTable.length) return fromTable;
    const legacy = [];
    if (c.booking_url) legacy.push({ id:`legacy_b_${c.id}`, competitor_id:c.id, source_type:"booking", source_name:"Booking.com", source_url:c.booking_url });
    if (c.direct_url) legacy.push({ id:`legacy_d_${c.id}`, competitor_id:c.id, source_type:"direct", source_name:"Site direct", source_url:c.direct_url });
    return legacy;
  }

  // Retrouve un résultat de scraping correspondant à une source d'un concurrent
  function findScrapeResultForSource(competitor, source) {
    return (trackedScrapeResults||[]).find(r => {
      const sameCompetitor = String(r.competitor_name||"").toLowerCase() === String(competitor.name||"").toLowerCase();
      const sn = String(source.source_name||"").toLowerCase();
      const rs = String(r.source||"").toLowerCase();
      const sameSource = rs===sn || String(r.channel||"").toLowerCase()===String(source.source_type||"").toLowerCase() || (sn&&rs&&(rs.includes(sn)||sn.includes(rs)));
      return sameCompetitor && sameSource;
    });
  }

  // Enregistre un prix relevé pour une source précise (validé)
  // Trouve un relevé du même jour pour ce concurrent/source/période (doublon potentiel)
  function findSameDayRate(competitor, source, ctx) {
    const today = dateObjToISO(new Date());
    const norm = v => String(v||"").trim().toLowerCase();
    return (rates||[]).find(r =>
      !r.is_example &&
      norm(r.competitor||r.property_name||r.competitor_name)===norm(competitor.name) &&
      (norm(r.source_label||r.source)===norm(source.source_name) || norm(r.source_channel)===norm(source.source_type)) &&
      String(r.period_start||"").slice(0,10)===String(ctx.checkin||"").slice(0,10) &&
      String(r.period_end||"").slice(0,10)===String(ctx.checkout||"").slice(0,10) &&
      Number(r.stay_nights||7)===Number(ctx.stayNights||7) &&
      Number(r.capacity)===Number(ctx.capacity) &&
      String(r.collected_at||"").slice(0,10)===today
    ) || null;
  }

  function buildSourceRatePayload(competitor, source, price, ctx) {
    const url = buildSourceUrl(source, competitor, ctx);
    const scrape = findScrapeResultForSource(competitor, source);
    const detected = scrape?.price_total ? Number(scrape.price_total) : null;
    return {
      week_id:            ctx.periodId,
      competitor:         competitor.name,
      property_name:      competitor.name,
      property_type:      isPrivateCompetitor(competitor) ? "particulier" : (competitor.property_type || "résidence"),
      competitor_id:      null,
      original_detected_price: detected,
      market_segment:     isPrivateCompetitor(competitor) ? "private" : "residence",
      is_private_rental:  isPrivateCompetitor(competitor),
      capacity:           ctx.capacity,
      accommodation_type: ctx.accommodationType || null,
      price:              price,
      price_total:        price,
      price_week:         price,
      price_night:        Math.round(price / ctx.stayNights),
      price_week_equiv:   Math.round((price / ctx.stayNights) * 7),
      stay_nights:        ctx.stayNights,
      period_start:       ctx.checkin,
      period_end:         ctx.checkout,
      season:             ctx.season,
      source:             source.source_name,
      source_channel:     source.source_type,
      source_label:       source.source_name,
      source_url:         url,
      source_search_url:  url,
      collection_type:    "relevé manuel " + source.source_name,
      reliability_status: "validé",
      comparability_score:competitor.comparability_score || 80,
      collected_at:       dateObjToISO(new Date()),
      validated_at:       new Date().toISOString(),
      validation_notes:   "Prix vérifié manuellement depuis " + source.source_name,
      is_example:         false,
    };
  }

  async function saveSourceRate(competitor, source, priceRaw, key, options={}) {
    const price = Number(String(priceRaw ?? "").replace(",", "."))||0;
    const ctx = getTrackedPeriodContext();
    if (isOwnProperty(competitor.name)) return;
    if (!price || price<=0) { setTrackSaved(p=>({ ...p, [key]:"noprice" })); return; }
    if (!ctx.checkin || !ctx.checkout || !ctx.stayNights || ctx.stayNights<=0) { setTrackedScrapeError("Dates invalides : vérifiez arrivée et départ."); return; }
    // Doublon du jour : proposer un choix plutôt que bloquer
    const sameDay = findSameDayRate(competitor, source, ctx);
    if (sameDay && !options.forceNew && !options.updateExisting) {
      setDuplicateRatePrompt({ key, existingRate:sameDay, competitor, source, price });
      return;
    }
    try {
      if (sameDay && options.updateExisting) {
        await correctCompetitorRate(sameDay, price, "Correction du relevé du jour");
      } else {
        const payload = buildSourceRatePayload(competitor, source, price, ctx);
        if (options.forceNew) payload.validation_notes = "Nouveau relevé ajouté malgré un relevé existant le même jour";
        await saveCompetitorRate(payload, competitors);
      }
      setTrackSaved(p=>({ ...p, [key]:"ok" }));
      setTrackPrices(p=>({ ...p, [key]:"" }));
      setDuplicateRatePrompt(null);
      await loadRates();
      await loadHistAll();
    } catch(e) {
      setTrackSaved(p=>({ ...p, [key]:e.message?.includes("DUPLICATE")?"dup":"err" }));
    }
  }
  // Confirmation du choix doublon
  async function resolveDuplicateRate(action) {
    if (!duplicateRatePrompt) return;
    const { competitor, source, key, price } = duplicateRatePrompt;
    if (action==="cancel") { setDuplicateRatePrompt(null); return; }
    setTrackPrices(p=>({ ...p, [key]:String(price) }));
    await saveSourceRate(competitor, source, price, key, action==="update"?{ updateExisting:true }:{ forceNew:true });
  }

  // ── Page Suivi prix : historique + export ─────────────────────
  async function loadHistAll() {
    setHistLoading(true);
    try { const d = await getAllCompetitorRatesHistory(); setHistAll((d||[]).filter(r=>!r.is_example)); }
    catch { setHistAll([]); }
    setHistLoading(false);
  }
  useEffect(()=>{ if(user && (screen==="track"||screen==="benchmark")) loadHistAll(); /* eslint-disable-next-line */ },[user,screen]);
  useEffect(()=>{ if(user) getCommercialDecisions().then(setDecisions).catch(()=>{}); },[user]);
  // L'occupation cible suit par défaut la capacité de la typologie choisie
  useEffect(()=>{ const a=ACCOMMODATION_TYPES[benchAccType]; if(a) setBenchOccupancy(a.capacity); },[benchAccType]);
  async function reloadDecisions() { try { const d=await getCommercialDecisions(); setDecisions(d||[]); } catch {} }
  useEffect(()=>{ if(user){ getPromoOpportunities().then(setPromoOpps).catch(()=>{}); getPromoRules().then(setPromoRules).catch(()=>{}); getShortStayRules().then(r=>r&&r.length&&setShortStayRules(r)).catch(()=>{}); } },[user]);
  useEffect(()=>{ if(user && screen==="promotions") loadHistAll(); /* eslint-disable-next-line */ },[user,screen]);
  async function reloadPromoOpps() { try { const d=await getPromoOpportunities(); setPromoOpps(d||[]); } catch {} }
  // ── Édition / historique des relevés ──────────────────────────
  const [rateEditKey, setRateEditKey]     = useState(null);  // clé source en cours d'édition
  const [rateEditMode, setRateEditMode]   = useState(null);  // "modify" | "new" | "history"
  const [rateEditPrice, setRateEditPrice] = useState("");
  const [rateEditReason, setRateEditReason] = useState("");
  const [rateHistoryRows, setRateHistoryRows] = useState([]);
  const [rateHistoryScope, setRateHistoryScope] = useState("period");
  function openRateEdit(key, mode, currentPrice) {
    setRateEditKey(key); setRateEditMode(mode);
    setRateEditPrice(mode==="modify"&&currentPrice?String(currentPrice):"");
    setRateEditReason("");
  }
  function closeRateEdit() { setRateEditKey(null); setRateEditMode(null); setRateEditPrice(""); setRateEditReason(""); setRateHistoryRows([]); }
  async function submitRateCorrection(rate) {
    try { await correctCompetitorRate(rate, rateEditPrice, rateEditReason); await loadRates(); await loadHistAll(); closeRateEdit(); }
    catch(e){ alert(e.message); }
  }
  function loadRateHistory(name, sourceLabel, ctx, scope="period") {
    setRateHistoryScope(scope);
    const rows = (rates||[]).filter(r=>
      !r.is_example &&
      (r.competitor===name||r.property_name===name||r.competitor_name===name) &&
      (r.source===sourceLabel || r.source_label===sourceLabel) &&
      (scope==="all" || (
        String(r.period_start||"")===String(ctx.checkin||"") &&
        String(r.period_end||"")===String(ctx.checkout||"") &&
        Number(r.stay_nights||7)===Number(ctx.stayNights) &&
        Number(r.capacity)===Number(ctx.capacity)
      ))
    ).slice().sort((a,b)=>String(a.collected_at).localeCompare(String(b.collected_at)));
    setRateHistoryRows(rows);
  }
  // Réinitialise les messages de sauvegarde + scraping quand le contexte de relevé change
  useEffect(()=>{ setTrackSaved({}); setTrackedScrapeResults([]); setRateEditKey(null); setRateEditMode(null); /* eslint-disable-next-line */ },[trackedPeriodId,trackedCheckin,trackedCheckout,trackedCapacity,trackedStayNights,trackedMode]);

  function exportHistoryCsv(rows) {
    const cols = ["collected_at","week_id","period_start","period_end","competitor","source","source_channel","capacity","stay_nights","price_total","price_night","reliability_status"];
    const head = cols.join(";");
    const lines = rows.map(r=>cols.map(c=>{ const v=r[c]??""; return String(v).includes(";")?`"${v}"`:v; }).join(";"));
    const csv = [head, ...lines].join("\n");
    const b = new Blob([csv], { type:"text/csv;charset=utf-8" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href=u; a.download="historique_prix_concurrents.csv"; a.click();
  }

  // ── Enregistrer un tarif Les Cimes ────────────────────────────
  async function handleSaveOurRate() {
    const priceTotal = parseFloat(ourForm.priceTotal)||0;
    if (!priceTotal) return;
    setOurSaving(true); setOurSaved(null);
    const periodStart = selWeek?.period_start || selWeek?.week_start;
    try {
      await saveOurRate({
        period_id:    selWeekId,
        period_label: selWeek?.label || selWeek?.subtitle || null,
        period_start: periodStart,
        period_end:   selWeek?.period_end || (periodStart?addDaysStr(periodStart, _nights):null),
        season:       selWeek?.season || "ete",
        stay_nights:  _nights,
        capacity:     capNum,
        price_total:  priceTotal,
        notes:        ourForm.notes || null,
        source:       "saisie",
      });
      await reloadOurRates();
      setOurSaved("ok"); setOurForm({ priceTotal:"", notes:"" });
    } catch(e) { setOurSaved("err:"+e.message); }
    setOurSaving(false);
    setTimeout(()=>setOurSaved(null),3000);
  }

  async function handleImportOurCsv() {
    if(!ourCsvText.trim()) return; setOurCsvLoading(true);
    try {
      const r = await importOurRatesCsv(ourCsvText, ALL_PERIODS);
      setOurCsvResult(r);
      await reloadOurRates();
    } catch(e) { setOurCsvResult({ ok:0, updated:0, skipped:0, errors:[e.message] }); }
    setOurCsvLoading(false);
  }

  // ── Dashboard : enregistrer un tarif (n'importe quelle période) ─
  async function handleDashSaveOurRate() {
    const priceTotal = parseFloat(dashOurPrice)||0;
    if (!priceTotal || !dashOurPeriodId) return;
    const period = ALL_PERIODS.find(p=>p.id===dashOurPeriodId);
    if (!period) { setDashOurSaved("err:Période introuvable"); return; }
    const nights = period.stay_nights || 7;
    const periodStart = period.period_start || period.week_start;
    setDashOurSaving(true); setDashOurSaved(null);
    try {
      await saveOurRate({
        period_id:    dashOurPeriodId,
        period_label: period.label || period.subtitle || null,
        period_start: periodStart,
        period_end:   period.period_end || (periodStart?addDaysStr(periodStart, nights):null),
        season:       period.season || "ete",
        stay_nights:  nights,
        capacity:     Number(dashOurCap),
        price_total:  priceTotal,
        notes:        dashOurNotes || null,
        source:       "saisie dashboard",
      });
      await reloadOurRates();
      setDashOurSaved("ok"); setDashOurPrice(""); setDashOurNotes("");
    } catch(e) { setDashOurSaved("err:"+e.message); }
    setDashOurSaving(false);
    setTimeout(()=>setDashOurSaved(null),3000);
  }

  // ── Saisie typée : enregistre avec la typologie sélectionnée (gridFilters.accType) ─
  async function handleDashSaveOurRateTyped() {
    const priceTotal = parseFloat(dashOurPrice)||0;
    if (!priceTotal || !dashOurPeriodId) return;
    const period = ALL_PERIODS.find(p=>p.id===dashOurPeriodId);
    if (!period) { setDashOurSaved("err:Période introuvable"); return; }
    const accType = gridFilters.accType || "2P6";
    const acc = ACCOMMODATION_TYPES[accType];
    const nights = period.stay_nights || 7;
    const periodStart = period.period_start || period.week_start;
    setDashOurSaving(true); setDashOurSaved(null);
    try {
      await saveOurRate({
        period_id:          dashOurPeriodId,
        period_label:       period.label || period.subtitle || null,
        period_start:       periodStart,
        period_end:         period.period_end || (periodStart?addDaysStr(periodStart, nights):null),
        season:             period.season || "ete",
        stay_nights:        nights,
        capacity:           acc?.capacity || Number(dashOurCap) || 6,
        accommodation_type: accType,
        accommodation_label:acc?.label || null,
        price_total:        priceTotal,
        notes:              dashOurNotes || null,
        source:             "saisie dashboard",
      });
      await reloadOurRates();
      setDashOurSaved("ok"); setDashOurPrice(""); setDashOurNotes("");
    } catch(e) { setDashOurSaved("err:"+e.message); }
    setDashOurSaving(false);
    setTimeout(()=>setDashOurSaved(null),3000);
  }

  // ── Grille : enregistrer/mettre à jour le tarif d'une cellule (période × typologie) ─
  async function handleSaveTarifCell() {
    if (!tarifCell) return;
    const priceTotal = parseFloat(tarifCellPrice)||0;
    if (!priceTotal) return;
    const period = ALL_PERIODS.find(p=>p.id===tarifCell.periodId);
    if (!period) { setTarifCellMsg("err"); return; }
    const nights = tarifCell.nights || period.stay_nights || 7;
    const periodStart = period.period_start || period.week_start;
    const acc = ACCOMMODATION_TYPES[tarifCell.accType];
    try {
      await saveOurRate({
        period_id:          tarifCell.periodId,
        period_label:       period.label || period.subtitle || null,
        period_start:       periodStart,
        period_end:         period.period_end || (periodStart?addDaysStr(periodStart, nights):null),
        season:             period.season || "ete",
        stay_nights:        nights,
        capacity:           acc?.capacity || tarifCell.capacity || 6,
        accommodation_type: tarifCell.accType,
        accommodation_label:acc?.label || null,
        price_total:        priceTotal,
        notes:              tarifCellNotes || null,
        source:             "saisie grille",
      });
      await reloadOurRates();
      setTarifCellMsg("ok");
      setTimeout(()=>{ setTarifCell(null); setTarifCellPrice(""); setTarifCellNotes(""); setTarifCellMsg(null); }, 900);
    } catch(e) { setTarifCellMsg("err"); }
  }
  async function handleDeleteTarifCell() {
    if (!tarifCell?.existing?.id) { setTarifCell(null); return; }
    try { await deleteOurRate(tarifCell.existing.id); await reloadOurRates(); }
    catch(e) { console.error(e); }
    setTarifCell(null); setTarifCellPrice(""); setTarifCellNotes(""); setTarifCellMsg(null);
  }
  function openTarifCell(periodId, accType, nights, existing) {
    setTarifCell({ periodId, accType, nights, existing });
    setTarifCellPrice(existing ? String(existing.price_total||"") : "");
    setTarifCellNotes(existing ? (existing.notes||"") : "");
    setTarifCellMsg(null);
  }

  async function handleDeleteOurRate(id) {
    try { await deleteOurRate(id); await reloadOurRates(); } catch(e) { console.error(e); }
  }

  // ── Plan de collecte : auto-sélection de la période courante ──
  useEffect(()=>{
    const p = ALL_PERIODS.find(x=>x.id===selWeekId);
    if(!p) return;
    const s = p.season || "ete";
    const n = p.stay_nights || 7;
    setPlanSeason(s);
    setPlanNights(n);
    setPlanMode(s==="ete" ? "ete_7n" : n===2 ? "hiver_2n" : "hiver_7n");
    setPlanPeriods([selWeekId]);   // coche la période courante à l'ouverture d'une fiche
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selWeekId]);

  // ── Plan de collecte : capacité courante cochée ───────────────
  useEffect(()=>{ setPlanCaps([capNum]); },[capNum]);

  // ── Sauver saisie manuelle ────────────────────────────────────
  async function handleSaveForm() {
    if(!form.priceWeek) return; const comp=competitors.find(c=>c.id===form.competitorId);
    try {
      await saveCompetitorRate({ week_id:form.weekId, competitor_id:form.competitorId||null, source:form.source||comp?.source||"", property_name:comp?.name||form.source, property_type:comp?.property_type||form.type, capacity:parseInt(form.capacity)||capNum, price_week:parseFloat(form.priceWeek)||0, price_night:form.priceNight?parseFloat(form.priceNight):Math.round((parseFloat(form.priceWeek)||0)/7), original_price:form.originalPrice?parseFloat(form.originalPrice):null, promo_label:form.promoLabel||null, promo_percent:parseFloat(form.promoPercent)||0, cleaning_fee:parseFloat(form.cleaningFee)||0, url:form.url, collected_at:form.collectedAt, notes:form.notes, collection_type:"manuelle", reliability_status:"saisi manuellement", is_example:false },competitors);
      setFS("ok"); setForm({ ...emptyForm, weekId:form.weekId }); loadRates();
    } catch(e) { setFS(e.message.includes("DUPLICATE")?"duplicate":"error"); }
    setTimeout(()=>setFS(null),3000);
  }

  // ── Copier-coller ─────────────────────────────────────────────
  function handleParse() {
    if(!pasteRaw.trim()) return; const ex=parsePaste(pasteRaw,pasteSrc,pasteWeekId,pasteCap);
    setPasteEdit({ priceWeek:ex.priceWeek||"", priceNight:ex.priceNight||"", originalPrice:ex.originalPrice||"", promoLabel:ex.promoLabel||"", promoPercent:ex.promoPercent||0, cleaningFee:ex.cleaningFee||0, rating:ex.rating||"", capacity:ex.detectedCap||pasteCap, source:pasteSrc, competitorId:pasteCompId, warning:ex.warning, allPrices:ex.allPrices });
  }
  async function handleSavePaste() {
    if(!pasteEdit?.priceWeek) return; setPasteSaving(true); const comp=competitors.find(c=>c.id===pasteEdit.competitorId);
    try {
      await saveCompetitorRate({ week_id:pasteWeekId, competitor_id:pasteEdit.competitorId||null, source:pasteEdit.source, property_name:comp?.name||pasteEdit.source, property_type:comp?.property_type||"particulier", capacity:parseInt(pasteEdit.capacity)||pasteCap, price_week:parseFloat(pasteEdit.priceWeek)||0, price_night:parseFloat(pasteEdit.priceNight)||Math.round((parseFloat(pasteEdit.priceWeek)||0)/7), original_price:pasteEdit.originalPrice?parseFloat(pasteEdit.originalPrice):null, promo_label:pasteEdit.promoLabel||null, promo_percent:parseFloat(pasteEdit.promoPercent)||0, cleaning_fee:parseFloat(pasteEdit.cleaningFee)||0, booking_rating:parseFloat(pasteEdit.rating)||null, collected_at:new Date().toISOString().slice(0,10), collection_type:"copier-coller", reliability_status:"à vérifier", is_example:false, notes:`Extrait de ${pasteEdit.source} via copier-coller.` },competitors);
      setPasteEdit(null); setPasteRaw(""); setFS("ok"); loadRates();
    } catch(e) { setFS(e.message.includes("DUPLICATE")?"duplicate":"error"); }
    setPasteSaving(false); setTimeout(()=>setFS(null),3000);
  }

  // ── Import CSV ────────────────────────────────────────────────
  async function handleImportCsv() {
    if(!csvText.trim()) return; setCsvLoad(true);
    const lines=csvText.trim().split("\n").filter(l=>l.trim());
    if(lines.length<2){ setCsvResult({ ok:0, dup:0, skipped:0, errors:["Fichier vide"] }); setCsvLoad(false); return; }
    const sep=lines[0].includes(";")?";":","; const headers=lines[0].split(sep).map(h=>h.trim().toLowerCase().replace(/[^a-z_]/g,""));
    const rows=lines.slice(1).map(line=>{ const vals=line.split(sep).map(v=>v.trim().replace(/^"|"$/g,"")); const o={}; headers.forEach((h,i)=>o[h]=vals[i]||""); const week=STATIC_WEEKS.find(w=>w.week_start===o.week_start||w.id===o.week_id); const pw=parseFloat(o.price_week)||0; const pn=parseFloat(o.price_night)||Math.round(pw/7); const comp=competitors.find(c=>c.name===o.property_name||c.source===o.source); return { week_id:week?.id||"", source:o.source, property_name:o.property_name||o.source, property_type:o.property_type||comp?.property_type||"particulier", competitor_id:comp?.id||null, capacity:parseInt(o.capacity)||capNum, price_week:pw, price_night:pn, original_price:parseFloat(o.original_price)||null, promo_label:o.promo_label||null, promo_percent:parseFloat(o.promo_percent)||0, cleaning_fee:parseFloat(o.cleaning_fee)||0, url:o.url||"", collected_at:o.collected_at||new Date().toISOString().slice(0,10), reliability_status:o.reliability_status||"importé CSV", collection_type:"csv", is_example:false }; }).filter(r=>r.week_id);
    let ok=0, dup=0, skipped=0; const errors=[];
    for(const row of rows){ if(!row.price_week||!row.source){ skipped++; continue; } try { await saveCompetitorRate(row,competitors); ok++; } catch(e){ if(e.message?.includes("DUPLICATE")) dup++; else errors.push(e.message); } }
    const log={ import_source:"CSV", rows_total:rows.length+skipped, rows_imported:ok, rows_skipped:skipped, rows_duplicate:dup, rows_error:errors.length, status:errors.length===0?"ok":ok>0?"partiel":"erreur" };
    await saveImportLog(log); setCsvResult({ ok, dup, skipped, errors:errors.slice(0,4) });
    if(ok>0){ loadRates(); getImports().then(setImports).catch(()=>{}); } setCsvLoad(false);
  }

  async function handleDelete(rate) { await deleteCompetitorRate(rate.id,rate.week_id,rate.capacity); setDC(null); loadRates(); }

  // ── Validation d'un relevé (à vérifier → validé / rejeté) ─────
  async function updateRateStatus(rate, status) {
    const validatedAt = (status === "validé" || status === "rejeté") ? new Date().toISOString() : null;

    try {
      if (SB_READY) {
        try {
          await sb.update("competitor_rates", `id=eq.${rate.id}`, {
            reliability_status: status,
            validated_at: validatedAt,
          });
        } catch (e) {
          // Si validated_at n'existe pas encore, on met à jour seulement le statut.
          if (isMissingColumnError(e)) {
            await sb.update("competitor_rates", `id=eq.${rate.id}`, {
              reliability_status: status,
            });
          } else {
            throw e;
          }
        }
      } else {
        const key = `rates_${rate.week_id}_${rate.capacity}`;
        const arr = ls.get(key).map(r =>
          r.id === rate.id
            ? { ...r, reliability_status: status, validated_at: validatedAt }
            : r
        );
        ls.set(key, arr);
      }
      loadRates();
    } catch (e) {
      console.error("updateRateStatus", e);
      setPlanError("Erreur statut : " + e.message);
    }
  }

  // ── Analyse IA ────────────────────────────────────────────────
  async function runIA() {
    setIaL(true); setIaText(null); setIaError(null);
    const trustedRates=rates.filter(r=>!r.is_example&&TRUSTED_STATUSES.includes(r.reliability_status??"à vérifier"));
    const payload={ weekLabel:selWeek?.label, weekYear:selWeek?.year, seasonType:CAT_L[selWeek?.season_type]||"", eventLabel:selWeek?.event_label||"", cap, ourPrice, ourNight, rates:trustedRates.slice(0,8).map(r=>({ source:r.source, competitor_name:r.competitor_name, price_week:r.price_week, promo_label:r.promo_label, reliability_status:r.reliability_status, collected_at:r.collected_at, comparability_score:r.comparability_score })), reco:{ medRes:reco.medRes, medPart:reco.medPart, medAll:reco.medAll, action:reco.action, confidence:reco.confidence, confScore:reco.confScore, ratesCount:reco.ratesCount, excludedCount:reco.excludedCount, recentCount:reco.recentCount, hasOld:reco.hasOld }, settings };
    try {
      let res=await fetch(IA_ENDPOINT,{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      if(res.status===404){
        res=await fetch("https://api.anthropic.com/v1/messages",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:800, messages:[{ role:"user", content:buildIAPrompt(payload) }] }) });
        if(!res.ok){ const d=await res.json().catch(()=>({})); throw new Error((d.error?.message||`HTTP ${res.status}`)+"\n→ Déployer api/analyse-reco.js avec ANTHROPIC_API_KEY."); }
        const d=await res.json(); const raw=d.content?.map(b=>b.text||"").join("")||"";
        setIaText(raw.split("---").map(s=>s.replace(/^\s*\d\.\s*(POSITIONNEMENT|RISQUES|RECOMMANDATION|ACTION.*?)\s*:?\s*/i,"").trim()));
      } else {
        if(!res.ok){ const d=await res.json().catch(()=>{}); throw new Error(d?.error||`HTTP ${res.status}`); }
        const d=await res.json(); setIaText(d.parts||[]);
      }
    } catch(e) { setIaError(e.message); }
    setIaL(false);
  }
  function buildIAPrompt({ weekLabel, weekYear, seasonType, eventLabel, cap, ourPrice, ourNight, rates, reco, settings }) {
    const ratesSummary=(rates||[]).map(r=>`- ${r.competitor_name||r.source}${r.promo_label?` [${r.promo_label}]`:""}: ${r.price_week}€/sem · score ${r.comparability_score||"?"}/100 · ${r.reliability_status} · il y a ${daysSince(r.collected_at)}j`).join("\n")||"Aucun relevé.";
    return `Expert revenue management résidence Les Cimes du Val d'Allos 3*** (piscine, sauna, ski aux pieds).\n\nSEMAINE : ${weekLabel} ${weekYear} — ${seasonType}${eventLabel?` — ${eventLabel}`:""}\nNOS TARIFS : ${ourPrice}€/sem (${ourNight}€/nuit) — ${cap}\n\nRELEVÉS CONCURRENTS (${rates?.length||0}) :\n${ratesSummary}\n\nMédianes : résidences ${fmt(reco?.medRes)}€ | particuliers ${fmt(reco?.medPart)}€ | global ${fmt(reco?.medAll)}€\nRecommandation : ${reco?.action} · confiance ${reco?.confidence} (${reco?.confScore}/100)\nQualifiés (score≥${settings?.minScore||70}) : ${reco?.ratesCount} · exclus : ${reco?.excludedCount}${reco?.hasOld?" ⚠ données obsolètes":""}\n\nANALYSE 4 BLOCS séparés par "---" (2 phrases max) :\n1. POSITIONNEMENT : tarif vs résidences, écarts en €\n2. RISQUES : menace principale\n3. RECOMMANDATION : prix cible €/sem + fourchette\n4. ACTION : une action immédiate`;
  }

  // ── Scraping simple ───────────────────────────────────────────
  async function scrapeMarket() {
    setScraping(true); setScrapeError(""); setScrapedRates([]); setScrapeSaved({});
    try {
      const res=await fetch("/api/scrape-market",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ weekLabel:selWeek?.label||"", weekStart:selWeek?.week_start||"", capacity:capNum }) });
      const data=await res.json();
      if(!res.ok||data.error) throw new Error(data.error||`HTTP ${res.status}`);
      if(data.warning) setScrapeError("⚠ "+data.warning);
      if(!data.listings?.length) throw new Error("Aucun logement trouvé. Réessayez.");
      setScrapedRates(data.listings);
    } catch(e) { setScrapeError("Erreur : "+e.message); }
    setScraping(false);
  }

  async function saveScrapedRate(item, idx) {
    const pw=item.price_week?Math.round(item.price_week):item.price_night?Math.round(item.price_night*7):0;
    const pn=item.price_night?Math.round(item.price_night):pw?Math.round(pw/7):0;
    try {
      await saveCompetitorRate({ week_id:selWeekId, source:item.platform||"Scraping", property_name:item.name, competitor:item.name, property_type:item.property_type||"particulier", competitor_id:null, capacity:capNum, price_week:pw, price:pw, price_night:pn, booking_rating:item.rating||null, url:item.url||"", source_url:item.url||"", collected_at:new Date().toISOString().slice(0,10), collection_type:"scraping-auto", reliability_status:"à vérifier", is_example:false },competitors);
      setScrapeSaved(p=>({ ...p, [idx]:"ok" })); loadRates();
    } catch(e) { setScrapeSaved(p=>({ ...p, [idx]:e.message?.includes("DUPLICATE")?"dup":"err" })); }
  }

  // ── Plan de collecte ──────────────────────────────────────────
  function selectPlanMode(modeId) {
    setPlanMode(modeId); setPlanPeriods([]); setPlanResults(null); setPlanError("");
    const m=PLAN_MODES.find(x=>x.id===modeId);
    if(m && m.season) { setPlanSeason(m.season); setPlanNights(m.nights); }
  }

  async function launchPlan() {
    const staticP = PLAN_PERIODS[planMode] || PLAN_PERIODS[`${planSeason}_${planNights}n`] || [];
    // Période courante depuis selWeek (toujours candidate)
    const _curStart = selWeek?.period_start || selWeek?.week_start;
    const currentP = selWeek && _curStart ? {
      id:           selWeek.id,
      label:        selWeek.label || selWeek.subtitle || "Période courante",
      period_start: _curStart,
      period_end:   selWeek.period_end || addDaysStr(_curStart, selWeek.stay_nights || 7),
      week_start:   selWeek.week_start || _curStart,
      season:       selWeek.season || "ete",
      stay_nights:  selWeek.stay_nights || 7,
    } : null;
    const allP = currentP ? [currentP, ...staticP.filter(p=>p.id!==currentP.id)] : staticP;
    const selected = allP.filter(p=>planPeriods.includes(p.id));
    const combos = selected.length * planCaps.length;
    if(!selected.length||!planCaps.length||!planPlatforms.length||combos>1) return;
    setPlanLoading(true); setPlanError(""); setPlanResults(null); setPlanSaved({});
    try {
      const res=await fetch("/api/scrape-market-batch",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ season:planSeason, stayNights:planNights, weeks:selected.map(p=>({ id:p.id, label:p.label, week_start:p.period_start||p.week_start })), capacities:planCaps, propertyTypes:planTypes, platforms:planPlatforms, maxListingsPerSearch:5, forceRefresh:planForceRefresh }) });
      const data=await res.json();
      if(!res.ok||data.error) throw new Error(data.error||`HTTP ${res.status}`);
      setPlanResults(data.results||[]);
    } catch(e) { setPlanError("Erreur : "+e.message); }
    setPlanLoading(false);
  }

  async function savePlanRate(item, result, key, override) {
    if (isOwnProperty(item.name)) { setPlanSaved(p=>({ ...p, [key]:"own" })); return; }
    const verifiedPrice = override?.verifiedPrice ? Number(override.verifiedPrice) : 0;
    const priceTotal = verifiedPrice || Number(item.price_total??item.price_week??0);
    const priceNight = Number(item.price_night && !verifiedPrice ? item.price_night : (priceTotal?Math.round(priceTotal/(result.stay_nights||7)):0));
    const priceWeekEquiv = priceNight?Math.round(priceNight*7):null;
    try {
      await saveCompetitorRate({
        week_id:            result.week_id,
        source:             item.platform||"Scraping",
        property_name:      item.name,
        competitor:         item.name,
        property_type:      item.property_type||"particulier",
        competitor_id:      null,
        capacity:           result.capacity,
        price:              priceTotal,
        price_week:         priceTotal,
        price_total:        priceTotal,
        price_night:        priceNight,
        price_week_equiv:   priceWeekEquiv,
        stay_nights:        result.stay_nights,
        period_start:       result.period_start,
        period_end:         result.period_end,
        season:             result.season,
        source_url:         item.url||"",
        url:                item.url||"",
        source_search_url:  safeListingUrl(item, result),
        booking_rating:     item.rating||null,
        collected_at:       new Date().toISOString().slice(0,10),
        collection_type:    "scraping-batch",
        reliability_status: verifiedPrice ? "validé" : "à vérifier",
        ...(verifiedPrice && { validated_at:new Date().toISOString(), validation_notes:"Prix vérifié manuellement sur Booking" }),
        is_example:         false,
      },competitors);
      setPlanSaved(p=>({ ...p, [key]:verifiedPrice?"valid":"ok" }));
      if(result.week_id===selWeekId&&result.capacity===capNum) loadRates();
    } catch(e) {
      const status = e.message?.includes("DUPLICATE") ? "dup" : "err";
      setPlanSaved(p=>({ ...p, [key]:status }));
      if (status === "err") {
        setPlanError(`Erreur enregistrement "${item.name}" : ${e.message}`);
      }
    }
  }

  async function savePlanGroup(result) {
    for(let i=0;i<result.listings.length;i++){
      if (isOwnProperty(result.listings[i].name)) continue;
      const key=`${result.week_id}_${result.capacity}_${i}`;
      if(planSaved[key] !== "ok" && planSaved[key] !== "dup" && planSaved[key] !== "valid") await savePlanRate(result.listings[i],result,key);
    }
  }

  // ── Styles ────────────────────────────────────────────────────
  // ── Styles responsive ─────────────────────────────────────────
  const appShell = { minHeight:"100vh", background:C.grayL, fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif" };
  const appContainer = { width:"100%", maxWidth:isMobile?440:1320, margin:"0 auto", padding:isMobile?"0":"18px 20px", boxSizing:"border-box" };
  const mainGrid = { display:"grid", gridTemplateColumns:"244px 1fr", gap:18, alignItems:"start" };
  // Cadre "téléphone" uniquement en mobile ; en desktop, panneau plein large
  const ph  = isMobile
    ? { width:"100%", maxWidth:440, margin:"0 auto", background:C.grayL, minHeight:"100vh", overflow:"hidden" }
    : { width:"100%", background:C.white, borderRadius:16, overflow:"hidden", border:`0.5px solid ${C.grayM}`, minHeight:600 };
  const sbar={ height:46, display:"flex", alignItems:"flex-end", justifyContent:"space-between", padding:"0 20px 6px", background:isMobile?C.grayL:C.white };
  const cnt ={ padding:isMobile?"0 14px 80px":"0 18px 24px" };
  const responsiveGrid = (cols = 2) => ({
    display:"grid",
    gridTemplateColumns: isMobile ? "1fr" : `repeat(${cols}, minmax(0, 1fr))`,
    gap: isMobile ? 8 : 14,
    alignItems:"start",
  });
  const formGrid = { display:"grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap:8 };
  const card = (extra={}) => ({ background:C.white, borderRadius:14, border:`0.5px solid ${C.grayM}`, padding:isMobile?"12px":"14px 16px", boxShadow:"0 1px 3px rgba(16,24,40,0.04)", boxSizing:"border-box", ...extra });
  const sectionTitle = (txt, icon) => (
    <div style={{ display:"flex", alignItems:"center", gap:7, margin:"4px 2px 8px" }}>
      {icon&&<span style={{ fontSize:15 }}>{icon}</span>}
      <span style={{ fontSize:14, fontWeight:700, color:C.text }}>{txt}</span>
    </div>
  );
  const cd  =(r=14,mb=8)=>({ background:C.white, borderRadius:r, overflow:"hidden", marginBottom:mb });
  const rw  =last=>({ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 13px", borderBottom:last?"none":`0.5px solid ${C.grayL}` });
  const btn =(dis,bg=C.blue,fg=C.white)=>({ width:"100%", padding:"12px", fontSize:14, fontWeight:600, background:dis?"#C7C7CC":bg, color:fg, border:"none", borderRadius:11, cursor:dis?"not-allowed":"pointer", marginBottom:6 });
  const sml ={ fontSize:10, fontWeight:700, color:C.gray, margin:"12px 2px 5px", letterSpacing:"0.06em", textTransform:"uppercase" };
  const inp =(extra={})=>({ width:"100%", padding:"8px 10px", fontSize:13, border:`1px solid ${C.grayM}`, borderRadius:9, background:C.white, color:C.text, boxSizing:"border-box", ...extra });
  const tabB=a=>({ flex:1, padding:"8px 2px", fontSize:11, fontWeight:a?700:400, background:a?C.white:"transparent", color:a?C.blue:C.gray, border:"none", borderRadius:8, cursor:"pointer" });

  const SBar=({ title })=>(
    <div style={sbar}>
      <span style={{ fontSize:13, fontWeight:600, color:C.text }}>{title||"Benchmark"}</span>
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        {user&&<button onClick={handleLogout} style={{ fontSize:10, color:C.gray, background:"none", border:"none", cursor:"pointer" }}>Déco.</button>}
        <Badge label={SB_READY?"SUPABASE":"LOCAL"} color={SB_READY?C.green:C.gold} bg={SB_READY?C.greenL:C.goldL} size={9}/>
      </div>
    </div>
  );
  const SaveFeedback=()=>formSaved?(
    <div style={{ ...cd(9), padding:"9px 12px", background:formSaved==="ok"?C.greenL:formSaved==="duplicate"?C.goldL:C.redL, marginBottom:6 }}>
      <p style={{ margin:0, fontSize:12, fontWeight:700, color:formSaved==="ok"?C.green:formSaved==="duplicate"?C.gold:C.red }}>
        {formSaved==="ok"?`✓ Enregistré dans ${SB_READY?"Supabase":"mémoire locale"}`:formSaved==="duplicate"?"⚠ Doublon — relevé déjà existant":"✗ Erreur d'enregistrement"}
      </p>
    </div>
  ):null;

  const NAV=[{id:"dashboard",icon:"▣",l:"Dashboard"},{id:"benchmark",icon:"📊",l:"Benchmark"},{id:"track",icon:"💶",l:"Suivi prix"},{id:"promotions",icon:"🎯",l:"Promos"},{id:"weeks",icon:"📡",l:"Radar"},{id:"diag",icon:"🔬",l:"Diag"}];
  const NAV_GROUPS=[
    { label:"Pilotage", items:[{id:"dashboard",icon:"▣",l:"Dashboard"},{id:"benchmark",icon:"📊",l:"Benchmark"},{id:"promotions",icon:"🎯",l:"Promos"},{id:"track",icon:"💶",l:"Suivi prix"}] },
    { label:"Données", items:[{id:"tarifs",icon:"💰",l:"Tarifs Les Cimes"},{id:"competitors_residence",icon:"🏢",l:"Concurrents Résidences"},{id:"competitors_private",icon:"🏠",l:"Concurrents Particuliers"},{id:"import",icon:"🔗",l:"Sources & Import"}] },
    { label:"Outils", items:[{id:"weeks",icon:"📡",l:"Radar"},{id:"collect",icon:"📥",l:"Import / Saisie"},{id:"diag",icon:"🔬",l:"Diagnostic"}] },
  ];
  const goScreen=id=>{ setScreen(id); setCM(null); setIaText(null); setPasteEdit(null); };
  const BNav=()=>isMobile?(
    <div style={{ position:"sticky", bottom:0, background:C.white, borderTop:`0.5px solid ${C.grayM}`, display:"flex", padding:"6px 0 16px", zIndex:10 }}>
      {NAV.map(n=>(
        <button key={n.id} onClick={()=>goScreen(n.id)} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
          <span style={{ fontSize:16 }}>{n.icon}</span>
          <span style={{ fontSize:9, fontWeight:screen===n.id?700:400, color:screen===n.id?C.blue:C.gray }}>{n.l}</span>
        </button>
      ))}
    </div>
  ):null;
  const SideNav=()=>(
    <div style={{ background:C.blue, borderRadius:16, padding:"16px 12px", position:"sticky", top:18, minHeight:"calc(100vh - 36px)", display:"flex", flexDirection:"column" }}>
      <div style={{ display:"flex", alignItems:"center", gap:9, padding:"0 6px 16px" }}>
        <div style={{ width:34, height:34, background:"rgba(255,255,255,0.14)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><span style={{ fontSize:18 }}>⛰</span></div>
        <div style={{ minWidth:0 }}>
          <p style={{ margin:0, fontSize:15, fontWeight:700, color:C.white, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>Les Cimes</p>
          <p style={{ margin:0, fontSize:9, color:"rgba(255,255,255,0.55)" }}>Benchmark</p>
        </div>
      </div>
      {NAV_GROUPS.map((grp,gi)=>(
        <div key={grp.label} style={{ marginBottom:gi<NAV_GROUPS.length-1?6:0 }}>
          <p style={{ margin:"6px 8px 4px", fontSize:8, fontWeight:700, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", textTransform:"uppercase" }}>{grp.label}</p>
          {grp.items.map(n=>{
            const active = screen===n.id;
            return (
              <button key={n.id} onClick={()=>goScreen(n.id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:11, padding:"9px 11px", marginBottom:2, background:active?"rgba(255,255,255,0.16)":"transparent", border:"none", borderRadius:10, cursor:"pointer", textAlign:"left" }}>
                <span style={{ fontSize:14, width:18, textAlign:"center" }}>{n.icon}</span>
                <span style={{ fontSize:12, fontWeight:active?700:500, color:active?C.white:"rgba(255,255,255,0.78)" }}>{n.l}</span>
              </button>
            );
          })}
        </div>
      ))}
      <div style={{ marginTop:"auto", paddingTop:12 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:6, padding:"0 6px" }}>
          <Badge label={SB_READY?"SUPABASE":"LOCAL"} color={SB_READY?C.green:C.gold} bg={SB_READY?C.greenL:C.goldL} size={9}/>
          {user&&<button onClick={handleLogout} style={{ fontSize:10, color:"rgba(255,255,255,0.6)", background:"none", border:"none", cursor:"pointer" }}>Déco.</button>}
        </div>
        {user&&<p style={{ margin:"6px 6px 0", fontSize:9, color:"rgba(255,255,255,0.5)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.email}</p>}
        <div style={{ display:"flex", alignItems:"center", gap:7, margin:"10px 6px 0", padding:"7px 9px", background:"rgba(255,255,255,0.08)", borderRadius:9 }}>
          <span style={{ fontSize:14 }}>🖥️</span>
          <div><p style={{ margin:0, fontSize:10, fontWeight:700, color:C.white }}>Optimisé desktop</p><p style={{ margin:0, fontSize:8, color:"rgba(255,255,255,0.5)" }}>Interface responsive</p></div>
        </div>
      </div>
    </div>
  );

  // ══ ÉCRANS ════════════════════════════════════════════════════
  const Dashboard=()=>{
    // Rendu d'une ligne concurrent (réutilisé pour Pros et Particuliers)
    const renderCompetitorRow = (c, i, list) => {
            const compSources = (sources||[]).filter(s=>s.competitor_id===c.id);
            const open = sourcesOpenFor===c.id;
            const priv = isPrivateCompetitor(c);
            return (
            <div key={c.id} style={{ borderBottom:i===list.length-1?"none":`0.5px solid ${C.grayL}` }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 13px" }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                  <span style={{ fontSize:12, fontWeight:500, color:C.text }}>{c.name}</span>
                  <Badge label={priv?"Particulier":c.property_type==="hôtel"?"Hôtel":"Pro"} color={priv?"#FF5A5F":c.property_type==="hôtel"?C.purple:C.blue} bg={priv?"#FFE9EA":c.property_type==="hôtel"?C.purpleL:C.bluePale} size={8}/>
                  {priv&&c.detected_capacity&&<span style={{ fontSize:8, color:C.gray }}>{c.detected_capacity}P{c.detected_rooms?` · ${c.detected_rooms}`:""}</span>}
                </div>
                <div style={{ display:"flex", gap:5, marginTop:1, alignItems:"center", flexWrap:"wrap" }}>
                  <span style={{ fontSize:9, color:C.gray }}>score {c.comparability_score||"?"}/100</span>
                  {sourcesForCompetitor(c).length===0
                    ? <span style={{ fontSize:8, color:C.gray, fontStyle:"italic" }}>Aucune source suivie</span>
                    : sourcesForCompetitor(c).map(s=>(()=>{ const m=sourceBadgeMeta(s.source_type); return <Badge key={s.id} label={s.source_name} color={m.c} bg={m.bg} size={8}/>; })())}
                </div>
                {c.notes&&<p style={{ margin:"1px 0 0", fontSize:9, color:C.gray, fontStyle:"italic" }}>{c.notes}</p>}
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                <button onClick={()=>setSourcesOpenFor(open?null:c.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:10, color:C.blue, padding:2 }}>{open?"▲ Sources":"▼ Sources"}</button>
                <button onClick={()=>openCatForm(c)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:C.blue, padding:2 }}>✎</button>
                <button onClick={()=>handleDeleteCatalogItem(c.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.gray, padding:2 }}>🗑</button>
              </div>
              </div>
              {open&&(
                <div style={{ padding:"0 13px 10px", background:C.grayL }}>
                  <p style={{ ...sml, margin:"6px 0 4px" }}>Sources suivies</p>
                  {compSources.length===0&&<p style={{ margin:"0 0 6px", fontSize:9, color:C.gray, fontStyle:"italic" }}>Aucune source dédiée. Les URLs Booking/Direct du concurrent sont utilisées par défaut.</p>}
                  {compSources.map(s=>(
                    <div key={s.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:6, padding:"4px 0" }}>
                      <div style={{ minWidth:0, flex:1 }}>
                        <span style={{ fontSize:10, fontWeight:600, color:C.text }}>{s.source_name}</span>
                        <p style={{ margin:0, fontSize:8, color:C.gray, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.source_url}</p>
                      </div>
                      <button onClick={()=>handleDeleteSource(s.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:C.gray, flexShrink:0 }}>🗑</button>
                    </div>
                  ))}
                  {sourceForm&&sourceForm.competitor_id===c.id ? (
                    <div style={{ ...cd(9), padding:"8px 10px", marginTop:6 }}>
                      <p style={{ ...sml, margin:"0 0 3px" }}>Famille de source</p>
                      <select value={sourceForm.family} onChange={e=>{ const fam=e.target.value; setSourceForm(f=>{ let st=fam, sn=f.source_name; if(fam==="booking"){st="booking";sn="Booking.com";} else if(fam==="direct"){st="direct";sn="Site direct";} else if(fam==="tour_operator"){st="tour_operator";sn=TOUR_OPERATORS[0];} else if(fam==="marketplace"){st="marketplace";sn=MARKETPLACES[0];} else {st="other";sn="";} return { ...f, family:fam, source_type:st, source_name:sn }; }); }} style={{ ...inp(), marginBottom:5 }}>
                        {SOURCE_FAMILIES.map(t=><option key={t.type} value={t.type}>{t.name}</option>)}
                      </select>
                      {sourceForm.family==="tour_operator"&&(<>
                        <p style={{ ...sml, margin:"0 0 3px" }}>Tour opérateur</p>
                        <select value={TOUR_OPERATORS.includes(sourceForm.source_name)?sourceForm.source_name:"Autre tour opérateur"} onChange={e=>setSourceForm(f=>({ ...f, source_name:e.target.value==="Autre tour opérateur"?"":e.target.value, _toOther:e.target.value==="Autre tour opérateur" }))} style={{ ...inp(), marginBottom:5 }}>
                          {TOUR_OPERATORS.map(o=><option key={o} value={o}>{o}</option>)}
                        </select>
                        {(sourceForm._toOther||!TOUR_OPERATORS.includes(sourceForm.source_name))&&<input style={{ ...inp(), marginBottom:5 }} placeholder="Nom du tour opérateur" value={sourceForm.source_name||""} onChange={e=>setSourceForm(f=>({ ...f, source_name:e.target.value }))}/>}
                      </>)}
                      {sourceForm.family==="marketplace"&&(<>
                        <p style={{ ...sml, margin:"0 0 3px" }}>Marketplace / OTA</p>
                        <select value={MARKETPLACES.includes(sourceForm.source_name)?sourceForm.source_name:MARKETPLACES[0]} onChange={e=>setSourceForm(f=>({ ...f, source_name:e.target.value }))} style={{ ...inp(), marginBottom:5 }}>
                          {MARKETPLACES.map(o=><option key={o} value={o}>{o}</option>)}
                        </select>
                      </>)}
                      {sourceForm.family==="other"&&(
                        <input style={{ ...inp(), marginBottom:5 }} placeholder="Nom de la source (ex : Vente privée, Office tourisme)" value={sourceForm.source_name||""} onChange={e=>setSourceForm(f=>({ ...f, source_name:e.target.value }))}/>
                      )}
                      <input style={{ ...inp(), marginBottom:5 }} placeholder="URL de la fiche" value={sourceForm.source_url} onChange={e=>setSourceForm(f=>({ ...f, source_url:e.target.value }))}/>
                      <input style={{ ...inp(), marginBottom:5 }} placeholder="Notes (optionnel)" value={sourceForm.notes||""} onChange={e=>setSourceForm(f=>({ ...f, notes:e.target.value }))}/>
                      {sourceForm.error&&<p style={{ margin:"0 0 5px", fontSize:9, color:C.red }}>✗ {sourceForm.error}</p>}
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
                        <button onClick={()=>setSourceForm(null)} style={{ ...btn(false,C.grayL,C.text), margin:0 }}>Annuler</button>
                        <button onClick={handleSaveSource} style={{ ...btn(false,C.blue), margin:0 }}>Enregistrer source</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:4 }}>
                      {(priv
                        ? [["marketplace","marketplace","Booking particulier","+ Booking part."],["marketplace","marketplace","Airbnb","+ Airbnb"],["marketplace","marketplace","Abritel","+ Abritel"],["marketplace","marketplace","PAP vacances","+ PAP"],["other","other","","+ Autre"]]
                        : [["booking","booking","Booking.com","+ Booking"],["direct","direct","Site direct","+ Direct"],["tour_operator","tour_operator",TOUR_OPERATORS[0],"+ TO"],["marketplace","marketplace",MARKETPLACES[0],"+ OTA"],["other","other","","+ Autre"]]
                      ).map(([fam,st,sn,lbl],bi)=>(
                        <button key={bi} onClick={()=>setSourceForm({ competitor_id:c.id, family:fam, source_type:st, source_name:sn, source_url:"", notes:"" })} style={{ fontSize:9, fontWeight:600, color:C.blue, background:C.bluePale, border:"none", borderRadius:6, padding:"5px 8px", cursor:"pointer" }}>{lbl}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            );
    };
    const prosList = (catalog||[]).filter(c=>!isPrivateCompetitor(c));
    const privList = (catalog||[]).filter(c=>isPrivateCompetitor(c));
    const proSourcesCount = (sources||[]).filter(s=>{ const c=catalog.find(x=>x.id===s.competitor_id); return c&&!isPrivateCompetitor(c); }).length;
    const privSourcesCount = (sources||[]).filter(s=>{ const c=catalog.find(x=>x.id===s.competitor_id); return c&&isPrivateCompetitor(c); }).length;
    // Résumé tarifs Les Cimes
    const dashPeriod = ALL_PERIODS.find(p=>p.id===dashOurPeriodId);
    const dashNights = dashPeriod?.stay_nights || 7;
    const dashPriceNight = dashOurPrice ? Math.round((parseFloat(dashOurPrice)||0)/dashNights) : 0;
    // Liste filtrée
    const yearOf = r => { const d=r.period_start||""; return d.slice(0,4); };
    const listFiltered = (ourRates||[])
      .filter(r=>r.is_active!==false)
      .filter(r=>!dashListFilter.year || yearOf(r)===String(dashListFilter.year))
      .filter(r=>!dashListFilter.cap || Number(r.capacity)===dashListFilter.cap)
      .filter(r=>!dashListFilter.nights || Number(r.stay_nights||7)===dashListFilter.nights)
      .sort((a,b)=>(b.period_start||"").localeCompare(a.period_start||""));

    // ── Pilotage : contexte issu des filtres globaux ──
    const dfPeriod = ALL_PERIODS.find(p=>p.id===dashFilters.periodId) || ALL_PERIODS.find(p=>p.season===dashFilters.season) || ALL_PERIODS[0];
    const dfAcc = ACCOMMODATION_TYPES[dashFilters.accType] || ACCOMMODATION_TYPES["2P6"];
    const dfNights = Number(dashFilters.nights||7);
    const dfCheckin = dfPeriod?.period_start || dfPeriod?.week_start;
    const dfCheckout = dfNights===7 ? (dfPeriod?.period_end || addDaysStr(dfCheckin,7)) : (dfCheckin?addDaysStr(dfCheckin,dfNights):"");
    const dfCap = Number(dashFilters.capacity||dfAcc.capacity);
    const dfCtx = { periodId:dfPeriod?.id, checkin:dfCheckin, checkout:dfCheckout, stayNights:dfNights, capacity:dfCap };
    // Tarif Les Cimes (semaine → court séjour si <7)
    const dfWeekly = getOurRateForContext(ourRates, { ...dfCtx, checkout: dfCheckin?addDaysStr(dfCheckin,7):dfCheckout, stayNights:7 }, dashFilters.accType);
    const dfWeeklyPrice = dfWeekly ? Number(dfWeekly.price_total||dfWeekly.price_week||dfWeekly.price||0) : 0;
    const dfSSRule = findShortStayRule(shortStayRules, dashFilters.accType, dashFilters.season, dfNights);
    const dfOurPrice = dfNights===7 ? dfWeeklyPrice : (dfWeeklyPrice?calcShortStayOurPrice({ weeklyPrice:dfWeeklyPrice, stayNights:dfNights, rule:dfSSRule }):0);
    const dfOurNight = dfOurPrice ? Math.round(dfOurPrice/dfNights) : 0;
    const dfOurSource = dfWeekly ? "Supabase" : "Grille interne";
    // Marché pro / particuliers (par dates + durée + capacité)
    const matchCtx = r => String(r.period_start||"")===String(dfCheckin||"") && String(r.period_end||"")===String(dfCheckout||"") && Number(r.stay_nights||7)===dfNights && Number(r.capacity)===dfCap;
    const dfProRates = (histAll||[]).filter(r=>!r.is_example && TRUSTED_STATUSES.includes(r.reliability_status||"à vérifier") && matchCtx(r) && r.market_segment!=="private" && r.is_private_rental!==true);
    const dfPrivRates = (histAll||[]).filter(r=>!r.is_example && TRUSTED_STATUSES.includes(r.reliability_status||"à vérifier") && matchCtx(r) && (r.market_segment==="private"||r.is_private_rental===true));
    const dfProMedian = median(dfProRates.map(r=>Number(r.price_total||r.price_week||r.price||0)).filter(Boolean));
    const dfPrivMedian = median(dfPrivRates.map(r=>Number(r.price_total||r.price_week||r.price||0)).filter(Boolean));
    const dfProGap = (dfOurPrice&&dfProMedian) ? Math.round(((dfOurPrice-dfProMedian)/dfProMedian)*100) : null;
    const dfPrivGap = (dfOurPrice&&dfPrivMedian) ? Math.round(((dfOurPrice-dfPrivMedian)/dfPrivMedian)*100) : null;
    // Pression marché : combine écart pro (sous le marché = opportunité) et particuliers
    const dfPressure = (dfProGap==null&&dfPrivGap==null) ? "indéterminée"
      : ((dfPrivGap!=null&&dfPrivGap>30)||(dfProGap!=null&&dfProGap<-15)) ? "élevée"
      : ((dfPrivGap!=null&&dfPrivGap>=15)||(dfProGap!=null&&dfProGap<-5)) ? "moyenne" : "faible";
    // Opportunité promo : score simple /100 (marché pro au-dessus de notre tarif = opportunité)
    let dfPromoScore = 0;
    if (dfProMedian && dfOurPrice) { const adv = (dfProMedian - dfOurPrice)/dfProMedian; dfPromoScore = Math.max(0, Math.min(100, Math.round(50 + adv*200))); }
    else if (dfProRates.length<3) dfPromoScore = 0;
    const dfPromoLabel = dfPromoScore>=66 ? "Bonne" : dfPromoScore>=40 ? "Moyenne" : dfProRates.length<3 ? "Données insuff." : "Faible";

    return (
    <div><SBar title="Dashboard"/>
      {/* Filtres globaux */}
      {!isMobile&&(
        <div style={{ display:"flex", gap:8, alignItems:"flex-end", flexWrap:"wrap", padding:"12px 18px 0" }}>
          {[
            ["Saison","season",[["ete","☀️ Été 2026"],["hiver","❄️ Hiver 2026/2027"]]],
            ["Durée","nights",[[2,"2 nuits"],[3,"3 nuits"],[4,"4 nuits"],[7,"7 nuits"]]],
          ].map(([lbl,key,opts])=>(
            <div key={key} style={{ flex:"1 1 150px" }}>
              <p style={{ margin:"0 0 3px 2px", fontSize:9, fontWeight:600, color:C.gray }}>{lbl}</p>
              <select value={dashFilters[key]} onChange={e=>setDashFilters(f=>({ ...f, [key]:key==="nights"?Number(e.target.value):e.target.value }))} style={{ ...inp(), fontSize:12, padding:"8px 9px" }}>
                {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ))}
          <div style={{ flex:"1 1 200px" }}>
            <p style={{ margin:"0 0 3px 2px", fontSize:9, fontWeight:600, color:C.gray }}>Période</p>
            <select value={dashFilters.periodId} onChange={e=>setDashFilters(f=>({ ...f, periodId:e.target.value }))} style={{ ...inp(), fontSize:12, padding:"8px 9px" }}>
              {ALL_PERIODS.filter(p=>p.season===dashFilters.season&&Number(p.stay_nights||7)===7).map(p=><option key={p.id} value={p.id}>{periodOptionLabel(p)}</option>)}
            </select>
          </div>
          <div style={{ flex:"1 1 110px" }}>
            <p style={{ margin:"0 0 3px 2px", fontSize:9, fontWeight:600, color:C.gray }}>Capacité</p>
            <select value={dashFilters.capacity} onChange={e=>setDashFilters(f=>({ ...f, capacity:Number(e.target.value) }))} style={{ ...inp(), fontSize:12, padding:"8px 9px" }}>
              {[2,4,6,8].map(n=><option key={n} value={n}>{n}P</option>)}
            </select>
          </div>
          <div style={{ flex:"1 1 130px" }}>
            <p style={{ margin:"0 0 3px 2px", fontSize:9, fontWeight:600, color:C.gray }}>Typologie</p>
            <select value={dashFilters.accType} onChange={e=>setDashFilters(f=>({ ...f, accType:e.target.value, capacity:ACCOMMODATION_TYPES[e.target.value]?.capacity||f.capacity }))} style={{ ...inp(), fontSize:12, padding:"8px 9px" }}>
              {Object.entries(ACCOMMODATION_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <button onClick={resetDashFilters} style={{ fontSize:11, fontWeight:600, color:C.gray, background:C.white, border:`1px solid ${C.grayM}`, borderRadius:9, padding:"9px 12px", cursor:"pointer", whiteSpace:"nowrap" }}>↻ Réinitialiser</button>
        </div>
      )}

      {/* Ligne KPI */}
      {!isMobile&&(
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr) auto", gap:10, padding:"12px 18px 0", alignItems:"stretch" }}>
          {[
            { ic:"⛰", c:C.blue, bg:C.bluePale, t:"Tarif Les Cimes", v:dfOurPrice?`${fmt(dfOurNight)}€`:"—", s:dfOurPrice?`${fmt(dfOurPrice)}€ / ${dfNights}n · ${dfOurSource}`:"Données insuffisantes", nav:"tarifs" },
            { ic:"🏢", c:C.blue, bg:C.bluePale, t:"Médiane pros", v:dfProMedian?`${fmt(dfProMedian)}€`:"—", s:dfProRates.length?`${dfProRates.length} relevés`:"Données insuffisantes", nav:"benchmark" },
            { ic:"🏠", c:"#7C3AED", bg:"#F1E9FF", t:"Médiane particuliers", v:dfPrivMedian?`${fmt(dfPrivMedian)}€`:"—", s:dfPrivRates.length?`${dfPrivRates.length} relevés`:"Données insuffisantes", nav:"benchmark" },
            { ic:"📈", c:dfPressure==="élevée"?C.red:dfPressure==="moyenne"?C.orange:C.green, bg:dfPressure==="élevée"?C.redL:dfPressure==="moyenne"?C.orangeL:C.greenL, t:"Pression marché", v:dfPressure, s:dfPrivGap!=null?`écart part. ${dfPrivGap>0?"+":""}${dfPrivGap}%`:"—", nav:"benchmark" },
            { ic:"🎯", c:C.green, bg:C.greenL, t:"Opportunité promo", v:dfPromoLabel, s:dfPromoScore?`Score ${dfPromoScore}/100`:"Données insuffisantes", nav:"promotions" },
          ].map((k,i)=>(
            <button key={i} onClick={()=>setScreen(k.nav)} style={{ ...card({ padding:"12px 13px" }), cursor:"pointer", textAlign:"left", display:"block" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                <div style={{ width:30, height:30, borderRadius:9, background:k.bg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><span style={{ fontSize:15 }}>{k.ic}</span></div>
                <span style={{ fontSize:9, fontWeight:600, color:C.gray, lineHeight:1.1 }}>{k.t}</span>
              </div>
              <p style={{ margin:0, fontSize:19, fontWeight:700, color:k.c, lineHeight:1.1 }}>{k.v}</p>
              <p style={{ margin:"2px 0 0", fontSize:8, color:C.gray }}>{k.s}</p>
            </button>
          ))}
          <button onClick={()=>setScreen("benchmark")} style={{ ...card({ padding:"12px 14px" }), background:C.blue, border:"none", cursor:"pointer", display:"flex", flexDirection:"column", justifyContent:"center", minWidth:130 }}>
            <span style={{ fontSize:12, fontWeight:700, color:C.white, textAlign:"left", lineHeight:1.25 }}>Ouvrir Benchmark & décisions →</span>
          </button>
        </div>
      )}

      {/* Décisions commerciales */}
      {!isMobile&&(
        <div style={{ padding:"14px 18px 0" }}>
          {sectionTitle("🔥 Actions prioritaires")}
          {(()=>{
            const actions=[];
            if (dfProRates.length<3) actions.push({ ic:"💶", c:C.purple, bg:C.purpleL, t:"Relever les prix concurrents", d:`Moins de 3 relevés pros pour ${dfPeriod?periodOptionLabel(dfPeriod):"cette période"}.`, btn:"Faire le relevé", go:()=>setScreen("track") });
            if (dfPrivGap!=null&&dfPrivGap>15) actions.push({ ic:"🏠", c:C.orange, bg:C.orangeL, t:"Vérifier les particuliers", d:`Pression particuliers ${dfPrivGap>30?"forte":"moyenne"} (${dfPrivGap>0?"+":""}${dfPrivGap}%).`, btn:"Voir particuliers", go:()=>setScreen("competitors_private") });
            if (dfProGap!=null&&dfProGap<-5) actions.push({ ic:"⬇️", c:C.red, bg:C.redL, t:"Ajuster le tarif", d:`Le marché pro est ${Math.abs(dfProGap)}% au-dessus de votre tarif.`, btn:"Ouvrir Benchmark", go:()=>setScreen("benchmark") });
            if (dfPromoScore>=40) actions.push({ ic:"🎯", c:C.green, bg:C.greenL, t:"Créer une promo court séjour", d:`Opportunité promo ${dfPromoLabel.toLowerCase()} sur cette période.`, btn:"Créer promo", go:()=>{ setPromoStayNights(3); setScreen("promotions"); } });
            if (!dfWeeklyPrice) actions.push({ ic:"📝", c:C.blue, bg:C.bluePale, t:"Compléter les tarifs", d:`Aucun tarif semaine ${dfAcc.label} pour cette période.`, btn:"Gérer les tarifs", go:()=>setScreen("tarifs") });
            if (dfPrivRates.length===0&&privList.length>0) actions.push({ ic:"🔎", c:C.purple, bg:C.purpleL, t:"Relever les particuliers", d:"Des particuliers sont suivis mais sans relevé sur cette période.", btn:"Faire le relevé", go:()=>setScreen("track") });
            const shown = actions.filter(a=>!dismissedActions.includes(a.t)).slice(0,6);
            if (!shown.length) return <div style={card()}><p style={{ margin:0, fontSize:11, color:C.green, fontWeight:600 }}>✓ Aucune action urgente. Données à jour pour cette période.</p></div>;
            return (
              <div style={responsiveGrid(3)}>
                {shown.map((a,i)=>(
                  <div key={i} style={card({ background:a.bg, borderColor:"transparent" })}>
                    <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3 }}><span style={{ fontSize:15 }}>{a.ic}</span><span style={{ fontSize:12, fontWeight:700, color:a.c }}>{a.t}</span></div>
                    <p style={{ margin:"0 0 8px", fontSize:10, color:C.text, lineHeight:1.4 }}>{a.d}</p>
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={a.go} style={{ fontSize:10, fontWeight:700, color:C.white, background:a.c, border:"none", borderRadius:8, padding:"6px 11px", cursor:"pointer" }}>{a.btn}</button>
                      <button onClick={()=>setDismissedActions(d=>[...d,a.t])} style={{ fontSize:10, fontWeight:600, color:C.gray, background:"transparent", border:`1px solid ${C.grayM}`, borderRadius:8, padding:"6px 10px", cursor:"pointer" }}>Ignorer</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Décisions commerciales */}
      {!isMobile&&(
        <div style={{ padding:"14px 18px 0" }}>
          {sectionTitle("Décisions commerciales","🧭")}
          <div style={responsiveGrid(3)}>
            <div style={card({ background:C.redL, borderColor:"#F8C9C9" })}>
              <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}><span style={{ fontSize:15 }}>⬇️</span><span style={{ fontSize:12, fontWeight:700, color:C.red }}>Ajuster / baisser tarif</span></div>
              <p style={{ margin:"0 0 8px", fontSize:10, color:C.text, lineHeight:1.4 }}>{dfProGap!=null&&dfProGap<-5?`Le marché pro est ${Math.abs(dfProGap)}% au-dessus de votre tarif. Ajustez pour capter la valeur.`:"Tarif globalement aligné sur le marché pro. Surveillez les évolutions."}</p>
              <button onClick={()=>setScreen("benchmark")} style={{ fontSize:10, fontWeight:700, color:C.white, background:C.red, border:"none", borderRadius:8, padding:"6px 11px", cursor:"pointer" }}>Voir les recommandations</button>
            </div>
            <div style={card({ background:C.bluePale, borderColor:"#C9DCF8" })}>
              <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}><span style={{ fontSize:15 }}>🗓️</span><span style={{ fontSize:12, fontWeight:700, color:C.blue }}>Créer un court séjour</span></div>
              <p style={{ margin:"0 0 8px", fontSize:10, color:C.text, lineHeight:1.4 }}>Les courts séjours peuvent être travaillés sur cette période. Potentiel de remplissage.</p>
              <button onClick={()=>{ setPromoStayNights(3); setScreen("promotions"); }} style={{ fontSize:10, fontWeight:700, color:C.white, background:C.blue, border:"none", borderRadius:8, padding:"6px 11px", cursor:"pointer" }}>Configurer</button>
            </div>
            <div style={card({ background:dfPrivGap!=null&&dfPrivGap>15?"#FFF4E0":C.greenL, borderColor:dfPrivGap!=null&&dfPrivGap>15?"#F5D9A8":"#C9E8D2" })}>
              <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}><span style={{ fontSize:15 }}>👁️</span><span style={{ fontSize:12, fontWeight:700, color:dfPrivGap!=null&&dfPrivGap>15?C.orange:C.green }}>Surveiller les particuliers</span></div>
              <p style={{ margin:"0 0 8px", fontSize:10, color:C.text, lineHeight:1.4 }}>{dfPrivGap!=null&&dfPrivGap>15?"Les particuliers exercent une pression prix. Réponse : offre directe ciblée.":"Les prix particuliers sont stables. Restez attentif à l'évolution."}</p>
              <button onClick={()=>setScreen("competitors_private")} style={{ fontSize:10, fontWeight:700, color:C.white, background:dfPrivGap!=null&&dfPrivGap>15?C.orange:C.green, border:"none", borderRadius:8, padding:"6px 11px", cursor:"pointer" }}>Suivre le marché</button>
            </div>
          </div>
        </div>
      )}

      {isMobile&&(
      <div style={{ background:`linear-gradient(135deg,${C.blue},${C.blueL})`, padding:"10px 16px 16px" }}>
        <p style={{ margin:0, fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.5)", textTransform:"uppercase" }}>Les Cimes du Val d'Allos · Veille tarifaire</p>
        <h1 style={{ margin:"2px 0", fontSize:18, fontWeight:700, color:C.white }}>Benchmark {yr}</h1>
        <p style={{ margin:0, fontSize:11, color:"rgba(255,255,255,0.65)" }}>{user?.email} · {cap} · {STATIC_WEEKS.filter(w=>w.year===yr).length} semaines</p>
      </div>
      )}
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
        {/* Résumé décisions commerciales */}
        <div style={{ ...cd(11), padding:"10px 13px", background:C.bluePale, marginTop:8 }}>
          <p style={{ margin:"0 0 3px", fontSize:11, fontWeight:700, color:C.blue }}>Décisions commerciales</p>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, color:C.orange, fontWeight:600 }}>{decisions.filter(d=>d.decision_status==="à faire").length} à faire</span>
            <span style={{ fontSize:10, color:C.green, fontWeight:600 }}>{decisions.filter(d=>d.decision_status==="appliqué").length} appliquées</span>
          </div>
          {decisions[0]&&<p style={{ margin:"2px 0 0", fontSize:9, color:C.blueL }}>Dernière : {decisions[0].action_label||decisions[0].action_type} · {decisions[0].period_label||decisions[0].period_id} ({(decisions[0].created_at||"").slice(0,10)})</p>}
          <button onClick={()=>setScreen("benchmark")} style={{ ...btn(false,C.blue), marginTop:8, marginBottom:0 }}>Ouvrir Benchmark &amp; décisions</button>
        </div>

        {/* Résumé promotions */}
        <div style={{ ...cd(11), padding:"10px 13px", background:C.purpleL, marginTop:8 }}>
          <p style={{ margin:"0 0 3px", fontSize:11, fontWeight:700, color:C.purple }}>🎯 Promotions & courts séjours</p>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, color:C.orange, fontWeight:600 }}>{promoOpps.filter(o=>o.status==="à étudier").length} à étudier</span>
            <span style={{ fontSize:10, color:C.blue, fontWeight:600 }}>{promoOpps.filter(o=>o.status==="à publier").length} à publier</span>
          </div>
          {(()=>{ const cs=promoOpps.find(o=>o.promo_type==="court_sejour"||o.promo_type==="weekend"); return cs?<p style={{ margin:"2px 0 0", fontSize:9, color:C.purple }}>Prochaine offre : {cs.promo_label} · {cs.period_label||cs.period_id}</p>:null; })()}
          <button onClick={()=>setScreen("promotions")} style={{ ...btn(false,C.purple), marginTop:8, marginBottom:0 }}>Ouvrir Promotions</button>
        </div>

        {/* Résumé courts séjours */}
        <div style={{ ...cd(11), padding:"10px 13px", background:C.orangeL, marginTop:8 }}>
          <p style={{ margin:"0 0 3px", fontSize:11, fontWeight:700, color:C.orange }}>🗓️ Courts séjours</p>
          {(()=>{ const we=promoOpps.find(o=>(o.promo_type==="week_end"||o.promo_type==="weekend")); const cs=promoOpps.find(o=>o.promo_type==="court_sejour"); return (<>
            <p style={{ margin:0, fontSize:9, color:C.text }}>Prochaine offre 2 nuits : {we?`${we.period_label||we.period_id} · ${fmt(Number(we.direct_price||0))}€ direct`:"à étudier"}</p>
            <p style={{ margin:"1px 0 0", fontSize:9, color:C.text }}>Prochaine offre 3 nuits : {cs?`${cs.period_label||cs.period_id} · ${fmt(Number(cs.direct_price||0))}€ direct`:"à étudier"}</p>
          </>); })()}
          {(()=>{ const shortRates=(histAll||[]).filter(r=>[2,3,4].includes(Number(r.stay_nights))); return <p style={{ margin:"2px 0 0", fontSize:8, color:C.gray }}>{shortRates.length===0?"Aucun relevé court séjour pour l'instant — lancez un relevé 2/3/4 nuits.":`${shortRates.length} relevés courts séjours en base.`}</p>; })()}
          <button onClick={()=>{ setPromoStayNights(3); setScreen("promotions"); }} style={{ ...btn(false,C.orange), marginTop:8, marginBottom:0 }}>Ouvrir Promotions courts séjours</button>
        </div>

        <div style={{ ...responsiveGrid(3), marginTop:8 }}>
        <div style={{ ...cd(11), padding:"10px 13px", background:SB_READY?C.greenL:C.goldL, marginBottom:0 }}>
          <p style={{ margin:"0 0 1px", fontSize:11, fontWeight:700, color:SB_READY?C.green:C.gold }}>{SB_READY?"✓ Données persistées en Supabase":"⚠ Mode local — données non persistées"}</p>
          <p style={{ margin:0, fontSize:10, color:SB_READY?C.green:C.gold }}>{SB_READY?"Session restaurée au refresh.":"Configurer VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY."}</p>
        </div>
        <div style={{ ...cd(11), padding:"10px 13px", marginBottom:0, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><p style={{ margin:0, fontSize:13, fontWeight:500, color:C.text }}>Données exemple</p><p style={{ margin:0, fontSize:10, color:C.textS }}>Désactiver en production</p></div>
          <button onClick={()=>setSE(p=>!p)} style={{ width:44, height:26, borderRadius:13, background:showExamples?C.blue:C.grayM, border:"none", cursor:"pointer", position:"relative" }}>
            <div style={{ position:"absolute", top:3, left:showExamples?21:3, width:20, height:20, borderRadius:"50%", background:C.white, transition:"left 0.15s" }}/>
          </button>
        </div>
        <div style={cd(11,0)}>
          {[{ icon:"✏️", l:"Saisir un relevé", s:"collect", m:"manuelle" },{ icon:"📋", l:"Copier-coller Booking/Airbnb", s:"collect", m:"copier-coller" },{ icon:"📥", l:"Importer un CSV", s:"import" },{ icon:"🔬", l:"Diagnostic système", s:"diag" }].map((item,i,arr)=>(
            <div key={i} style={{ ...rw(i===arr.length-1), cursor:"pointer" }} onClick={()=>{ setScreen(item.s); if(item.m) setCM(item.m); }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}><span style={{ fontSize:16 }}>{item.icon}</span><span style={{ fontSize:13, fontWeight:500, color:C.text }}>{item.l}</span></div>
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={C.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          ))}
        </div>
        </div>

        {/* Carte synthétique tarifs Les Cimes */}
        {sectionTitle("Tarifs Les Cimes","💰")}
        <div style={card({ marginBottom:12 })}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, flexWrap:"wrap" }}>
            <div>
              <p style={{ margin:0, fontSize:20, fontWeight:700, color:C.blue }}>{(ourRates||[]).filter(r=>r.is_active!==false).length}<span style={{ fontSize:10, color:C.gray, fontWeight:400 }}> tarifs enregistrés</span></p>
              <p style={{ margin:"2px 0 0", fontSize:10, color:C.gray }}>Période courante : {dfPeriod?periodOptionLabel(dfPeriod):"—"}</p>
              {dfOurPrice>0&&<p style={{ margin:"1px 0 0", fontSize:11, color:C.text, fontWeight:600 }}>{dfAcc.label} · {fmt(dfOurPrice)}€ / {dfNights}n · {fmt(dfOurNight)}€/nuit · {dfOurSource}</p>}
            </div>
            <button onClick={()=>setScreen("tarifs")} style={{ ...btn(false,C.blue), width:"auto", padding:"9px 16px", margin:0 }}>Gérer les tarifs →</button>
          </div>
        </div>


        {sectionTitle("Concurrents suivis","🏨")}
        <div style={responsiveGrid(2)}>
          <div style={card()}>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:5 }}><span style={{ fontSize:15 }}>🏢</span><span style={{ fontSize:13, fontWeight:700, color:C.blue }}>Résidences / Pros</span></div>
            <p style={{ margin:0, fontSize:20, fontWeight:700, color:C.text }}>{prosList.length}<span style={{ fontSize:10, color:C.gray, fontWeight:400 }}> concurrents</span></p>
            <p style={{ margin:"1px 0 0", fontSize:10, color:C.gray }}>{proSourcesCount} sources actives</p>
            <button onClick={()=>setScreen("competitors_residence")} style={{ ...btn(false,C.blue), marginTop:8, marginBottom:0 }}>Gérer les résidences</button>
          </div>
          <div style={card({ background:"#FFF7F7" })}>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:5 }}><span style={{ fontSize:15 }}>🏠</span><span style={{ fontSize:13, fontWeight:700, color:"#FF5A5F" }}>Particuliers</span></div>
            <p style={{ margin:0, fontSize:20, fontWeight:700, color:C.text }}>{privList.length}<span style={{ fontSize:10, color:C.gray, fontWeight:400 }}> concurrents</span></p>
            <p style={{ margin:"1px 0 0", fontSize:10, color:C.gray }}>{privSourcesCount} sources actives{dfPrivGap!=null?` · pression ${dfPrivGap>30?"forte":dfPrivGap>=15?"moyenne":"faible"}`:""}</p>
            <button onClick={()=>setScreen("competitors_private")} style={{ ...btn(false,"#FF5A5F"), marginTop:8, marginBottom:0 }}>Gérer les particuliers</button>
          </div>
        </div>


        {/* Import CSV concurrents + sources (replié) */}
        <details style={{ ...cd(11), padding:"10px 13px" }}>
          <summary style={{ fontSize:11, fontWeight:700, color:C.blue, cursor:"pointer" }}>Import CSV concurrents & sources</summary>
          <div style={{ marginTop:8 }}>
          <p style={{ margin:"0 0 4px", fontSize:11, fontWeight:700, color:C.blue }}>Importer concurrents suivis (CSV)</p>
          <p style={{ margin:"0 0 6px", fontSize:9, color:C.gray, fontFamily:"monospace", lineHeight:1.5 }}>name;market_segment;property_type;source_type;source_name;source_url;search_location;comparability_score;notes</p>
          {catCsvResult&&(
            <div style={{ ...cd(8), padding:"8px 10px", background:catCsvResult.errors.length===0?C.greenL:C.goldL, marginBottom:6 }}>
              <p style={{ margin:"0 0 1px", fontSize:11, color:C.green }}>✓ Importés : {catCsvResult.ok}</p>
              <p style={{ margin:"0 0 1px", fontSize:11, color:C.gray }}>⊝ Ignorés : {catCsvResult.skipped}</p>
              {catCsvResult.errors.map((e,i)=><p key={i} style={{ margin:0, fontSize:10, color:C.red }}>✗ {e}</p>)}
            </div>
          )}
          <textarea value={catCsvText} onChange={e=>setCatCsvText(e.target.value)} placeholder={"Résidence Les Chalets du Verdon;residence;résidence;booking;Booking.com;https://www.booking.com/...;La Foux d'Allos;88;Concurrent direct"} style={{ width:"100%", minHeight:70, padding:"8px", fontSize:10, fontFamily:"monospace", border:`1px solid ${C.grayM}`, borderRadius:9, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10 }}>
            <button onClick={()=>{ const tpl=["name;market_segment;property_type;source_type;source_name;source_url;search_location;comparability_score;notes","Résidence Labellemontagne;residence;résidence;booking;Booking.com;https://www.booking.com/...;La Foux d'Allos;80;Concurrent pro","Appartement Central Park particulier;private;particulier;marketplace;Booking particulier;https://www.booking.com/...;La Foux d'Allos;60;Particulier agressif","Studio La Foux Airbnb;private;particulier;marketplace;Airbnb;https://www.airbnb.fr/...;La Foux d'Allos;55;Particulier"].join("\n"); const b=new Blob([tpl],{ type:"text/csv;charset=utf-8" }); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download="modele_concurrents_suivis.csv"; a.click(); }} style={{ ...btn(false,C.grayL,C.blueL), margin:0, border:`1px solid ${C.blueL}` }}>⬇ Modèle CSV</button>
            <button onClick={handleImportCatalogCsv} disabled={!catCsvText.trim()} style={{ ...btn(!catCsvText.trim(),C.blue), margin:0 }}>Importer concurrents suivis</button>
          </div>
          <p style={{ margin:"6px 0", fontSize:9, color:C.gray }}>Sources : competitor_name;source_type;source_name;source_url;notes</p>
          {srcCsvResult&&(
            <div style={{ ...cd(8), padding:"7px 10px", background:C.grayL, marginBottom:6 }}>
              <p style={{ margin:"0 0 1px", fontSize:11, color:C.green }}>✓ Ajoutées : {srcCsvResult.added}</p>
              <p style={{ margin:"0 0 1px", fontSize:11, color:C.gray }}>⊝ Ignorées : {srcCsvResult.skipped}</p>
              {(srcCsvResult.errors||[]).map((e,i)=><p key={i} style={{ margin:0, fontSize:10, color:C.red }}>✗ {e}</p>)}
            </div>
          )}
          <textarea value={srcCsvText} onChange={e=>setSrcCsvText(e.target.value)} placeholder={"Résidence Les Chalets du Verdon;tour_operator;La France du Nord au Sud;https://www.lafrancedunordausud.fr/...;Fiche TO"} style={{ width:"100%", minHeight:60, padding:"8px", fontSize:10, fontFamily:"monospace", border:`1px solid ${C.grayM}`, borderRadius:9, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            <button onClick={()=>{ const tpl=["competitor_name;source_type;source_name;source_url;notes","Résidence Les Chalets du Verdon;tour_operator;La France du Nord au Sud;https://www.lafrancedunordausud.fr/...;Fiche TO","Résidence Les Chalets du Verdon;tour_operator;Maeva;https://www.maeva.com/...;Fiche Maeva"].join("\n"); const b=new Blob([tpl],{ type:"text/csv;charset=utf-8" }); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download="modele_sources.csv"; a.click(); }} style={{ ...btn(false,C.grayL,C.blueL), margin:0, border:`1px solid ${C.blueL}` }}>⬇ Modèle CSV</button>
            <button onClick={handleImportSourcesCsv} disabled={!srcCsvText.trim()} style={{ ...btn(!srcCsvText.trim(),C.blue), margin:0 }}>Importer les sources</button>
          </div>
          </div>
        </details>

        {/* Relevé rapide concurrents suivis (période + capacité courantes) */}
        {catalog.length>0&&(()=>{
          const ctx = getTrackedPeriodContext();
          const datesInvalid = !ctx.checkin || !ctx.checkout || !ctx.stayNights || ctx.stayNights <= 0;
          const ctxValid = !datesInvalid;
          // Dernier prix enregistré par concurrent + source (depuis rates chargés)
          const lastRateFor = (name, sourceLabel) => {
            const matches = (rates||[]).filter(r=>
              !r.is_example &&
              (r.competitor===name||r.property_name===name||r.competitor_name===name) &&
              (r.source===sourceLabel || r.source_label===sourceLabel) &&
              String(r.period_start||"")===String(ctx.checkin||"") &&
              String(r.period_end||"")===String(ctx.checkout||"") &&
              Number(r.stay_nights||7)===Number(ctx.stayNights) &&
              Number(r.capacity)===Number(ctx.capacity) &&
              TRUSTED_STATUSES.includes(r.reliability_status||"validé")
            );
            if (!matches.length) return null;
            return matches.slice().sort((a,b)=>String(b.collected_at).localeCompare(String(a.collected_at)))[0];
          };
          const allBookingUrls = catalog.filter(c=>c.booking_url).map(c=>buildTrackedBookingUrl(c, ctx));
          const allDirectUrls = catalog.filter(c=>buildTrackedDirectUrl(c)).map(c=>buildTrackedDirectUrl(c));
          return (
            <details style={{ ...cd(11), padding:"10px 13px", marginTop:8 }}>
              <summary style={{ fontSize:11, fontWeight:700, color:C.blue, cursor:"pointer" }}>🔍 Relevé concurrents suivis (saisie rapide)</summary>
              <p style={{ margin:"6px 0 8px", fontSize:8, color:C.gray, fontStyle:"italic" }}>Corriger modifie le relevé existant. Nouveau relevé ajoute une nouvelle ligne dans l'historique.</p>

              {/* Sélection de la période du relevé */}
              <div style={{ ...cd(11,4), padding:"10px 12px" }}>
                <p style={{ margin:"0 0 6px", fontSize:11, fontWeight:700, color:C.blue }}>Période du relevé</p>
                <div style={{ display:"flex", gap:4, marginBottom:8 }}>
                  {[["period","Période 7 nuits"],["custom","Dates personnalisées"]].map(([v,l])=>(
                    <button key={v} onClick={()=>setTrackedMode(v)} style={{ flex:1, padding:"6px 4px", fontSize:10, fontWeight:trackedMode===v?700:400, background:trackedMode===v?C.blue:C.white, color:trackedMode===v?C.white:C.text, border:`1px solid ${trackedMode===v?C.blue:C.grayM}`, borderRadius:8, cursor:"pointer" }}>{l}</button>
                  ))}
                </div>

                {trackedMode==="period" ? (<>
                  <div style={formGrid}>
                    <div>
                      <p style={{ ...sml, margin:"0 0 4px" }}>Saison</p>
                      <select value={trackedSeason} onChange={e=>setTrackedSeason(e.target.value)} style={inp()}>
                        <option value="ete">Été</option>
                        <option value="hiver">Hiver</option>
                        <option value="all">Toutes</option>
                      </select>
                    </div>
                    <div>
                      <p style={{ ...sml, margin:"0 0 4px" }}>Durée</p>
                      <select value={trackedStayNights} onChange={e=>setTrackedStayNights(Number(e.target.value))} style={inp()}>
                        <option value={7}>7 nuits</option>
                        <option value={2}>2 nuits</option>
                        <option value={3}>3 nuits</option>
                        <option value={4}>4 nuits</option>
                      </select>
                    </div>
                  </div>
                  <p style={{ ...sml, margin:"8px 0 4px" }}>Période</p>
                  <select value={trackedPeriodId} onChange={e=>setTrackedPeriodId(e.target.value)} style={inp()}>
                    {trackedAvailablePeriods.length===0&&<option value="">Aucune période</option>}
                    {trackedAvailablePeriods.map(p=><option key={p.id} value={p.id}>{periodOptionLabel(p)}</option>)}
                  </select>
                </>) : (
                  <div style={formGrid}>
                    <div>
                      <p style={{ ...sml, margin:"0 0 4px" }}>Date d'arrivée</p>
                      <input type="date" value={trackedCheckin} onChange={e=>setTrackedCheckin(e.target.value)} style={inp()}/>
                    </div>
                    <div>
                      <p style={{ ...sml, margin:"0 0 4px" }}>Date de départ</p>
                      <input type="date" value={trackedCheckout} onChange={e=>setTrackedCheckout(e.target.value)} style={inp()}/>
                    </div>
                  </div>
                )}

                <p style={{ ...sml, margin:"8px 0 4px" }}>Capacité</p>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4 }}>
                  {[2,4,6,8].map(n=><button key={n} onClick={()=>setTrackedCapacity(n)} style={{ padding:"6px 0", background:Number(trackedCapacity)===n?C.blue:C.grayL, border:"none", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:Number(trackedCapacity)===n?700:400, color:Number(trackedCapacity)===n?C.white:C.text }}>{n}P</button>)}
                </div>
              </div>

              {/* Récapitulatif contexte */}
              <div style={{ ...cd(11,4), padding:"9px 12px", background:ctxValid?C.bluePale:C.redL }}>
                {ctxValid ? (<>
                  <p style={{ margin:0, fontSize:11, color:C.blue, fontWeight:700 }}>Période : {fmtDateShort(ctx.checkin)} → {fmtDateShort(ctx.checkout)} · {ctx.stayNights} nuits</p>
                  <p style={{ margin:"1px 0 0", fontSize:9, color:C.blueL }}>Capacité : {ctx.capacity}P · Mode : {trackSegment==="private"?"Particuliers suivis":"Résidences suivies"}</p>
                  {(()=>{ const fams=Array.from(new Set((catalog||[]).filter(c=>competitorSegment(c)===trackSegment).flatMap(c=>sourcesForCompetitor(c).map(s=>sourceBadgeMeta(s.source_type).l)))); return fams.length>0?<p style={{ margin:"1px 0 0", fontSize:9, color:C.blueL }}>Sources : {fams.join(" · ")}</p>:null; })()}
                </>) : (
                  <p style={{ margin:0, fontSize:11, color:C.red, fontWeight:600 }}>Dates invalides : vérifiez arrivée et départ.</p>
                )}
                <p style={{ margin:"4px 0 0", fontSize:9, color:C.gray, fontStyle:"italic" }}>Les prix saisis ici sont considérés comme vérifiés manuellement.</p>
                {/* Liste de liens cliquables (évite le blocage multi-onglets) */}
                {trackedLinksVisible&&!datesInvalid&&(
                  <div style={{ marginTop:8, borderTop:`0.5px solid ${C.grayM}`, paddingTop:8 }}>
                    {allBookingUrls.length>0&&(<>
                      <p style={{ margin:"0 0 4px", fontSize:9, fontWeight:700, color:C.blue, textTransform:"uppercase" }}>Liens Booking à ouvrir</p>
                      {catalog.filter(c=>c.booking_url).map((c,idx)=>(
                        <div key={c.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, padding:"4px 0" }}>
                          <span style={{ fontSize:10, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{idx+1}. {c.name}</span>
                          <a href={buildTrackedBookingUrl(c, ctx)} target="_blank" rel="noreferrer" style={{ fontSize:9, fontWeight:600, color:C.blue, background:C.bluePale, padding:"3px 9px", borderRadius:6, textDecoration:"none", flexShrink:0 }}>Ouvrir ↗</a>
                        </div>
                      ))}
                    </>)}
                    {allDirectUrls.length>0&&(<>
                      <p style={{ margin:"8px 0 4px", fontSize:9, fontWeight:700, color:C.green, textTransform:"uppercase" }}>Liens site direct à ouvrir</p>
                      {catalog.filter(c=>buildTrackedDirectUrl(c)).map((c,idx)=>(
                        <div key={c.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, padding:"4px 0" }}>
                          <span style={{ fontSize:10, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{idx+1}. {c.name}</span>
                          <a href={buildTrackedDirectUrl(c)} target="_blank" rel="noreferrer" style={{ fontSize:9, fontWeight:600, color:C.green, background:C.greenL, padding:"3px 9px", borderRadius:6, textDecoration:"none", flexShrink:0 }}>Ouvrir ↗</a>
                        </div>
                      ))}
                    </>)}
                  </div>
                )}
              </div>

              {/* Sélecteur de segment marché */}
              <div style={{ display:"flex", gap:5, marginBottom:6 }}>
                {[["residence","🏢 Résidences / Pros"],["private","🏠 Particuliers"]].map(([seg,l])=>(
                  <button key={seg} onClick={()=>setTrackSegment(seg)} style={{ flex:1, padding:"7px 4px", fontSize:10, fontWeight:trackSegment===seg?700:400, background:trackSegment===seg?(seg==="private"?"#FF5A5F":C.blue):C.grayL, color:trackSegment===seg?C.white:C.text, border:"none", borderRadius:8, cursor:"pointer" }}>{l}</button>
                ))}
              </div>

              {/* Barre d'action compacte */}
              <div style={{ display:"flex", gap:5, marginBottom:5, flexWrap:"wrap", alignItems:"center" }}>
                <button onClick={()=>scrapeTrackedRates(trackSegment)} disabled={trackedScraping||datesInvalid} style={{ flex:"1 1 200px", padding:"8px 12px", fontSize:11, fontWeight:700, background:(trackedScraping||datesInvalid)?C.grayL:(trackSegment==="private"?"#FF5A5F":C.purple), color:(trackedScraping||datesInvalid)?C.gray:C.white, border:"none", borderRadius:9, cursor:(trackedScraping||datesInvalid)?"default":"pointer" }}>{trackedScraping?"⏳ Scraping…":trackSegment==="private"?"🤖 Scraper les particuliers suivis":"🤖 Scraper les résidences suivies"}</button>
                {allBookingUrls.length>0&&<button onClick={()=>setTrackedLinksVisible(v=>!v)} disabled={datesInvalid} style={{ fontSize:10, fontWeight:600, color:datesInvalid?C.gray:C.blue, background:C.white, border:`1px solid ${C.blueL}`, borderRadius:8, padding:"7px 11px", cursor:datesInvalid?"default":"pointer" }}>{trackedLinksVisible?"▲ Masquer":`Ouvrir tous les Booking (${allBookingUrls.length})`}</button>}
                {allBookingUrls.length>1&&!datesInvalid&&<button onClick={()=>openAllLinks(allBookingUrls.slice(0,2))} style={{ fontSize:10, fontWeight:600, color:C.blue, background:C.white, border:`1px solid ${C.blueL}`, borderRadius:8, padding:"7px 11px", cursor:"pointer" }}>Ouvrir les 2 premiers</button>}
              </div>
              <p style={{ margin:"0 0 8px", fontSize:8, color:C.gray, fontStyle:"italic" }}>Le scraping préremplit les prix. Vérifiez toujours avant validation.</p>
              {trackedScrapeError&&<div style={{ ...cd(9), padding:"8px 11px", background:C.goldL, marginBottom:8 }}><p style={{ margin:0, fontSize:10, color:C.orange }}>{trackedScrapeError}</p></div>}
              {trackedScrapeResults.length>0&&(()=>{ const n=trackedScrapeResults.filter(r=>r.price_total&&r.confidence!=="low"&&!r.warning&&r.channel!=="direct"&&!isSuspiciousDetectedPrice(r.price_total,ctx,{source_type:r.channel})).length; return <div style={{ ...cd(9), padding:"8px 11px", background:C.bluePale, marginBottom:8 }}><p style={{ margin:0, fontSize:10, color:C.blue, fontWeight:600 }}>{n} prix détecté(s) automatiquement. Vérifiez avant validation.</p></div>; })()}

              <div style={cd()}>
                {(()=>{ const segList=(catalog||[]).filter(c=>competitorSegment(c)===trackSegment); return segList.length===0
                  ? <div style={{ padding:"12px 13px" }}><p style={{ margin:0, fontSize:10, color:C.gray, fontStyle:"italic" }}>Aucun concurrent {trackSegment==="private"?"particulier":"pro"} suivi.</p></div>
                  : segList.map((c,i)=>{
                  const compSources = sourcesForCompetitor(c);
                  return (
                    <div key={c.id} style={{ padding:"10px 12px", borderBottom:i<segList.length-1?`0.5px solid ${C.grayL}`:"none" }}>
                      {/* En-tête concurrent */}
                      <div style={{ marginBottom:6 }}>
                        <span style={{ fontSize:12, fontWeight:700, color:C.text }}>{c.name}</span>
                        <div style={{ display:"flex", gap:4, marginTop:2, alignItems:"center", flexWrap:"wrap" }}>
                          <span style={{ fontSize:9, color:C.gray }}>{c.property_type} · score {c.comparability_score||"?"}</span>
                          {compSources.map(s=>(()=>{ const m=sourceBadgeMeta(s.source_type); return <Badge key={s.id} label={s.source_name} color={m.c} bg={m.bg} size={8}/>; })())}
                        </div>
                      </div>
                      {compSources.length===0&&<p style={{ margin:"2px 0 0", fontSize:9, color:C.gray, fontStyle:"italic" }}>Aucune source. Ajoutez-en dans « Concurrents suivis ».</p>}

                      {/* En-tête colonnes (desktop) */}
                      {!isMobile&&compSources.length>0&&(
                        <div style={{ display:"grid", gridTemplateColumns:"1.6fr 1.3fr 1.1fr 1fr 1.4fr", gap:6, padding:"0 4px 4px", borderBottom:`0.5px solid ${C.grayL}` }}>
                          {["Source","Dernier prix","Auto détecté","Prix vérifié","Actions"].map(h=><span key={h} style={{ fontSize:8, fontWeight:700, color:C.gray, textTransform:"uppercase" }}>{h}</span>)}
                        </div>
                      )}

                      {compSources.map(s=>{
                        const url = buildSourceUrl(s, c, ctx);
                        const key = `${c.id}_${s.id}`;
                        const st = trackSaved[key];
                        const vp = trackPrices[key]??"";
                        const last = lastRateFor(c.name, s.source_name);
                        const injectsDates = s.source_type==="booking" || isLfdnasSource(s);
                        const scrape = findScrapeResultForSource(c, s);
                        const scrapeSuspicious = scrape?.price_total ? isSuspiciousDetectedPrice(scrape.price_total, ctx, s) : false;
                        const scrapeUsable = scrape?.price_total && !scrapeSuspicious && scrape.confidence!=="low" && !scrape.warning && s.source_type!=="direct" && s.source_type!=="other";
                        const m = sourceBadgeMeta(s.source_type);
                        const editing = rateEditKey===key && (rateEditMode==="modify"||rateEditMode==="new"||rateEditMode==="history");
                        // Cellules réutilisables
                        const cellSource = (
                          <div style={{ minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap" }}>
                              <span style={{ fontSize:10, fontWeight:600, color:C.text }}>{s.source_name}</span>
                              <Badge label={m.l} color={m.c} bg={m.bg} size={7}/>
                            </div>
                            {(injectsDates&&datesInvalid)
                              ? <span style={{ fontSize:8, fontWeight:600, color:C.gray }}>↗ Ouvrir</span>
                              : <a href={url} target="_blank" rel="noreferrer" style={{ fontSize:8, fontWeight:600, color:C.blue, textDecoration:"none" }}>↗ Ouvrir</a>}
                            {isLfdnasSource(s)&&<span style={{ fontSize:7, color:C.purple, fontStyle:"italic", display:"block" }}>Dates ajoutées auto</span>}
                            {s.source_type==="direct"&&<span style={{ fontSize:7, color:C.gray, fontStyle:"italic", display:"block" }}>Dates à vérifier sur le site</span>}
                          </div>
                        );
                        const cellLast = last
                          ? <div><span style={{ fontSize:11, fontWeight:700, color:C.text }}>{fmt(Number(last.price_total||last.price_week))}€</span><span style={{ fontSize:8, color:C.gray, display:"block" }}>{last.reliability_status} · {fmtDateShort(last.period_start)||last.collected_at}{last.edited_at?" · modifié":""}</span></div>
                          : <span style={{ fontSize:9, color:C.gray }}>Aucun prix</span>;
                        const cellAuto = scrape
                          ? (scrapeUsable
                              ? <span style={{ fontSize:9, color:C.orange, fontWeight:600 }}>{fmt(scrape.price_total)}€ à vérifier</span>
                              : scrapeSuspicious
                                ? <span style={{ fontSize:8, color:C.gold }}>{fmt(scrape.price_total)}€ ignoré · suspect</span>
                                : <span style={{ fontSize:8, color:C.gray }}>Non détecté</span>)
                          : <span style={{ fontSize:9, color:C.grayM }}>—</span>;
                        const cellVerif = (
                          <input type="number" placeholder="Prix vérifié" value={vp} onChange={e=>setTrackPrices(p=>({ ...p, [key]:e.target.value }))} style={{ width:"100%", padding:"5px 7px", fontSize:10, border:`1px solid ${C.grayM}`, borderRadius:6, boxSizing:"border-box" }}/>
                        );
                        const cellActions = (
                          <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                            {last ? (<>
                              <button onClick={()=>openRateEdit(key,"new",null)} style={{ fontSize:8, fontWeight:600, color:C.green, background:C.greenL, border:"none", borderRadius:5, padding:"4px 6px", cursor:"pointer" }}>Nouveau</button>
                              <button onClick={()=>openRateEdit(key,"modify",Number(last.price_total||last.price_week))} style={{ fontSize:8, fontWeight:600, color:C.orange, background:C.orangeL, border:"none", borderRadius:5, padding:"4px 6px", cursor:"pointer" }}>Modifier</button>
                              <button onClick={()=>{ openRateEdit(key,"history",null); loadRateHistory(c.name, s.source_name, ctx, "period"); }} style={{ fontSize:8, fontWeight:600, color:C.blue, background:C.bluePale, border:"none", borderRadius:5, padding:"4px 6px", cursor:"pointer" }}>Histo.</button>
                            </>):(<>
                              <button onClick={()=>saveSourceRate(c, s, vp, key)} disabled={!vp||datesInvalid} style={{ fontSize:8, fontWeight:700, background:(vp&&!datesInvalid)?C.green:C.grayL, color:(vp&&!datesInvalid)?C.white:C.gray, border:"none", borderRadius:5, padding:"4px 8px", cursor:(vp&&!datesInvalid)?"pointer":"default" }}>Enregistrer</button>
                              <button onClick={()=>{ openRateEdit(key,"history",null); loadRateHistory(c.name, s.source_name, ctx, "all"); }} style={{ fontSize:8, fontWeight:600, color:C.blue, background:C.bluePale, border:"none", borderRadius:5, padding:"4px 6px", cursor:"pointer" }}>Histo.</button>
                            </>)}
                          </div>
                        );
                        return (
                          <div key={s.id}>
                            {/* Ligne compacte */}
                            {!isMobile ? (
                              <div style={{ display:"grid", gridTemplateColumns:"1.6fr 1.3fr 1.1fr 1fr 1.4fr", gap:6, alignItems:"center", padding:"7px 4px", borderBottom:`0.5px solid ${C.grayL}` }}>
                                {cellSource}{cellLast}{cellAuto}
                                {last?<span style={{ fontSize:8, color:C.grayM }}>—</span>:cellVerif}
                                {cellActions}
                              </div>
                            ) : (
                              <div style={{ ...cd(8), padding:"8px 10px", marginTop:6, background:C.grayL }}>
                                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>{cellSource}{cellLast}</div>
                                <div style={{ marginTop:5 }}>{cellAuto}</div>
                                {!last&&<div style={{ marginTop:5 }}>{cellVerif}</div>}
                                <div style={{ marginTop:6 }}>{cellActions}</div>
                              </div>
                            )}
                            {/* Panneaux d'édition (sous la ligne) */}
                            {rateEditKey===key&&rateEditMode==="modify"&&last&&(
                              <div style={{ ...cd(8), padding:"8px 10px", margin:"4px 0", background:C.orangeL }}>
                                <p style={{ margin:"0 0 4px", fontSize:8, color:C.gray, fontStyle:"italic" }}>Corriger modifie le relevé existant.</p>
                                <input type="number" placeholder="Prix corrigé" value={rateEditPrice} onChange={e=>setRateEditPrice(e.target.value)} style={{ ...inp(), marginBottom:4 }}/>
                                <input placeholder="Raison de la correction" value={rateEditReason} onChange={e=>setRateEditReason(e.target.value)} style={{ ...inp(), marginBottom:4 }}/>
                                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                                  <button onClick={closeRateEdit} style={{ ...btn(false,C.white,C.text), margin:0, fontSize:9, padding:"5px", border:`1px solid ${C.grayM}` }}>Annuler</button>
                                  <button onClick={()=>submitRateCorrection(last)} disabled={!rateEditPrice} style={{ ...btn(!rateEditPrice,C.orange), margin:0, fontSize:9, padding:"5px" }}>Enregistrer correction</button>
                                </div>
                              </div>
                            )}
                            {rateEditKey===key&&rateEditMode==="new"&&(
                              <div style={{ ...cd(8), padding:"8px 10px", margin:"4px 0", background:C.greenL }}>
                                <p style={{ margin:"0 0 4px", fontSize:8, color:C.gray, fontStyle:"italic" }}>Nouveau relevé : ajoute une ligne dans l'historique.</p>
                                <input type="number" placeholder="Prix du nouveau relevé" value={rateEditPrice} onChange={e=>setRateEditPrice(e.target.value)} style={{ ...inp(), marginBottom:4 }}/>
                                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                                  <button onClick={closeRateEdit} style={{ ...btn(false,C.white,C.text), margin:0, fontSize:9, padding:"5px", border:`1px solid ${C.grayM}` }}>Annuler</button>
                                  <button onClick={async()=>{ await saveSourceRate(c, s, rateEditPrice, key); closeRateEdit(); }} disabled={!rateEditPrice||datesInvalid} style={{ ...btn(!rateEditPrice||datesInvalid,C.green), margin:0, fontSize:9, padding:"5px" }}>Enregistrer</button>
                                </div>
                              </div>
                            )}
                            {rateEditKey===key&&rateEditMode==="history"&&(
                              <div style={{ ...cd(8), padding:"8px 10px", margin:"4px 0", background:C.bluePale }}>
                                <div style={{ display:"flex", gap:4, marginBottom:5 }}>
                                  {[["period","Cette période"],["all","Toutes périodes"]].map(([v,l])=>(
                                    <button key={v} onClick={()=>loadRateHistory(c.name, s.source_name, ctx, v)} style={{ fontSize:8, fontWeight:rateHistoryScope===v?700:400, color:rateHistoryScope===v?C.white:C.gray, background:rateHistoryScope===v?C.blue:C.white, border:`1px solid ${rateHistoryScope===v?C.blue:C.grayM}`, borderRadius:5, padding:"3px 7px", cursor:"pointer" }}>{l}</button>
                                  ))}
                                </div>
                                {rateHistoryRows.length===0?<p style={{ margin:0, fontSize:9, color:C.gray }}>Aucun historique.</p>:rateHistoryRows.map((h,hi)=>{
                                  const pt=Number(h.price_total||h.price_week||0); const prev=hi>0?Number(rateHistoryRows[hi-1].price_total||rateHistoryRows[hi-1].price_week||0):null; const ev=prev!=null?pt-prev:null;
                                  return <p key={h.id||hi} style={{ margin:"2px 0 0", fontSize:9, color:C.text }}>{h.collected_at}{rateHistoryScope==="all"?` · ${fmtDateShort(h.period_start)}→${fmtDateShort(h.period_end)}`:""} · <strong>{fmt(pt)}€</strong> · {fmt(Math.round(pt/(h.stay_nights||7)))}€/n · {h.reliability_status}{h.edited_at?" · modifié":""}{ev!=null?<span style={{ color:ev>0?C.green:ev<0?C.red:C.gray, fontWeight:700 }}> · {ev>0?"+":""}{fmt(ev)}€</span>:""}</p>;
                                })}
                                <button onClick={closeRateEdit} style={{ ...btn(false,C.white,C.text), margin:"5px 0 0", fontSize:9, padding:"5px", border:`1px solid ${C.grayM}` }}>Fermer</button>
                              </div>
                            )}
                            {/* Choix en cas de doublon du jour */}
                            {duplicateRatePrompt&&duplicateRatePrompt.key===key&&(
                              <div style={{ ...cd(8), padding:"8px 10px", margin:"4px 0", background:C.goldL, border:`1px solid ${C.gold}` }}>
                                <p style={{ margin:"0 0 5px", fontSize:9, color:C.text, fontWeight:600 }}>Un relevé existe déjà aujourd'hui : {fmt(Number(duplicateRatePrompt.existingRate.price_total||duplicateRatePrompt.existingRate.price_week||0))}€. Que faire ?</p>
                                <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                                  <button onClick={()=>resolveDuplicateRate("update")} style={{ fontSize:9, fontWeight:700, color:C.white, background:C.orange, border:"none", borderRadius:6, padding:"5px 9px", cursor:"pointer" }}>Mettre à jour le relevé du jour</button>
                                  <button onClick={()=>resolveDuplicateRate("new")} style={{ fontSize:9, fontWeight:700, color:C.white, background:C.green, border:"none", borderRadius:6, padding:"5px 9px", cursor:"pointer" }}>Créer un nouveau relevé</button>
                                  <button onClick={()=>resolveDuplicateRate("cancel")} style={{ fontSize:9, fontWeight:600, color:C.gray, background:C.white, border:`1px solid ${C.grayM}`, borderRadius:6, padding:"5px 9px", cursor:"pointer" }}>Annuler</button>
                                </div>
                              </div>
                            )}
                            {st==="ok"&&<p style={{ margin:"3px 0 0", fontSize:8, color:C.green, fontWeight:600 }}>✓ Prix {s.source_name} enregistré</p>}
                            {st==="noprice"&&<p style={{ margin:"3px 0 0", fontSize:8, color:C.orange, fontWeight:600 }}>Prix manquant : saisissez un prix vérifié.</p>}
                            {st==="err"&&<p style={{ margin:"3px 0 0", fontSize:8, color:C.red }}>✗ Erreur d'enregistrement</p>}
                          </div>
                        );
                      })}
                    </div>
                  );
                }); })()}
              </div>
            </details>
          );
        })()}

        {/* Marché pro vs particuliers (bas de dashboard) */}
        {!isMobile&&(<>
          {sectionTitle("Marché pro vs particuliers","⚖️")}
          <div style={responsiveGrid(2)}>
            <div style={card()}>
              <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:6 }}><span style={{ fontSize:15 }}>🏢</span><span style={{ fontSize:13, fontWeight:700, color:C.blue }}>Marché professionnel</span></div>
              <p style={{ margin:0, fontSize:20, fontWeight:700, color:C.text }}>{dfProMedian?`${fmt(dfProMedian)}€`:"—"}<span style={{ fontSize:10, color:C.gray, fontWeight:400 }}> médiane {dfNights}n</span></p>
              <div style={{ display:"flex", gap:14, marginTop:6, flexWrap:"wrap" }}>
                <span style={{ fontSize:9, color:C.gray }}>Relevés : <strong>{dfProRates.length}</strong></span>
                <span style={{ fontSize:9, color:C.gray }}>Sources actives : <strong>{proSourcesCount}</strong></span>
                <span style={{ fontSize:9, color:C.gray }}>Écart Les Cimes : <strong style={{ color:dfProGap>0?C.red:C.green }}>{dfProGap!=null?`${dfProGap>0?"+":""}${dfProGap}%`:"—"}</strong></span>
              </div>
              <p style={{ margin:"6px 0 0", fontSize:8, color:C.gray, fontStyle:"italic" }}>Référence principale pour la grille tarifaire.</p>
            </div>
            <div style={card({ background:"#FFF7F7" })}>
              <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:6 }}><span style={{ fontSize:15 }}>🏠</span><span style={{ fontSize:13, fontWeight:700, color:"#FF5A5F" }}>Loueurs particuliers</span></div>
              <p style={{ margin:0, fontSize:20, fontWeight:700, color:C.text }}>{dfPrivMedian?`${fmt(dfPrivMedian)}€`:"—"}<span style={{ fontSize:10, color:C.gray, fontWeight:400 }}> médiane {dfNights}n</span></p>
              <div style={{ display:"flex", gap:14, marginTop:6, flexWrap:"wrap" }}>
                <span style={{ fontSize:9, color:C.gray }}>Relevés : <strong>{dfPrivRates.length}</strong></span>
                <span style={{ fontSize:9, color:C.gray }}>Pression : <strong style={{ color:dfPrivGap!=null&&dfPrivGap>30?C.red:dfPrivGap!=null&&dfPrivGap>=15?C.orange:C.green }}>{dfPrivGap==null?"—":dfPrivGap>30?"forte":dfPrivGap>=15?"moyenne":"faible"}</strong></span>
                <span style={{ fontSize:9, color:C.gray }}>Écart : <strong>{dfPrivGap!=null?`${dfPrivGap>0?"+":""}${dfPrivGap}%`:"—"}</strong></span>
              </div>
              <p style={{ margin:"6px 0 0", fontSize:8, color:"#C2185B", fontStyle:"italic" }}>Les particuliers servent d'alerte prix, pas de référence principale.</p>
            </div>
          </div>
        </>)}
      </div><BNav/>
    </div>
    );
  };

  // Page dédiée : Tarifs Les Cimes (grille, import CSV, saisie, liste)
  const TarifsLesCimes=()=>{
    const dashPeriod = ALL_PERIODS.find(p=>p.id===dashOurPeriodId);
    const dashNights = dashPeriod?.stay_nights || 7;
    const dashPriceNight = dashOurPrice ? Math.round((parseFloat(dashOurPrice)||0)/dashNights) : 0;
    const yearOf = r => (r.period_start||"").slice(0,4);
    const activeRates = (ourRates||[]).filter(r=>r.is_active!==false);
    // Saisie : typologie sélectionnée + tarif existant pour préremplissage sûr
    const saisieAcc = dashTarifTab==="saisie" ? (gridFilters.accType||"2P6") : (gridFilters.accType||"2P6");
    const saisieExisting = dashPeriod ? findRateForGridCell(activeRates, dashPeriod, saisieAcc) : null;
    // ── Données de la grille tarifaire (périodes × typologies) ──
    const gridNights = gridFilters.nights || 7;
    const gridPeriods = ALL_PERIODS
      .filter(p=>Number(p.stay_nights||7)===gridNights)
      .filter(p=>!gridFilters.season || p.season===gridFilters.season)
      .filter(p=>!gridFilters.year || (p.period_start||p.week_start||"").slice(0,4)===String(gridFilters.year))
      .slice().sort((a,b)=>String(a.period_start||a.week_start||"").localeCompare(String(b.period_start||b.week_start||"")));
    const rateFor = (period, accType) => {
      const r = findRateForGridCell(activeRates, period, accType);
      if (!r) return null;
      if (gridFilters.source && !(r.source||"").includes(gridFilters.source)) return null;
      return r;
    };
    const gridCols = gridFilters.accType ? [gridFilters.accType] : ACCOMMODATION_ORDER;
    // ── Contrôle grille (anomalies) ──
    const anomalies = (()=>{
      const a=[];
      const noType = activeRates.filter(r=>!normalizeAccommodationType(r.accommodation_type, r.notes));
      if (noType.length) a.push(`${noType.length} ligne(s) sans typologie identifiable (ni accommodation_type, ni note).`);
      // doublons : même dates + typologie + durée
      const seen={}; let dup=0;
      activeRates.forEach(r=>{ const k=`${(r.period_start||"").slice(0,10)}_${(r.period_end||"").slice(0,10)}_${normalizeAccommodationType(r.accommodation_type,r.notes)}_${r.stay_nights||7}`; seen[k]=(seen[k]||0)+1; });
      Object.values(seen).forEach(n=>{ if(n>1) dup++; });
      if (dup) a.push(`${dup} doublon(s) potentiel(s) (mêmes dates/typologie/durée).`);
      // 7 nuits ne finissant pas un samedi
      const notSat = activeRates.filter(r=>{ if(Number(r.stay_nights||7)!==7) return false; const end=r.period_end||(r.period_start?addDaysStr(r.period_start,7):null); if(!end) return false; return new Date(end+"T12:00:00Z").getUTCDay()!==6; });
      if (notSat.length) a.push(`${notSat.length} période(s) 7 nuits ne finissant pas un samedi.`);
      // accommodation_type vide ET notes sans typologie
      const capNoAcc = activeRates.filter(r=>!r.accommodation_type && !normalizeAccommodationType("", r.notes) && r.capacity);
      if (capNoAcc.length) a.push(`${capNoAcc.length} ligne(s) avec capacité mais sans typologie (à compléter).`);
      return a;
    })();
    const listFiltered = activeRates
      .filter(r=>!dashListFilter.year || yearOf(r)===String(dashListFilter.year))
      .filter(r=>!dashListFilter.cap || Number(r.capacity)===dashListFilter.cap)
      .filter(r=>!dashListFilter.nights || Number(r.stay_nights||7)===dashListFilter.nights)
      .sort((a,b)=>(b.period_start||"").localeCompare(a.period_start||""));
    return (
      <div><SBar title="Tarifs Les Cimes"/>
        <div style={cnt}>
          <div style={{ ...cd(11), padding:"11px 13px", background:C.bluePale, marginTop:8 }}>
            <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.blue }}>💰 Gestion tarifs Les Cimes</p>
            <p style={{ margin:"3px 0 0", fontSize:10, color:C.blueL }}>{activeRates.length} tarif(s) enregistré(s) · grille semaine de référence.</p>
          </div>

          {/* Contrôle grille */}
          {anomalies.length>0&&(
            <div style={{ ...cd(11), padding:"9px 12px", background:C.goldL, marginBottom:8, borderLeft:`3px solid ${C.gold}` }}>
              <p style={{ margin:"0 0 3px", fontSize:11, fontWeight:700, color:C.gold }}>🔍 Contrôle grille — {anomalies.length} alerte(s)</p>
              {anomalies.map((m,i)=><p key={i} style={{ margin:"1px 0 0", fontSize:9, color:C.text }}>• {m}</p>)}
            </div>
          )}

          <div style={{ display:"flex", background:C.grayM, padding:2, borderRadius:9, marginBottom:8, flexWrap:"wrap" }}>
            {[["grille","Grille tarifaire"],["saisie","Saisie / modification"],["import","Import CSV"],["liste","Lignes enregistrées"]].map(([id,lbl])=>(
              <button key={id} style={tabB(dashTarifTab===id)} onClick={()=>setDashTarifTab(id)}>{lbl}</button>
            ))}
          </div>

          {/* ── Grille tarifaire ── */}
          {dashTarifTab==="grille"&&(<>
            {/* Filtres */}
            <div style={{ display:"flex", gap:5, marginBottom:8, flexWrap:"wrap" }}>
              <select value={gridFilters.year} onChange={e=>setGridFilters(f=>({ ...f, year:parseInt(e.target.value)||0 }))} style={{ ...inp(), flex:"1 1 90px", fontSize:11, padding:"6px 8px" }}><option value="0">Toutes années</option><option value="2026">2026</option><option value="2027">2027</option></select>
              <select value={gridFilters.season} onChange={e=>setGridFilters(f=>({ ...f, season:e.target.value }))} style={{ ...inp(), flex:"1 1 90px", fontSize:11, padding:"6px 8px" }}><option value="">Été + Hiver</option><option value="ete">Été</option><option value="hiver">Hiver</option></select>
              <select value={gridFilters.nights} onChange={e=>setGridFilters(f=>({ ...f, nights:parseInt(e.target.value) }))} style={{ ...inp(), flex:"1 1 80px", fontSize:11, padding:"6px 8px" }}>{[7,4,3,2].map(n=><option key={n} value={n}>{n} nuits</option>)}</select>
              <select value={gridFilters.accType} onChange={e=>setGridFilters(f=>({ ...f, accType:e.target.value }))} style={{ ...inp(), flex:"1 1 110px", fontSize:11, padding:"6px 8px" }}><option value="">Toutes typologies</option>{ACCOMMODATION_ORDER.map(a=><option key={a} value={a}>{ACCOMMODATION_SHORT[a]}</option>)}</select>
              <select value={gridFilters.source} onChange={e=>setGridFilters(f=>({ ...f, source:e.target.value }))} style={{ ...inp(), flex:"1 1 110px", fontSize:11, padding:"6px 8px" }}><option value="">Toutes sources</option><option value="import">Import CSV</option><option value="saisie">Saisie</option></select>
            </div>

            {gridPeriods.length===0&&<p style={{ fontSize:11, color:C.gray, textAlign:"center", padding:"16px 0", fontStyle:"italic" }}>Aucune période pour ces filtres.</p>}

            {/* Desktop : tableau */}
            {!isMobile&&gridPeriods.length>0&&(
              <div style={{ ...card({ padding:0 }), overflow:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                  <thead>
                    <tr style={{ background:C.grayL }}>
                      <th style={{ textAlign:"left", padding:"9px 11px", fontSize:9, fontWeight:700, color:C.gray, textTransform:"uppercase", position:"sticky", left:0, background:C.grayL }}>Période</th>
                      {gridCols.map(a=><th key={a} style={{ textAlign:"center", padding:"9px 8px", fontSize:9, fontWeight:700, color:C.blue, minWidth:90 }}>{ACCOMMODATION_SHORT[a]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {gridPeriods.map((p,ri)=>(
                      <tr key={p.id} style={{ borderTop:`0.5px solid ${C.grayL}` }}>
                        <td style={{ padding:"8px 11px", verticalAlign:"top" }}>
                          <p style={{ margin:0, fontSize:11, fontWeight:600, color:C.text }}>{periodOptionLabel(p)}</p>
                          <p style={{ margin:0, fontSize:8, color:C.gray }}>{p.season==="hiver"?"Hiver":"Été"}</p>
                        </td>
                        {gridCols.map(a=>{
                          const r=rateFor(p,a);
                          const night=r?Math.round(Number(r.price_total)/(r.stay_nights||gridNights)):0;
                          return (
                            <td key={a} onClick={()=>openTarifCell(p.id,a,gridNights,r||null)} style={{ padding:"8px", textAlign:"center", cursor:"pointer", background:tarifCell&&tarifCell.periodId===p.id&&tarifCell.accType===a?C.bluePale:"transparent" }}>
                              {r?(<>
                                <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.blue }}>{fmt(Number(r.price_total))}€</p>
                                <p style={{ margin:0, fontSize:8, color:C.gray }}>{fmt(night)}€/nuit</p>
                                {(r.source||r.notes)&&<p style={{ margin:0, fontSize:7, color:C.gray, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:84 }}>{r.notes||r.source}</p>}
                              </>):(
                                <span style={{ fontSize:12, color:C.grayM }}>— <span style={{ color:C.blue, fontWeight:700 }}>+</span></span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Mobile : cartes par période */}
            {isMobile&&gridPeriods.map(p=>(
              <div key={p.id} style={card({ marginBottom:8 })}>
                <p style={{ margin:"0 0 5px", fontSize:12, fontWeight:700, color:C.text }}>{periodOptionLabel(p)}</p>
                {gridCols.map(a=>{
                  const r=rateFor(p,a);
                  return (
                    <div key={a} onClick={()=>openTarifCell(p.id,a,gridNights,r||null)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderTop:`0.5px solid ${C.grayL}`, cursor:"pointer" }}>
                      <span style={{ fontSize:11, fontWeight:600, color:C.blue }}>{ACCOMMODATION_SHORT[a]}</span>
                      {r?<span style={{ fontSize:12, fontWeight:700, color:C.text }}>{fmt(Number(r.price_total))}€ <span style={{ fontSize:8, color:C.gray, fontWeight:400 }}>· {fmt(Math.round(Number(r.price_total)/(r.stay_nights||gridNights)))}€/n</span></span>:<span style={{ fontSize:12, color:C.grayM }}>— <span style={{ color:C.blue, fontWeight:700 }}>+</span></span>}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Panneau d'édition de cellule */}
            {tarifCell&&(()=>{ const per=ALL_PERIODS.find(x=>x.id===tarifCell.periodId); return (
              <div style={{ ...cd(11), padding:"11px 13px", marginTop:8, border:`1px solid ${C.blue}` }}>
                <p style={{ margin:"0 0 6px", fontSize:12, fontWeight:700, color:C.blue }}>{tarifCell.existing?"Modifier":"Ajouter"} — {ACCOMMODATION_SHORT[tarifCell.accType]} · {per?periodOptionLabel(per):""}</p>
                <p style={{ ...sml, margin:"0 0 4px" }}>Prix total séjour € *</p>
                <input type="number" autoFocus style={{ ...inp(), marginBottom:6 }} placeholder="655" value={tarifCellPrice} onChange={e=>setTarifCellPrice(e.target.value)}/>
                {tarifCellPrice&&<p style={{ margin:"0 0 6px", fontSize:9, color:C.gray }}>{fmt(Math.round((parseFloat(tarifCellPrice)||0)/(tarifCell.nights||7)))}€/nuit · {tarifCell.nights} nuits</p>}
                {tarifCell.existing&&<p style={{ margin:"0 0 6px", fontSize:9, color:C.green, fontWeight:600 }}>Tarif existant : {fmt(Number(tarifCell.existing.price_total))}€ — sera mis à jour</p>}
                <p style={{ ...sml, margin:"0 0 4px" }}>Notes (optionnel)</p>
                <input style={{ ...inp(), marginBottom:8 }} placeholder="ex : grille été 2026" value={tarifCellNotes} onChange={e=>setTarifCellNotes(e.target.value)}/>
                {tarifCellMsg==="ok"&&<p style={{ margin:"0 0 6px", fontSize:11, color:C.green, fontWeight:600 }}>✓ Tarif enregistré</p>}
                {tarifCellMsg==="err"&&<p style={{ margin:"0 0 6px", fontSize:11, color:C.red }}>✗ Erreur d'enregistrement</p>}
                <div style={{ display:"grid", gridTemplateColumns:tarifCell.existing?"1fr 1fr 1fr":"1fr 1fr", gap:6 }}>
                  <button onClick={()=>{ setTarifCell(null); setTarifCellMsg(null); }} style={{ ...btn(false,C.grayL,C.text), margin:0 }}>Annuler</button>
                  {tarifCell.existing&&<button onClick={handleDeleteTarifCell} style={{ ...btn(false,C.redL,C.red), margin:0 }}>Supprimer</button>}
                  <button onClick={handleSaveTarifCell} disabled={!tarifCellPrice} style={{ ...btn(!tarifCellPrice,C.blue), margin:0 }}>{tarifCell.existing?"Mettre à jour":"Ajouter tarif"}</button>
                </div>
              </div>
            ); })()}
          </>)}

          {dashTarifTab==="saisie"&&(
            <div style={{ ...cd(11), padding:"11px 13px" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                <div>
                  <p style={{ ...sml, margin:"0 0 4px" }}>Période</p>
                  <select value={dashOurPeriodId} onChange={e=>setDashOurPeriodId(e.target.value)} style={inp()}>
                    <optgroup label="Été 7 nuits">{ALL_PERIODS.filter(p=>p.season==="ete").map(p=><option key={p.id} value={p.id}>{periodOptionLabel(p)}</option>)}</optgroup>
                    <optgroup label="Hiver 7 nuits">{ALL_PERIODS.filter(p=>p.season==="hiver"&&(p.stay_nights||7)===7).map(p=><option key={p.id} value={p.id}>{periodOptionLabel(p)}</option>)}</optgroup>
                    <optgroup label="Hiver 2 nuits">{ALL_PERIODS.filter(p=>p.season==="hiver"&&p.stay_nights===2).map(p=><option key={p.id} value={p.id}>{periodOptionLabel(p)}</option>)}</optgroup>
                  </select>
                </div>
                <div>
                  <p style={{ ...sml, margin:"0 0 4px" }}>Typologie</p>
                  <select value={gridFilters.accType||"2P6"} onChange={e=>setGridFilters(f=>({ ...f, accType:e.target.value }))} style={inp()}>{ACCOMMODATION_ORDER.map(a=><option key={a} value={a}>{ACCOMMODATION_SHORT[a]}</option>)}</select>
                </div>
              </div>
              <div style={{ display:"flex", gap:5, marginBottom:6, flexWrap:"wrap" }}>
                <span style={{ fontSize:9, background:C.grayL, color:C.gray, padding:"3px 7px", borderRadius:6 }}>Durée : {dashNights} nuits</span>
                <span style={{ fontSize:9, background:C.grayL, color:C.gray, padding:"3px 7px", borderRadius:6 }}>{dashPeriod?.season==="hiver"?"Hiver":"Été"}</span>
                <span style={{ fontSize:9, background:C.grayL, color:C.gray, padding:"3px 7px", borderRadius:6 }}>Capacité : {ACCOMMODATION_TYPES[saisieAcc]?.capacity||"?"}P</span>
                {saisieExisting&&<span style={{ fontSize:9, background:C.greenL, color:C.green, padding:"3px 7px", borderRadius:6, fontWeight:700 }}>existant · sera mis à jour</span>}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                <div>
                  <p style={{ ...sml, margin:"0 0 4px" }}>Prix total séjour € *</p>
                  <input type="number" style={inp()} placeholder={saisieExisting?String(saisieExisting.price_total):"655"} value={dashOurPrice} onChange={e=>setDashOurPrice(e.target.value)}/>
                </div>
                <div>
                  <p style={{ ...sml, margin:"0 0 4px" }}>Prix / nuit (auto)</p>
                  <input type="text" disabled style={{ ...inp(), background:C.grayL, color:C.gray }} value={dashOurPrice?dashPriceNight+"€/nuit":"—"}/>
                </div>
              </div>
              {saisieExisting&&<p style={{ margin:"0 0 6px", fontSize:10, color:C.green, fontWeight:600 }}>Tarif existant : {fmt(Number(saisieExisting.price_total))}€ — laissez vide pour conserver, ou saisissez un nouveau prix pour mettre à jour.</p>}
              <p style={{ ...sml, margin:"0 0 4px" }}>Notes (optionnel)</p>
              <input style={{ ...inp(), marginBottom:8 }} placeholder="ex : grille été 2026" value={dashOurNotes} onChange={e=>setDashOurNotes(e.target.value)}/>
              {dashOurSaved==="ok"&&<div style={{ ...cd(8), padding:"7px 10px", background:C.greenL, marginBottom:6 }}><p style={{ margin:0, fontSize:11, fontWeight:600, color:C.green }}>✓ Tarif enregistré</p></div>}
              {dashOurSaved?.startsWith("err")&&<div style={{ ...cd(8), padding:"7px 10px", background:C.redL, marginBottom:6 }}><p style={{ margin:0, fontSize:11, color:C.red }}>✗ {dashOurSaved.slice(4)}</p></div>}
              <button style={btn(dashOurSaving||!dashOurPrice,C.blue)} onClick={handleDashSaveOurRateTyped} disabled={dashOurSaving||!dashOurPrice}>{dashOurSaving?"Enregistrement…":saisieExisting?"Mettre à jour tarif Les Cimes":"Créer tarif Les Cimes"}</button>
            </div>
          )}
          {dashTarifTab==="import"&&(
            <div style={{ ...cd(11), padding:"11px 13px" }}>
              <p style={{ margin:"0 0 4px", fontSize:11, fontWeight:700, color:C.blue }}>Importer grille tarifaire Les Cimes</p>
              <p style={{ margin:"0 0 6px", fontSize:9, color:C.gray, fontFamily:"monospace", lineHeight:1.5 }}>period_id;period_start;period_end;period_label;season;stay_nights;capacity;accommodation_type;price_total;notes</p>
              {ourCsvResult&&(
                <div style={{ ...cd(8), padding:"8px 10px", background:ourCsvResult.errors.length===0?C.greenL:C.goldL, marginBottom:6 }}>
                  <p style={{ margin:"0 0 1px", fontSize:11, color:C.green }}>✓ Importés : {ourCsvResult.ok}</p>
                  <p style={{ margin:"0 0 1px", fontSize:11, color:C.blue }}>↻ Mis à jour : {ourCsvResult.updated}</p>
                  <p style={{ margin:"0 0 1px", fontSize:11, color:C.gray }}>⊝ Ignorées : {ourCsvResult.skipped}</p>
                  {ourCsvResult.errors.map((e,i)=><p key={i} style={{ margin:0, fontSize:10, color:C.red }}>✗ {e}</p>)}
                </div>
              )}
              <textarea value={ourCsvText} onChange={e=>setOurCsvText(e.target.value)} placeholder={"2026_w2;2026-06-27;2026-07-04;27 juin → 3 juil;ete;7;6;2P6;340;Tarif été 2026"} style={{ width:"100%", minHeight:80, padding:"8px", fontSize:10, fontFamily:"monospace", border:`1px solid ${C.grayM}`, borderRadius:9, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                <button onClick={()=>{ const tpl=["period_id;period_start;period_end;period_label;season;stay_nights;capacity;accommodation_type;price_total;notes","2026_w2;2026-06-27;2026-07-04;27 juin → 3 juil;ete;7;6;2P6;340;Tarif été 2026","2026_w3;2026-07-04;2026-07-11;4 juil → 10 juil;ete;7;8;3P8;460;Tarif été 2026"].join("\n"); const b=new Blob([tpl],{ type:"text/csv;charset=utf-8" }); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download="modele_tarifs_les_cimes.csv"; a.click(); }} style={{ ...btn(false,C.grayL,C.blueL), margin:0, border:`1px solid ${C.blueL}` }}>⬇ Modèle CSV</button>
                <button style={{ ...btn(ourCsvLoading||!ourCsvText.trim(),C.blue), margin:0 }} onClick={handleImportOurCsv} disabled={ourCsvLoading||!ourCsvText.trim()}>{ourCsvLoading?"Import…":"Importer tarifs"}</button>
              </div>
            </div>
          )}
          {dashTarifTab==="liste"&&(
            <div>
              <div style={{ display:"flex", gap:4, marginBottom:8, flexWrap:"wrap" }}>
                {[[0,"Toutes années"],[2026,"2026"],[2027,"2027"]].map(([v,l])=>(
                  <button key={l} onClick={()=>setDashListFilter(f=>({ ...f, year:v }))} style={{ padding:"4px 9px", fontSize:10, fontWeight:dashListFilter.year===v?700:400, background:dashListFilter.year===v?C.blue:C.white, color:dashListFilter.year===v?C.white:C.text, border:`1px solid ${dashListFilter.year===v?C.blue:C.grayM}`, borderRadius:14, cursor:"pointer" }}>{l}</button>
                ))}
                {[[0,"Toutes cap."],[2,"2P"],[4,"4P"],[6,"6P"],[8,"8P"]].map(([v,l])=>(
                  <button key={"c"+l} onClick={()=>setDashListFilter(f=>({ ...f, cap:v }))} style={{ padding:"4px 9px", fontSize:10, fontWeight:dashListFilter.cap===v?700:400, background:dashListFilter.cap===v?C.green:C.white, color:dashListFilter.cap===v?C.white:C.text, border:`1px solid ${dashListFilter.cap===v?C.green:C.grayM}`, borderRadius:14, cursor:"pointer" }}>{l}</button>
                ))}
                {[[0,"Toutes durées"],[7,"7n"],[4,"4n"],[3,"3n"],[2,"2n"]].map(([v,l])=>(
                  <button key={"n"+l} onClick={()=>setDashListFilter(f=>({ ...f, nights:v }))} style={{ padding:"4px 9px", fontSize:10, fontWeight:dashListFilter.nights===v?700:400, background:dashListFilter.nights===v?C.purple:C.white, color:dashListFilter.nights===v?C.white:C.text, border:`1px solid ${dashListFilter.nights===v?C.purple:C.grayM}`, borderRadius:14, cursor:"pointer" }}>{l}</button>
                ))}
              </div>
              <p style={{ ...sml, margin:"0 0 5px" }}>{listFiltered.length} tarif(s){listFiltered.length>30?" · 30 affichés":""}</p>
              {listFiltered.length===0&&<p style={{ fontSize:11, color:C.gray, textAlign:"center", padding:"14px 0", fontStyle:"italic" }}>Aucun tarif enregistré pour ces filtres.</p>}
              <div style={cd()}>
                {listFiltered.slice(0,30).map((r,i,arr)=>(
                  <div key={r.id||`${r.period_id}_${r.capacity}_${r.stay_nights}`} style={rw(i===Math.min(arr.length,30)-1)}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontSize:12, fontWeight:500, color:C.text }}>{r.period_start?`${fmtDateShort(r.period_start)} → ${fmtDateShort(r.period_end||addDaysStr(r.period_start,r.stay_nights||7))}`:(r.period_label||r.period_id)}</p>
                      <div style={{ display:"flex", gap:4, marginTop:1, flexWrap:"wrap" }}>
                        {(()=>{ const t=inferAccommodationType(r); return t?<span style={{ fontSize:8, fontWeight:700, color:C.blue, background:C.bluePale, padding:"1px 5px", borderRadius:3 }}>{ACCOMMODATION_SHORT[t]}{!r.accommodation_type?" (déduit)":""}</span>:<span style={{ fontSize:8, fontWeight:700, color:C.red, background:C.redL, padding:"1px 5px", borderRadius:3 }}>sans typologie</span>; })()}
                        <span style={{ fontSize:9, color:C.gray }}>{r.capacity}P · {r.stay_nights||7} nuits</span>
                        <span style={{ fontSize:9, color:r.season==="hiver"?"#0EA5E9":C.orange }}>{r.season==="hiver"?"Hiver":"Été"}</span>
                        <span style={{ fontSize:8, background:C.grayL, color:C.gray, padding:"1px 5px", borderRadius:3 }}>{r.source||"saisie"}</span>
                      </div>
                      {r.notes&&<p style={{ margin:"1px 0 0", fontSize:9, color:C.gray, fontStyle:"italic" }}>{r.notes}</p>}
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0, display:"flex", alignItems:"center", gap:8 }}>
                      <div>
                        <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.blue }}>{fmt(Number(r.price_total))}€/séjour</p>
                        <p style={{ margin:0, fontSize:9, color:C.gray }}>{fmt(Number(r.price_night||Math.round(Number(r.price_total)/(r.stay_nights||7))))}€/nuit</p>
                      </div>
                      <button onClick={()=>handleDeleteOurRate(r.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.gray, padding:2 }}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div><BNav/>
      </div>
    );
  };

  // Page dédiée concurrents par segment (résidences/pros ou particuliers)
  const CompetitorsSegmentScreen = ({ segment }) => {
    const isPrivate = segment === "private";
    const title = isPrivate ? "🏠 Concurrents suivis — Particuliers" : "🏢 Concurrents suivis — Résidences / Pros";
    const description = isPrivate
      ? "Les particuliers servent à mesurer la pression prix. Ils ne doivent pas piloter seuls la grille tarifaire."
      : "Les résidences et professionnels servent de référence principale pour le benchmark.";
    const list = (catalog||[]).filter(c => isPrivate ? isPrivateCompetitor(c) : !isPrivateCompetitor(c));
    const srcCount = (sources||[]).filter(s=>{ const c=catalog.find(x=>x.id===s.competitor_id); return c && (isPrivate?isPrivateCompetitor(c):!isPrivateCompetitor(c)) && s.is_active!==false; }).length;
    const accent = isPrivate ? "#FF5A5F" : C.blue;
    const emptyMsg = isPrivate
      ? "Aucun particulier suivi pour l'instant. Ajoutez les annonces trouvées sur Booking, Airbnb ou Abritel pour mesurer la pression prix."
      : "Aucune résidence suivie pour l'instant. Ajoutez les résidences concurrentes, TO ou sites directs à surveiller.";
    const addPreset = isPrivate
      ? { market_segment:"private", is_private_rental:true, property_type:"particulier", search_location:"La Foux d'Allos" }
      : { market_segment:"residence", is_private_rental:false, property_type:"résidence", search_location:"La Foux d'Allos" };
    const quickAdds = isPrivate
      ? [["bookingpart","marketplace","Booking particulier","+ Booking part."],["airbnb","marketplace","Airbnb","+ Airbnb"],["abritel","marketplace","Abritel","+ Abritel"],["pap","marketplace","PAP vacances","+ PAP"],["other","other","","+ Autre"]]
      : [["booking","booking","Booking.com","+ Booking"],["direct","direct","Site direct","+ Direct"],["tour_operator","tour_operator",TOUR_OPERATORS[0],"+ TO"],["marketplace","marketplace",MARKETPLACES[0],"+ OTA"],["other","other","","+ Autre"]];

    return (
      <div><SBar title={isPrivate?"Concurrents Particuliers":"Concurrents Résidences"}/>
        <div style={cnt}>
          <div style={{ ...cd(11), padding:"11px 13px", background:isPrivate?"#FFE9EA":C.bluePale, marginTop:8, borderLeft:`3px solid ${accent}` }}>
            <p style={{ margin:0, fontSize:13, fontWeight:700, color:accent }}>{title}</p>
            <p style={{ margin:"3px 0 0", fontSize:10, color:isPrivate?"#C2185B":C.blueL, lineHeight:1.4 }}>{description}</p>
            <div style={{ display:"flex", gap:14, marginTop:6, flexWrap:"wrap" }}>
              <span style={{ fontSize:11, fontWeight:700, color:accent }}>{list.length} concurrents</span>
              <span style={{ fontSize:11, fontWeight:700, color:accent }}>{srcCount} sources actives</span>
            </div>
          </div>

          <div style={cd()}>
            {list.length===0&&<div style={{ padding:"14px 13px" }}><p style={{ margin:0, fontSize:11, color:C.gray, fontStyle:"italic", lineHeight:1.5 }}>{emptyMsg}</p></div>}
            {list.map((c,i)=>{
              const compSources = sourcesForCompetitor(c);
              const open = sourcesOpenFor===c.id;
              return (
                <div key={c.id} style={{ borderBottom:i===list.length-1?"none":`0.5px solid ${C.grayL}` }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 13px", gap:8 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                        <span style={{ fontSize:12, fontWeight:600, color:C.text }}>{c.name}</span>
                        <Badge label={isPrivate?"Particulier":c.property_type==="hôtel"?"Hôtel":"Pro"} color={isPrivate?"#FF5A5F":c.property_type==="hôtel"?C.purple:C.blue} bg={isPrivate?"#FFE9EA":c.property_type==="hôtel"?C.purpleL:C.bluePale} size={8}/>
                        {isPrivate&&c.detected_capacity&&<span style={{ fontSize:8, color:C.gray }}>{c.detected_capacity}P{c.detected_rooms?` · ${c.detected_rooms}`:""}</span>}
                      </div>
                      <div style={{ display:"flex", gap:4, marginTop:2, alignItems:"center", flexWrap:"wrap" }}>
                        <span style={{ fontSize:9, color:C.gray }}>score {c.comparability_score||"?"}/100</span>
                        {compSources.length===0
                          ? <span style={{ fontSize:8, color:C.gray, fontStyle:"italic" }}>Aucune source suivie</span>
                          : compSources.map(s=>(()=>{ const m=sourceBadgeMeta(s.source_type); return <Badge key={s.id} label={s.source_name} color={m.c} bg={m.bg} size={8}/>; })())}
                      </div>
                      {c.notes&&<p style={{ margin:"2px 0 0", fontSize:9, color:C.gray, fontStyle:"italic" }}>{c.notes}</p>}
                    </div>
                    <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                      <button onClick={()=>setSourcesOpenFor(open?null:c.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:10, color:C.blue, padding:2 }}>{open?"▲ Sources":"▼ Sources"}</button>
                      <button onClick={()=>openCatForm(c)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:C.blue, padding:2 }}>✎</button>
                      <button onClick={()=>handleDeleteCatalogItem(c.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.gray, padding:2 }}>🗑</button>
                    </div>
                  </div>
                  {open&&(
                    <div style={{ padding:"0 13px 10px", background:C.grayL }}>
                      <p style={{ ...sml, margin:"6px 0 4px" }}>Sources suivies</p>
                      {(sources||[]).filter(s=>s.competitor_id===c.id).length===0&&<p style={{ margin:"0 0 6px", fontSize:9, color:C.gray, fontStyle:"italic" }}>Aucune source dédiée.</p>}
                      {(sources||[]).filter(s=>s.competitor_id===c.id).map(s=>(
                        <div key={s.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:6, padding:"4px 0" }}>
                          <div style={{ minWidth:0, flex:1 }}>
                            <span style={{ fontSize:10, fontWeight:600, color:C.text }}>{s.source_name}</span>
                            <p style={{ margin:0, fontSize:8, color:C.gray, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.source_url}</p>
                          </div>
                          <button onClick={()=>handleDeleteSource(s.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:C.gray, flexShrink:0 }}>🗑</button>
                        </div>
                      ))}
                      {sourceForm&&sourceForm.competitor_id===c.id ? (
                        <div style={{ ...cd(9), padding:"8px 10px", marginTop:6 }}>
                          <p style={{ ...sml, margin:"0 0 3px" }}>Famille de source</p>
                          <select value={sourceForm.family} onChange={e=>{ const fam=e.target.value; setSourceForm(f=>{ let st=fam, sn=f.source_name; if(fam==="booking"){st="booking";sn="Booking.com";} else if(fam==="direct"){st="direct";sn="Site direct";} else if(fam==="tour_operator"){st="tour_operator";sn=TOUR_OPERATORS[0];} else if(fam==="marketplace"){st="marketplace";sn=MARKETPLACES[0];} else {st="other";sn="";} return { ...f, family:fam, source_type:st, source_name:sn }; }); }} style={{ ...inp(), marginBottom:5 }}>
                            {SOURCE_FAMILIES.map(t=><option key={t.type} value={t.type}>{t.name}</option>)}
                          </select>
                          {sourceForm.family==="tour_operator"&&(<>
                            <p style={{ ...sml, margin:"0 0 3px" }}>Tour opérateur</p>
                            <select value={TOUR_OPERATORS.includes(sourceForm.source_name)?sourceForm.source_name:"Autre tour opérateur"} onChange={e=>setSourceForm(f=>({ ...f, source_name:e.target.value==="Autre tour opérateur"?"":e.target.value, _toOther:e.target.value==="Autre tour opérateur" }))} style={{ ...inp(), marginBottom:5 }}>
                              {TOUR_OPERATORS.map(o=><option key={o} value={o}>{o}</option>)}
                            </select>
                            {(sourceForm._toOther||!TOUR_OPERATORS.includes(sourceForm.source_name))&&<input style={{ ...inp(), marginBottom:5 }} placeholder="Nom du tour opérateur" value={sourceForm.source_name||""} onChange={e=>setSourceForm(f=>({ ...f, source_name:e.target.value }))}/>}
                          </>)}
                          {sourceForm.family==="marketplace"&&(<>
                            <p style={{ ...sml, margin:"0 0 3px" }}>Marketplace / OTA</p>
                            <select value={MARKETPLACES.includes(sourceForm.source_name)?sourceForm.source_name:MARKETPLACES[0]} onChange={e=>setSourceForm(f=>({ ...f, source_name:e.target.value }))} style={{ ...inp(), marginBottom:5 }}>
                              {MARKETPLACES.map(o=><option key={o} value={o}>{o}</option>)}
                            </select>
                          </>)}
                          {sourceForm.family==="other"&&(
                            <input style={{ ...inp(), marginBottom:5 }} placeholder="Nom de la source" value={sourceForm.source_name||""} onChange={e=>setSourceForm(f=>({ ...f, source_name:e.target.value }))}/>
                          )}
                          <input style={{ ...inp(), marginBottom:5 }} placeholder="URL de la fiche" value={sourceForm.source_url} onChange={e=>setSourceForm(f=>({ ...f, source_url:e.target.value }))}/>
                          <input style={{ ...inp(), marginBottom:5 }} placeholder="Notes (optionnel)" value={sourceForm.notes||""} onChange={e=>setSourceForm(f=>({ ...f, notes:e.target.value }))}/>
                          {sourceForm.error&&<p style={{ margin:"0 0 5px", fontSize:9, color:C.red }}>✗ {sourceForm.error}</p>}
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
                            <button onClick={()=>setSourceForm(null)} style={{ ...btn(false,C.grayL,C.text), margin:0 }}>Annuler</button>
                            <button onClick={handleSaveSource} style={{ ...btn(false,C.blue), margin:0 }}>Enregistrer source</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:4 }}>
                          {quickAdds.map(([fam,st,sn,lbl],bi)=>(
                            <button key={bi} onClick={()=>setSourceForm({ competitor_id:c.id, family:fam, source_type:st, source_name:sn, source_url:"", notes:"" })} style={{ fontSize:9, fontWeight:600, color:C.blue, background:C.bluePale, border:"none", borderRadius:6, padding:"5px 8px", cursor:"pointer" }}>{lbl}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button onClick={()=>openCatForm(addPreset)} style={{ ...btn(false,accent), marginBottom:8 }}>{isPrivate?"+ Ajouter particulier":"+ Ajouter résidence / pro"}</button>

          {/* Formulaire ajout/édition (partagé) */}
          {catForm&&(competitorSegment(catForm)===segment)&&(
            <div style={{ ...cd(11), padding:"11px 13px", borderTop:`3px solid ${accent}` }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:6, flexWrap:"wrap" }}>
                <p style={{ margin:0, fontSize:12, fontWeight:700, color:accent }}>{catForm.id?(isPrivate?"🏠 Modifier le particulier":"🏢 Modifier la résidence / pro"):(isPrivate?"🏠 Nouveau concurrent particulier":"🏢 Nouveau concurrent résidence / pro")}</p>
                <Badge label={isPrivate?"Segment : Particulier":"Segment : Résidence / Pro"} color={isPrivate?"#FF5A5F":C.blue} bg={isPrivate?"#FFE9EA":C.bluePale} size={9}/>
              </div>
              <p style={{ ...sml, margin:"0 0 4px" }}>Nom *</p>
              <input style={{ ...inp(), marginBottom:6 }} placeholder={isPrivate?"Appartement Central Park 6P":"Résidence Les Chalets du Verdon"} value={catForm.name||""} onChange={e=>setCatForm(f=>({ ...f, name:e.target.value }))}/>
              <p style={{ ...sml, margin:"0 0 4px" }}>Sous-type</p>
              <select value={catForm.property_type||(isPrivate?"particulier":"résidence")} onChange={e=>setCatForm(f=>({ ...f, property_type:e.target.value }))} style={{ ...inp(), marginBottom:6 }}>{(isPrivate?["particulier","studio"]:["résidence","hôtel"]).map(t=><option key={t} value={t}>{t}</option>)}</select>
              {isPrivate&&(
                <div style={{ ...formGrid, marginBottom:6 }}>
                  <div><p style={{ ...sml, margin:"0 0 4px" }}>Capacité détectée</p><input type="number" style={inp()} placeholder="6" value={catForm.detected_capacity||""} onChange={e=>setCatForm(f=>({ ...f, detected_capacity:e.target.value }))}/></div>
                  <div><p style={{ ...sml, margin:"0 0 4px" }}>Pièces / surface</p><input style={inp()} placeholder="3P / 45m²" value={catForm.detected_rooms||""} onChange={e=>setCatForm(f=>({ ...f, detected_rooms:e.target.value }))}/></div>
                </div>
              )}
              <div style={{ ...formGrid, marginBottom:6 }}>
                <div><p style={{ ...sml, margin:"0 0 4px" }}>Localisation</p><input style={inp()} value={catForm.search_location||""} onChange={e=>setCatForm(f=>({ ...f, search_location:e.target.value }))}/></div>
                <div><p style={{ ...sml, margin:"0 0 4px" }}>Score comparabilité</p><input type="number" style={inp()} value={catForm.comparability_score||""} onChange={e=>setCatForm(f=>({ ...f, comparability_score:e.target.value }))}/></div>
              </div>
              <p style={{ ...sml, margin:"0 0 4px" }}>Notes</p>
              <input style={{ ...inp(), marginBottom:8 }} value={catForm.notes||""} onChange={e=>setCatForm(f=>({ ...f, notes:e.target.value }))}/>
              {catForm.error&&<p style={{ margin:"0 0 6px", fontSize:10, color:C.red }}>✗ {catForm.error}</p>}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                <button onClick={()=>{ setCatForm(null); setCompetitorFormSources([]); }} style={{ ...btn(false,C.grayL,C.text), margin:0 }}>Annuler</button>
                <button onClick={handleSaveCatalogItem} disabled={catSaving||!catForm.name?.trim()} style={{ ...btn(catSaving||!catForm.name?.trim(),C.blue), margin:0 }}>{catSaving?"…":"Enregistrer"}</button>
              </div>
              <p style={{ margin:"6px 0 0", fontSize:8, color:C.gray, fontStyle:"italic" }}>Ajoutez les sources (Booking, TO, OTA…) après l'enregistrement via le bouton « ▼ Sources » du concurrent.</p>
            </div>
          )}
        </div><BNav/>
      </div>
    );
  };

  const Weeks=()=>{
    // Périodes à afficher selon le mode
    let displayPeriods;
    if (periodMode === "ete_7") {
      displayPeriods = STATIC_WEEKS
        .filter(w => w.year === yr)
        .map(w => ({ ...w, season:"ete", stay_nights:7, period_start:w.week_start, period_end:_d(w.week_start,7), subtitle:w.label }));
    } else if (periodMode === "hiver_7") {
      displayPeriods = WINTER_PERIODS.filter(p => p.stay_nights === 7);
    } else {
      displayPeriods = WINTER_PERIODS.filter(p => p.stay_nights === 2);
    }
    const grouped = {};
    displayPeriods.forEach(p => { if(!grouped[p.month_label]) grouped[p.month_label]=[]; grouped[p.month_label].push(p); });
    const is2n = periodMode === "hiver_2";
    const isHiver = periodMode !== "ete_7";
    const barTitle = "Radar marché";
    return (
      <div><SBar title={barTitle}/>
        <div style={{ padding:"6px 14px 4px" }}>
          <div style={{ ...cd(10), padding:"8px 11px", background:C.goldL, marginBottom:8 }}>
            <p style={{ margin:"0 0 1px", fontSize:11, fontWeight:700, color:C.orange }}>📡 Radar marché — découverte de concurrents</p>
            <p style={{ margin:0, fontSize:9, color:C.orange }}>Les résultats Radar sont indicatifs. Ajoutez les concurrents utiles dans le catalogue avant de les suivre.</p>
          </div>
          {/* Sélecteur de mode */}
          <div style={{ display:"flex", gap:4, marginBottom:8 }}>
            {[["ete_7","Été 7 nuits"],["hiver_7","Hiver 7n"],["hiver_2","Hiver 2n"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setPeriodMode(id)} style={{ flex:1, padding:"6px 2px", background:periodMode===id?C.blue:C.white, color:periodMode===id?C.white:C.text, border:`1px solid ${periodMode===id?C.blue:C.grayM}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:periodMode===id?700:400 }}>{lbl}</button>
            ))}
          </div>
          {/* Année uniquement pour été */}
          {!isHiver && (
            <div style={{ display:"flex", gap:5, marginBottom:4 }}>
              {[2026,2027].map(y=><button key={y} onClick={()=>setYr(y)} style={{ padding:"5px 10px", fontSize:11, fontWeight:yr===y?700:400, background:yr===y?C.blue:C.white, color:yr===y?C.white:C.text, border:"none", borderRadius:14, cursor:"pointer" }}>{y}</button>)}
            </div>
          )}
        </div>
        <div style={{ ...cnt, paddingTop:2 }}>
          {displayPeriods.length===0&&<p style={{ fontSize:12, color:C.gray, textAlign:"center", padding:20 }}>Aucune période disponible.</p>}
          {Object.entries(grouped).map(([ml, periods])=>(
            <div key={ml}><p style={sml}>{ml}</p>
              <div style={cd()}>
                {periods.map((p,i)=>{
                  const pNights = p.stay_nights||7;
                  const sbRate = ourRates.find(r=>r.period_id===p.id && Number(r.capacity)===capNum && Number(r.stay_nights||7)===pNights && r.is_active!==false);
                  const fbPrice = !isHiver ? (OUR_TARIFS[cap]?.[p.season_type]||0) : 0;
                  const op = sbRate?.price_total ? Number(sbRate.price_total) : fbPrice;
                  const opNight = op ? Math.round(op / pNights) : 0;
                  const isSb = !!sbRate;
                  const pIs2n = p.stay_nights === 2;
                  return (
                    <div key={p.id} onClick={()=>{ setSWId(p.id); setTab("detail"); setIaText(null); setScreen("week"); }} style={{ ...rw(i===periods.length-1), cursor:"pointer" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2, flexWrap:"wrap" }}>
                          <div style={{ width:5, height:5, borderRadius:"50%", flexShrink:0, background:CAT_C[p.season_type] }}/>
                          <span style={{ fontSize:12, fontWeight:500, color:C.text }}>{p.label}</span>
                          {p.event_label&&<span style={{ fontSize:8, background:C.purpleL, color:C.purple, padding:"1px 4px", borderRadius:3, fontWeight:600 }}>{p.event_label.slice(0,14)}</span>}
                        </div>
                        <div style={{ marginLeft:10, display:"flex", gap:4, alignItems:"center", flexWrap:"wrap" }}>
                          <Badge label={CAT_L[p.season_type]} color={CAT_C[p.season_type]} bg={p.season_type==="haute"?"#FFF0E6":p.season_type==="moyenne"?C.bluePale:C.greenL} size={9}/>
                          {p.season==="hiver"&&<Badge label="Hiver" color="#0EA5E9" bg="#E0F2FE" size={9}/>}
                          <Badge label={pIs2n?"2 nuits":"7 nuits"} color={pIs2n?C.purple:C.gray} bg={pIs2n?C.purpleL:C.grayL} size={9}/>
                        </div>
                        {p.subtitle&&<p style={{ margin:"2px 0 0 10px", fontSize:9, color:C.gray }}>{p.subtitle}</p>}
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        {op>0 ? (
                          <>
                            <p style={{ margin:0, fontSize:12, fontWeight:600, color:C.blue }}>{fmt(op)}€/séjour</p>
                            <p style={{ margin:0, fontSize:9, color:C.gray }}>{fmt(opNight)}€/nuit</p>
                            <span style={{ fontSize:8, fontWeight:700, padding:"1px 4px", borderRadius:3, background:isSb?C.greenL:C.grayL, color:isSb?C.green:C.gray }}>{isSb?"saisi":"fallback"}</span>
                          </>
                        ) : (
                          <>
                            <p style={{ margin:0, fontSize:11, color:C.gray, fontStyle:"italic" }}>—€/séjour</p>
                            <p style={{ margin:0, fontSize:8, color:C.gray }}>{pIs2n?"2 nuits":"7 nuits"}</p>
                          </>
                        )}
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

  const WeekDetail=()=>{
    const w=selWeek;
    const is2n = (w?.stay_nights||7) === 2;
    const nightsLabel = is2n ? "2 nuits" : "7 nuits";
    const priceLabel  = is2n ? "€/séjour" : "€/sem";
    const pct=reco.ref?Math.round((ourPrice-reco.ref)/reco.ref*100):null;
    const allP=rates.map(r=>Number(r.price_week)).filter(Boolean);
    const allMin=allP.length?Math.min(...allP):0, allMax=allP.length?Math.max(...allP):0;
    const oPct=allMax>allMin&&ourPrice?Math.min(96,Math.max(4,Math.round((ourPrice-allMin)/(allMax-allMin)*100))):50;
    const mPct=allMax>allMin&&reco.ref?Math.min(96,Math.max(4,Math.round((reco.ref-allMin)/(allMax-allMin)*100))):50;
    const wColor=CAT_C[w?.season_type]||C.blue;

    // Plan de collecte — logique UI
    const planKey = planMode === "custom" ? null : planMode;
    const staticPeriods = planKey ? (PLAN_PERIODS[planKey]||[]) : (PLAN_PERIODS[`${planSeason}_${planNights}n`]||[]);
    // Période courante construite depuis selWeek (toujours en premier)
    const _curStart = selWeek?.period_start || selWeek?.week_start;
    const currentPlanPeriod = selWeek && _curStart ? {
      id:           selWeek.id,
      label:        selWeek.label || selWeek.subtitle || "Période courante",
      period_start: _curStart,
      period_end:   selWeek.period_end || addDaysStr(_curStart, selWeek.stay_nights || 7),
      week_start:   selWeek.week_start || _curStart,
      season:       selWeek.season || "ete",
      stay_nights:  selWeek.stay_nights || 7,
      isCurrent:    true,
    } : null;
    const availablePeriods = currentPlanPeriod
      ? [currentPlanPeriod, ...staticPeriods.filter(p=>p.id!==currentPlanPeriod.id)]
      : staticPeriods;
    const selectedPlanPeriods = availablePeriods.filter(p=>planPeriods.includes(p.id));
    const planCombos = selectedPlanPeriods.length * planCaps.length;
    const planTooMany = planCombos > 2;
    const planCanLaunch = !planTooMany && planCombos > 0 && planPlatforms.length > 0 && !planLoading;

    return (
      <div><SBar title={w?.label}/>
        <div style={{ background:`linear-gradient(135deg,${wColor}CC,${wColor})`, padding:"8px 14px 12px" }}>
          <button onClick={()=>setScreen("weeks")} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.8)", fontSize:12, padding:"0 0 4px", display:"flex", alignItems:"center", gap:3 }}>← Semaines</button>
          <p style={{ margin:"0 0 1px", fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.65)", textTransform:"uppercase" }}>{CAT_L[w?.season_type]} · {cap} · {nightsLabel}</p>
          <p style={{ margin:"0 0 2px", fontSize:15, fontWeight:700, color:C.white }}>{w?.label} {w?.year}</p>
          {w?.event_label&&<span style={{ fontSize:9, background:"rgba(255,255,255,0.2)", color:"#fff", padding:"2px 7px", borderRadius:10 }}>{w.event_label}</span>}
        </div>
        <div style={{ display:"flex", background:C.grayM, margin:"8px 14px", padding:2, borderRadius:9 }}>
          {[{id:"detail",l:"Résumé"},{id:"table",l:"Concurrents"},{id:"history",l:"Historique"},{id:"reco",l:"Analyse IA"}].map(t=>(
            <button key={t.id} style={tabB(tab===t.id)} onClick={()=>setTab(t.id)}>{t.l}</button>
          ))}
        </div>
        <div style={{ ...cnt, paddingTop:0 }}>
          {ratesLoading&&<p style={{ textAlign:"center", padding:20, color:C.gray, fontSize:13 }}>Chargement…</p>}

          {/* ── TAB RÉSUMÉ ── */}
          {tab==="detail"&&!ratesLoading&&(<>
            {reco.pendingCount>0&&reco.trustedCount<reco.pendingCount&&(
              <div style={{ ...cd(10), padding:"8px 11px", background:C.goldL, marginBottom:8 }}>
                <p style={{ margin:0, fontSize:10, fontWeight:600, color:C.orange }}>⚠ Les résultats issus du scraping doivent être validés avant d'influencer la recommandation. ({reco.pendingCount} à vérifier)</p>
              </div>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
              <div style={{ ...cd(11,0), padding:"10px 11px", background:C.bluePale }}>
                <p style={{ margin:"0 0 1px", fontSize:8, color:C.blueL, fontWeight:700, textTransform:"uppercase" }}>Nos tarifs · {cap}</p>
                {ourPrice>0 ? (
                  <>
                    <p style={{ margin:0, fontSize:18, fontWeight:700, color:C.blue }}>{fmt(ourNight)}€/n</p>
                    <p style={{ margin:0, fontSize:10, color:C.blueL }}>{fmt(ourPrice)}{priceLabel} · {OUR_TARIFS_META.source}</p>
                  </>
                ) : (
                  <>
                    <p style={{ margin:0, fontSize:14, fontWeight:700, color:C.gray, fontStyle:"italic" }}>—</p>
                    <p style={{ margin:0, fontSize:10, color:C.gray }}>Tarif {w?.season==="hiver"?"hiver":"séjour"} à définir</p>
                  </>
                )}
              </div>
              <div style={{ ...cd(11,0), padding:"10px 11px", background:C.grayL }}>
                <p style={{ margin:"0 0 1px", fontSize:8, color:C.gray, fontWeight:700, textTransform:"uppercase" }}>Médiane marché ({reco.ratesCount})</p>
                <p style={{ margin:0, fontSize:18, fontWeight:700, color:C.text }}>{reco.ref?fmt(Math.round(reco.ref/(w?.stay_nights||7)))+"€/n":"—"}</p>
                <p style={{ margin:0, fontSize:10, color:C.gray }}>{reco.ref?fmt(reco.ref)+priceLabel:"Insuffisant"}</p>
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

          {/* ── TAB CONCURRENTS ── */}
          {tab==="table"&&!ratesLoading&&(<>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <p style={sml}>{rates.length} relevé(s) · {cap}</p>
              <button onClick={()=>{ setForm({...emptyForm,weekId:selWeekId}); setScreen("collect"); setCM("manuelle"); }} style={{ fontSize:11, color:C.blue, background:"none", border:"none", cursor:"pointer", fontWeight:600, marginTop:12 }}>+ Ajouter</button>
            </div>
            <div style={cd()}>
              <div style={{ ...rw(false), background:C.bluePale }}>
                <div><div style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ fontSize:11, fontWeight:700, color:C.blue }}>Les Cimes (nous)</span><ReliaBadge status="réel"/></div><p style={{ margin:0, fontSize:9, color:C.blueL }}>{currentOurRate?`Tarif saisi · Supabase`:`Grille interne fallback · ${OUR_TARIFS_META.verified_at}`}</p></div>
                <div style={{ textAlign:"right" }}>
                  {ourPrice>0?(<>
                    <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.blue }}>{fmt(ourPrice)}€/séjour</p>
                    <p style={{ margin:0, fontSize:9, color:C.blueL }}>{fmt(ourNight)}€/nuit · {_nights} nuits</p>
                  </>):(
                    <p style={{ margin:0, fontSize:11, color:C.gray, fontStyle:"italic" }}>Tarif à saisir</p>
                  )}
                </div>
              </div>
              {rates.map((r,i)=>{ const diff=ourPrice?ourPrice-Number(r.price_week):null; const age=daysSince(r.collected_at);
                return deleteConfirm===r.id?(
                  <div key={r.id} style={{ padding:"10px 13px", background:C.redL, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <span style={{ fontSize:12, color:C.red }}>Supprimer ce relevé ?</span>
                    <div style={{ display:"flex", gap:8 }}>
                      <button onClick={()=>handleDelete(r)} style={{ fontSize:11, color:C.white, background:C.red, border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontWeight:700 }}>Oui</button>
                      <button onClick={()=>setDC(null)} style={{ fontSize:11, color:C.text, background:C.grayL, border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>Non</button>
                    </div>
                  </div>
                ):(()=>{
                  const st=r.reliability_status||"à vérifier";
                  const isRejected=st==="rejeté";
                  const isPending=st==="à vérifier";
                  const isValidated=st==="validé";
                  return (
                  <div key={r.id} style={{ ...rw(i===rates.length-1), flexDirection:"column", alignItems:"stretch", opacity:isRejected?0.5:1 }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:2, flexWrap:"wrap" }}>
                        <span style={{ fontSize:11, fontWeight:500, color:C.text, textDecoration:isRejected?"line-through":"none" }}>{r.competitor_name||r.source}</span>
                        {r.promo_label&&<PromoBadge label={r.promo_label}/>}
                        <ReliaBadge status={st}/>
                        <span style={{ fontSize:9, color:C.gray }}>score {r.comparability_score||"?"}/100</span>
                      </div>
                      <div style={{ display:"flex", gap:5 }}>
                        <span style={{ fontSize:9, color:C.gray }}>{r.collection_type}</span>
                        <span style={{ fontSize:9, color:age>settings.obsoleteDays?C.orange:C.gray }}>il y a {age}j</span>
                        {r.stay_nights===2&&<Badge label="2 NUITS" color={C.purple} bg={C.purpleL} size={8}/>}
                        {r.season==="hiver"&&<Badge label="HIVER" color="#0EA5E9" bg="#E0F2FE" size={8}/>}
                      </div>
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0, display:"flex", alignItems:"center", gap:8 }}>
                      <div>
                        <p style={{ margin:0, fontSize:11, fontWeight:600, color:C.text }}>{fmt(Number(r.price_night||Math.round((r.price_week||0)/7)))}€/n</p>
                        {r.stay_nights===2&&r.price_week_equiv&&<p style={{ margin:0, fontSize:9, color:C.gray }}>≈{fmt(r.price_week_equiv)}€/sem</p>}
                        {diff!==null&&<p style={{ margin:0, fontSize:9, fontWeight:700, color:diff>0?C.green:C.red }}>{diff>0?"+":""}{fmt(diff)}€</p>}
                      </div>
                      <button onClick={()=>setDC(r.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.gray, padding:2 }}>🗑</button>
                    </div>
                    </div>
                    {/* Boutons de validation */}
                    {isPending&&(
                      <div style={{ display:"flex", gap:6, marginTop:6 }}>
                        <button onClick={()=>updateRateStatus(r,"validé")} style={{ flex:1, padding:"5px 0", background:C.greenL, color:C.green, border:`1px solid ${C.green}`, borderRadius:7, fontSize:11, fontWeight:700, cursor:"pointer" }}>✓ Valider</button>
                        <button onClick={()=>updateRateStatus(r,"rejeté")} style={{ flex:1, padding:"5px 0", background:C.redL, color:C.red, border:`1px solid ${C.red}`, borderRadius:7, fontSize:11, fontWeight:700, cursor:"pointer" }}>✕ Rejeter</button>
                      </div>
                    )}
                    {isValidated&&(
                      <div style={{ marginTop:5 }}>
                        <button onClick={()=>updateRateStatus(r,"à vérifier")} style={{ fontSize:9, color:C.gray, background:"none", border:"none", cursor:"pointer", textDecoration:"underline", padding:0 }}>repasser à vérifier</button>
                      </div>
                    )}
                    {isRejected&&(
                      <div style={{ marginTop:5 }}>
                        <button onClick={()=>updateRateStatus(r,"à vérifier")} style={{ fontSize:9, color:C.gray, background:"none", border:"none", cursor:"pointer", textDecoration:"underline", padding:0 }}>réactiver</button>
                      </div>
                    )}
                  </div>
                  );
                })()
                ;
              })}
            </div>

            {/* ── SCRAPING SIMPLE : retiré de l'UI, le Plan de collecte est la seule méthode ── */}

            {/* ── Lien gestion tarif Les Cimes (édition dans Dashboard) ── */}
            <button onClick={()=>{ setScreen("dashboard"); setDashTarifTab("saisie"); setDashOurPeriodId(selWeekId); setDashOurCap(capNum); }} style={{ width:"100%", marginTop:8, padding:"8px 13px", background:C.white, border:`1px solid ${C.grayM}`, borderRadius:10, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:11, color:C.blue, fontWeight:600 }}>💰 Tarif Les Cimes : {ourPrice>0?`${fmt(ourPrice)}€/séjour · ${ourRateSource}`:"non défini"}</span>
              <span style={{ fontSize:10, color:C.gray }}>Modifier dans Dashboard →</span>
            </button>

            {/* ══ PLAN DE COLLECTE ══════════════════════════════════ */}
            <div style={{ marginTop:6 }}>
              <button onClick={()=>{ setShowPlan(p=>!p); if(showPlan){ setPlanResults(null); setPlanError(""); } }} style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 13px", background:showPlan?C.bluePale:C.white, border:`1px solid ${showPlan?C.blueL:C.grayM}`, borderRadius:10, cursor:"pointer" }}>
                <span style={{ fontSize:12, fontWeight:600, color:showPlan?C.blue:C.text }}>🔎 Pré-recherche marché</span>
                <span style={{ fontSize:10, color:C.gray }}>{showPlan?"▲ Fermer":"▼ Ouvrir"}</span>
              </button>

              {showPlan&&(()=>{
                return (
                  <div style={{ background:C.white, border:`1px solid ${C.grayM}`, borderTop:"none", borderRadius:"0 0 10px 10px", padding:"10px 13px", marginBottom:8 }}>

                    {/* Avertissement usage Claude */}
                    <div style={{ background:C.goldL, borderRadius:8, padding:"7px 10px", marginBottom:10 }}>
                      <p style={{ margin:0, fontSize:9, color:C.orange, fontWeight:600, lineHeight:1.4 }}>Claude sert à repérer des annonces, pas à garantir les prix. Vérifiez chaque tarif sur Booking avant de valider.</p>
                    </div>

                    {/* Mode */}
                    <p style={{ ...sml, margin:"0 0 6px" }}>Mode</p>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:10 }}>
                      {PLAN_MODES.map(m=>{
                        const sel=planMode===m.id;
                        return (<button key={m.id} onClick={()=>selectPlanMode(m.id)} style={{ padding:"7px 4px", background:sel?C.blue:C.grayL, border:"none", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:sel?700:400, color:sel?C.white:C.text }}>{m.label}</button>);
                      })}
                    </div>

                    {/* Saison + Durée si mode personnalisé */}
                    {planMode==="custom"&&(
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10 }}>
                        <div>
                          <p style={{ ...sml, margin:"0 0 5px" }}>Saison</p>
                          <div style={{ display:"flex", gap:4 }}>
                            {["ete","hiver"].map(s=><button key={s} onClick={()=>setPlanSeason(s)} style={{ flex:1, padding:"6px 0", background:planSeason===s?C.blue:C.grayL, border:"none", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:planSeason===s?700:400, color:planSeason===s?C.white:C.text }}>{s==="ete"?"Été":"Hiver"}</button>)}
                          </div>
                        </div>
                        <div>
                          <p style={{ ...sml, margin:"0 0 5px" }}>Durée</p>
                          <div style={{ display:"flex", gap:4 }}>
                            {[7,2].map(n=><button key={n} onClick={()=>setPlanNights(n)} style={{ flex:1, padding:"6px 0", background:planNights===n?C.blue:C.grayL, border:"none", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:planNights===n?700:400, color:planNights===n?C.white:C.text }}>{n} nuits</button>)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Périodes */}
                    <p style={{ ...sml, margin:"0 0 5px" }}>Périodes</p>
                    {availablePeriods.length===0?(
                      <p style={{ fontSize:11, color:C.gray, marginBottom:8 }}>Aucune période pour ce mode.</p>
                    ):(
                      <div style={{ border:`1px solid ${C.grayM}`, borderRadius:8, marginBottom:10, overflow:"hidden" }}>
                        {availablePeriods.map((p,i)=>{
                          const sel=planPeriods.includes(p.id);
                          const endDate=p.period_end||addDaysStr(p.period_start,p.stay_nights);
                          return (
                            <label key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderBottom:i<availablePeriods.length-1?`0.5px solid ${C.grayL}`:"none", cursor:"pointer", background:sel?C.bluePale:p.isCurrent?"#F0FDF4":"transparent" }}>
                              <input type="checkbox" checked={sel} onChange={()=>setPlanPeriods(prev=>sel?prev.filter(x=>x!==p.id):[...prev,p.id])} style={{ accentColor:C.blue }}/>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                                  <span style={{ fontSize:12, fontWeight:sel?600:400, color:sel?C.blue:C.text }}>{p.label}</span>
                                  {p.isCurrent&&<span style={{ fontSize:8, fontWeight:700, background:C.greenL, color:C.green, padding:"1px 5px", borderRadius:4 }}>Période courante</span>}
                                </div>
                                <span style={{ fontSize:9, color:C.gray }}>{fmtDateShort(p.period_start)} → {fmtDateShort(endDate)} · {p.season==="hiver"?"Hiver":"Été"} · {p.stay_nights} nuits</span>
                              </div>
                              <span style={{ fontSize:9, fontWeight:600, color:p.season==="hiver"?"#0EA5E9":C.orange, flexShrink:0 }}>{p.season==="hiver"?"Hiver":"Été"}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Capacités */}
                    <p style={{ ...sml, margin:"0 0 5px" }}>Capacités</p>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4, marginBottom:10 }}>
                      {[2,4,6,8].map(c=>{ const sel=planCaps.includes(c); return (<button key={c} onClick={()=>setPlanCaps(prev=>sel?prev.filter(x=>x!==c):[...prev,c])} style={{ padding:"6px 0", background:sel?C.blue:C.grayL, border:"none", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:sel?700:400, color:sel?C.white:C.text }}>{c}P</button>); })}
                    </div>

                    {/* Typologies */}
                    <p style={{ ...sml, margin:"0 0 5px" }}>Typologies</p>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4, marginBottom:10 }}>
                      {[["résidence","Résidences"],["particulier","Particuliers"],["hôtel","Hôtels"]].map(([val,lbl])=>{ const sel=planTypes.includes(val); return (<button key={val} onClick={()=>setPlanTypes(prev=>sel?prev.filter(x=>x!==val):[...prev,val])} style={{ padding:"6px 4px", background:sel?C.blue:C.grayL, border:"none", borderRadius:8, cursor:"pointer", fontSize:10, fontWeight:sel?700:400, color:sel?C.white:C.text }}>{lbl}</button>); })}
                    </div>

                    {/* Plateformes */}
                    <p style={{ ...sml, margin:"0 0 5px" }}>Plateformes <span style={{ fontWeight:400, textTransform:"none", color:C.gray }}>(moins = moins de conso IA)</span></p>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4, marginBottom:4 }}>
                      {["Booking.com","Airbnb","Abritel"].map(pf=>{ const sel=planPlatforms.includes(pf); return (<button key={pf} onClick={()=>setPlanPlatforms(prev=>sel?prev.filter(x=>x!==pf):[...prev,pf])} style={{ padding:"6px 4px", background:sel?C.green:C.grayL, border:"none", borderRadius:8, cursor:"pointer", fontSize:10, fontWeight:sel?700:400, color:sel?C.white:C.text }}>{pf.replace(".com","")}</button>); })}
                    </div>
                    {planPlatforms.length===0&&<p style={{ margin:"0 0 8px", fontSize:9, color:C.red }}>Sélectionnez au moins une plateforme.</p>}
                    {planPlatforms.length>1&&<p style={{ margin:"0 0 8px", fontSize:9, color:C.orange }}>⚠ Plusieurs plateformes = plus de consommation IA.</p>}
                    {planPlatforms.length===1&&<div style={{ marginBottom:8 }}/>}

                    {/* Cache toggle */}
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 10px", background:C.grayL, borderRadius:8, marginBottom:10 }}>
                      <div>
                        <p style={{ margin:0, fontSize:11, fontWeight:600, color:C.text }}>{planForceRefresh?"Forcer nouvelle recherche":"Utiliser cache (7j)"}</p>
                        <p style={{ margin:0, fontSize:9, color:C.gray }}>{planForceRefresh?"Claude sera appelé même si cache existant":"Retourne le cache si disponible"}</p>
                      </div>
                      <button onClick={()=>setPlanForce(p=>!p)} style={{ width:44, height:26, borderRadius:13, background:planForceRefresh?C.orange:C.green, border:"none", cursor:"pointer", position:"relative", flexShrink:0 }}>
                        <div style={{ position:"absolute", top:3, left:planForceRefresh?21:3, width:20, height:20, borderRadius:"50%", background:C.white, transition:"left 0.15s" }}/>
                      </button>
                    </div>

                    {/* Résumé combos */}
                    <div style={{ background:planTooMany?C.redL:planCombos===0?C.grayL:C.greenL, borderRadius:8, padding:"7px 10px", marginBottom:8 }}>
                      <p style={{ margin:0, fontSize:11, fontWeight:700, color:planTooMany?C.red:planCombos===0?C.gray:C.green }}>
                        {planCombos===0
                          ? "Sélectionner au moins 1 période et 1 capacité"
                          : planTooMany
                          ? `⚠ Trop large : ${selectedPlanPeriods.length} période(s) × ${planCaps.length} capacité(s) = ${planCombos} — max 1. Lance 1 période × 1 capacité.`
                          : `✓ ${selectedPlanPeriods.length} période${selectedPlanPeriods.length>1?"s":""} × ${planCaps.length} capacité${planCaps.length>1?"s":""} = ${planCombos} recherche${planCombos>1?"s":""}`}
                      </p>
                      {planCombos>0&&!planTooMany&&<p style={{ margin:"1px 0 0", fontSize:9, color:C.green }}>Durée estimée : ~{planCombos*30}s</p>}
                    </div>

                    <button onClick={launchPlan} disabled={!planCanLaunch} style={{ ...btn(!planCanLaunch,C.blue), margin:0 }}>
                      {planLoading?`⏳ Recherche en cours…`:"🔎 Lancer la pré-recherche"}
                    </button>
                    {selectedPlanPeriods.length>0&&(()=>{
                      const sp=selectedPlanPeriods[0];
                      const start=sp.period_start||sp.week_start;
                      const nights=sp.stay_nights||planNights||7;
                      const checkout=sp.period_end||addDaysStr(start,nights);
                      return <p style={{ margin:"5px 0 0", fontSize:9, color:C.gray, textAlign:"center" }}>Booking : arrivée {fmtDateShort(start)} · départ {fmtDateShort(checkout)} · {nights} nuits</p>;
                    })()}

                    {planError&&<div style={{ ...cd(9), padding:"8px 12px", background:C.redL, marginTop:6, marginBottom:0 }}><p style={{ margin:0, fontSize:11, color:C.red }}>{planError}</p></div>}

                    {/* ── Résultats plan ── */}
                    {planResults&&planResults.length>0&&(
                      <div style={{ marginTop:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                          <p style={{ ...sml, margin:0 }}>Résultats ({planResults.reduce((s,r)=>s+r.listings.length,0)} logements)</p>
                        </div>
                        {planResults.map((rawResult,ri)=>{
                          const ownCount=(rawResult.listings||[]).filter(l=>isOwnProperty(l.name)).length;
                          const result={ ...rawResult, listings:(rawResult.listings||[]).filter(l=>!isOwnProperty(l.name)) };
                          const allGroupSaved=result.listings.map((_,i)=>planSaved[`${result.week_id}_${result.capacity}_${i}`]);
                          const allDone=allGroupSaved.length>0&&allGroupSaved.every(s=>s==="ok"||s==="dup"||s==="valid");
                          const bkCheckin=result.period_start;
                          const bkCheckout=result.period_end||addDaysStr(result.period_start,result.stay_nights||7);
                          return (
                            <div key={`${result.week_id}_${result.capacity}`} style={{ ...cd(10,6) }}>
                              <div style={{ padding:"7px 12px", background:result.from_cache?C.greenL:C.bluePale, display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`0.5px solid ${C.grayM}` }}>
                                <div>
                                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                    <p style={{ margin:0, fontSize:11, fontWeight:700, color:result.from_cache?C.green:C.blue }}>{result.week_label}</p>
                                    <span style={{ fontSize:9, fontWeight:700, padding:"1px 5px", borderRadius:4, background:result.from_cache?"#D1FAE5":"#DBEAFE", color:result.from_cache?C.green:C.blueL }}>{result.from_cache?"Cache":"Pré-recherche"}</span>
                                  </div>
                                  <p style={{ margin:0, fontSize:9, color:result.from_cache?C.green:C.blueL }}>
                                    {fmtDateShort(result.period_start)} → {fmtDateShort(addDaysStr(result.period_start,(result.stay_nights||7)-1))} · {result.stay_nights}n · {result.capacity}P · {result.listings.length} logements
                                  </p>
                                  <p style={{ margin:"1px 0 0", fontSize:8, color:C.gray }}>Booking : arrivée {fmtDateShort(bkCheckin)} · départ {fmtDateShort(bkCheckout)}</p>
                                  {result.platforms&&result.platforms.length>0&&(
                                    <p style={{ margin:"1px 0 0", fontSize:8, color:C.gray }}>📍 {result.platforms.join(" · ")}</p>
                                  )}
                                  {ownCount>0&&<p style={{ margin:"1px 0 0", fontSize:8, color:C.orange }}>{ownCount} résultat{ownCount>1?"s":""} ignoré{ownCount>1?"s":""} : Les Cimes</p>}
                                </div>
                                {!result.error&&result.listings.length>0&&(
                                  <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end" }}>
                                    <button onClick={()=>savePlanGroup(result)} disabled={allDone} style={{ padding:"4px 9px", background:allDone?C.greenL:C.blue, color:allDone?C.green:C.white, border:"none", borderRadius:6, fontSize:10, fontWeight:600, cursor:allDone?"default":"pointer" }}>
                                      {allDone?"✓ Enregistré":"Tout enregistrer"}
                                    </button>
                                    {allDone&&(<button onClick={()=>{ setShowPlan(false); setTab("table"); loadRates(); }} style={{ padding:"3px 8px", background:C.white, color:C.blue, border:`1px solid ${C.blueL}`, borderRadius:6, fontSize:9, fontWeight:700, cursor:"pointer" }}>
                                      Valider →
                                    </button>)}
                                  </div>
                                )}
                              </div>
                              {/* Avertissement fiabilité + liens Booking corrigés */}
                              <div style={{ padding:"7px 12px", background:C.goldL, borderBottom:`0.5px solid ${C.grayM}` }}>
                                <p style={{ margin:"0 0 5px", fontSize:9, color:C.orange, fontWeight:600 }}>⚠ Prix issus de Claude Web Search : à vérifier sur Booking avant validation.</p>
                                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                                  <a href={bookingSearchUrl({ location:"La Foux d'Allos", periodStart:bkCheckin, periodEnd:bkCheckout, capacity:result.capacity })} target="_blank" rel="noreferrer" style={{ fontSize:9, fontWeight:600, color:C.blue, background:C.white, padding:"3px 8px", borderRadius:6, textDecoration:"none", border:`1px solid ${C.grayM}` }}>↗ Ouvrir Booking La Foux</a>
                                  <a href={bookingSearchUrl({ location:"Val d'Allos", periodStart:bkCheckin, periodEnd:bkCheckout, capacity:result.capacity })} target="_blank" rel="noreferrer" style={{ fontSize:9, fontWeight:600, color:C.blue, background:C.white, padding:"3px 8px", borderRadius:6, textDecoration:"none", border:`1px solid ${C.grayM}` }}>↗ Ouvrir Booking Val d'Allos</a>
                                </div>
                              </div>
                              {result.error&&<div style={{ padding:"8px 12px" }}><p style={{ margin:0, fontSize:11, color:C.red }}>✗ {result.error}</p></div>}
                              {result.warning&&!result.error&&<div style={{ padding:"8px 12px" }}><p style={{ margin:0, fontSize:11, color:C.gold }}>⚠ {result.warning}</p></div>}
                              {["résidence","particulier","hôtel"].map(cat=>{
                                const items=result.listings.filter(l=>l.property_type===cat); if(!items.length) return null;
                                const catLabel={résidence:"Résidences",particulier:"Particuliers",hôtel:"Hôtels"}[cat];
                                return (<div key={cat}>
                                  <div style={{ padding:"3px 12px", background:C.grayL, borderBottom:`0.5px solid ${C.grayM}` }}><span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".05em", color:C.gray }}>{catLabel} ({items.length})</span></div>
                                  {items.map((item,i)=>{
                                    const globalIdx=result.listings.indexOf(item);
                                    const key=`${result.week_id}_${result.capacity}_${globalIdx}`;
                                    const state=planSaved[key];
                                    const pt=item.price_total??item.price_week??0;
                                    const pn=item.price_night??(pt?Math.round(pt/(result.stay_nights||7)):0);
                                    const equiv=item.price_week_equiv??(pn?Math.round(pn*7):null);
                                    const is2n=result.stay_nights===2;
                                    const locked=state==="ok"||state==="dup"||state==="valid";
                                    const vp=planVerifyPrice[key]??"";
                                    const vpNight=vp?Math.round((parseFloat(vp)||0)/(result.stay_nights||7)):0;
                                    return (
                                      <div key={i} style={{ padding:"7px 12px", borderBottom:i<items.length-1?`0.5px solid ${C.grayL}`:"none" }}>
                                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                          <div style={{ flex:1, minWidth:0 }}>
                                            <p style={{ margin:0, fontSize:11, fontWeight:500, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                              <a href={safeListingUrl(item, result)} target="_blank" rel="noreferrer" style={{ color:C.text, textDecoration:"none" }}>{item.name}</a>
                                            </p>
                                            <p style={{ margin:0, fontSize:9, color:C.gray }}>{item.platform}{item.rating?` · ${item.rating}★`:""} · <span style={{ color:C.blueL }}>{(item.url&&item.url.startsWith("https://")&&!item.url.includes("..."))?"Lien source ↗":"Recherche Booking ↗"}</span></p>
                                            {is2n&&equiv&&<p style={{ margin:0, fontSize:8, color:C.purple, fontStyle:"italic" }}>≈{fmt(equiv)}€/sem indicatif</p>}
                                          </div>
                                          <div style={{ textAlign:"right", flexShrink:0 }}>
                                            <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.text }}>{fmt(pt)}€<span style={{ fontSize:9, fontWeight:400, color:C.gray }}>/{is2n?"2n":"sem"}</span></p>
                                            <p style={{ margin:0, fontSize:8, color:C.orange }}>proposé Claude</p>
                                          </div>
                                          <button onClick={()=>savePlanRate(item,result,key)} disabled={locked} style={{ width:26, height:26, borderRadius:7, border:"none", flexShrink:0, background:state==="dup"?C.goldL:(state==="ok"||state==="valid")?C.greenL:state==="err"?C.redL:C.bluePale, color:state==="dup"?C.gold:(state==="ok"||state==="valid")?C.green:state==="err"?C.red:C.blue, fontWeight:700, fontSize:14, cursor:locked?"default":"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                                            {state==="dup"?"=":state==="valid"?"✓✓":state==="ok"?"✓":state==="err"?"!":"+"}
                                          </button>
                                        </div>
                                        {!locked&&(
                                          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5 }}>
                                            <input type="number" placeholder="Prix vérifié Booking" value={vp} onChange={e=>setPlanVerifyPrice(p=>({ ...p, [key]:e.target.value }))} style={{ flex:1, padding:"5px 8px", fontSize:10, border:`1px solid ${C.grayM}`, borderRadius:6, boxSizing:"border-box" }}/>
                                            {vp&&<span style={{ fontSize:9, color:C.gray, whiteSpace:"nowrap" }}>{vpNight}€/n</span>}
                                            <button onClick={()=>savePlanRate(item,result,key,{ verifiedPrice:vp })} disabled={!vp} style={{ padding:"5px 8px", fontSize:9, fontWeight:700, background:vp?C.green:C.grayL, color:vp?C.white:C.gray, border:"none", borderRadius:6, cursor:vp?"pointer":"default", whiteSpace:"nowrap" }}>✓ Valider avec ce prix</button>
                                          </div>
                                        )}
                                        {state==="valid"&&<p style={{ margin:"4px 0 0", fontSize:8, color:C.green }}>✓ Validé — prix vérifié manuellement</p>}
                                      </div>
                                    );
                                  })}
                                </div>);
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </>)}

          {/* ── TAB HISTORIQUE ── */}
          {tab==="history"&&(<>
            <p style={{ ...sml, marginTop:8 }}>Filtres</p>
            <div style={{ display:"flex", gap:4, marginBottom:8, flexWrap:"wrap" }}>
              {[["","Toutes saisons"],["ete","Été"],["hiver","Hiver"]].map(([val,lbl])=>(
                <button key={val} onClick={()=>setHF(p=>({ ...p, season:val }))} style={{ padding:"4px 10px", fontSize:10, fontWeight:histFilter.season===val?700:400, background:histFilter.season===val?C.blue:C.white, color:histFilter.season===val?C.white:C.text, border:`1px solid ${histFilter.season===val?C.blue:C.grayM}`, borderRadius:14, cursor:"pointer" }}>{lbl}</button>
              ))}
              {[0,7,2].map(n=>(
                <button key={n} onClick={()=>setHF(p=>({ ...p, nights:n }))} style={{ padding:"4px 10px", fontSize:10, fontWeight:histFilter.nights===n?700:400, background:histFilter.nights===n?C.purple:C.white, color:histFilter.nights===n?C.white:C.text, border:`1px solid ${histFilter.nights===n?C.purple:C.grayM}`, borderRadius:14, cursor:"pointer" }}>{n===0?"Toutes durées":n+"n"}</button>
              ))}
            </div>
            <p style={sml}>Historique par concurrent</p>
            <div style={cd()}>
              {competitors.filter(c=>c.property_type==="résidence").map((c,i,arr)=>(
                <div key={c.id} style={{ ...rw(i===arr.length-1), cursor:"pointer" }} onClick={()=>getHistoricalRates({ weekId:selWeekId, competitorId:c.id, capacity:capNum }).then(setHistory).catch(()=>{})}>
                  <span style={{ fontSize:12, fontWeight:500, color:C.text }}>{c.name}</span>
                  <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={C.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              ))}
            </div>
            {history.length===0&&<p style={{ fontSize:11, color:C.gray, textAlign:"center", padding:"12px 0", fontStyle:"italic" }}>L'historique sera utile après plusieurs relevés sur une même période.</p>}
            {history.length>0&&(()=>{
              const filtered=history.filter(r=>{
                if(histFilter.season&&r.season&&r.season!==histFilter.season) return false;
                if(histFilter.nights>0&&r.stay_nights&&r.stay_nights!==histFilter.nights) return false;
                return true;
              });
              return (<>
                <p style={sml}>Évolution · {filtered.length} relevé(s)</p>
                {filtered.length===0&&<p style={{ fontSize:11, color:C.gray, padding:"8px 0" }}>Aucun relevé pour ces filtres.</p>}
                <div style={cd()}>
                  {filtered.map((r,i)=>{
                    const prev=filtered[i-1]; const trend=prev?Number(r.price_week)-Number(prev.price_week):0;
                    const trendPct=prev&&prev.price_week?Math.round((trend/Number(prev.price_week))*100):0;
                    return (
                      <div key={r.id} style={rw(i===filtered.length-1)}>
                        <div>
                          <p style={{ margin:0, fontSize:12, fontWeight:500, color:C.text }}>{r.collected_at}</p>
                          <div style={{ display:"flex", gap:4, marginTop:2 }}>
                            <ReliaBadge status={r.reliability_status}/>
                            {r.promo_label&&<PromoBadge label={r.promo_label}/>}
                            {r.stay_nights===2&&<Badge label="2n" color={C.purple} bg={C.purpleL} size={8}/>}
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.text }}>{fmt(Number(r.price_week))}€/sem</p>
                          {trend!==0&&<p style={{ margin:0, fontSize:10, fontWeight:700, color:trend>0?C.red:C.green }}>{trend>0?"↑":"↓"} {fmt(Math.abs(trend))}€ ({trendPct>0?"+":""}{trendPct}%)</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>);
            })()}
          </>)}

          {/* ── TAB ANALYSE IA ── */}
          {tab==="reco"&&(<>
            <div style={{ ...cd(11), padding:"10px 13px", background:C.bluePale, marginTop:4, marginBottom:8 }}>
              <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:C.blueL }}>Analyse IA</p>
              <p style={{ margin:0, fontSize:10, color:C.blueL, lineHeight:1.5 }}>L'IA analyse uniquement les relevés validés pour cette semaine et cette capacité. Ne mélange pas 7 nuits et 2 nuits.</p>
              {reco.trustedCount<3&&<p style={{ margin:"4px 0 0", fontSize:10, color:C.orange, fontWeight:600 }}>⚠ Il faut au moins 3 relevés validés pour lancer une analyse IA fiable (actuellement {reco.trustedCount}).{reco.pendingCount>0?` ${reco.pendingCount} à vérifier dans l'onglet Concurrents.`:""}</p>}
            </div>
            <div style={{ ...cd(13), padding:"12px" }}>
              <p style={{ margin:"0 0 6px", fontSize:9, fontWeight:700, color:C.gray, textTransform:"uppercase" }}>Recommandation · médiane statistique</p>
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
            {!iaText&&<button style={btn(iaLoading||reco.trustedCount<3,C.blue)} onClick={runIA} disabled={iaLoading||reco.trustedCount<3}>{iaLoading?"Analyse…":reco.trustedCount<3?`Validez ${3-reco.trustedCount} relevé(s) de plus`:"Analyse IA →"}</button>}
            {iaLoading&&<div style={{ height:3, background:C.grayM, borderRadius:3, overflow:"hidden", marginBottom:8 }}><div style={{ height:"100%", background:C.blue, borderRadius:3, animation:"prog 4s linear forwards" }}/><style>{`@keyframes prog{from{width:0}to{width:100%}}`}</style></div>}
            {iaText&&<div>{[{t:"Positionnement",i:"📊"},{t:"Risques",i:"⚠"},{t:"Recommandation",i:"💡"},{t:"Action",i:"📱"}].map((s,idx)=>iaText[idx]&&<div key={idx} style={{ ...cd(11), padding:"10px 12px" }}><p style={{ margin:"0 0 3px", fontSize:9, fontWeight:700, color:C.gray, textTransform:"uppercase" }}>{s.i} {s.t}</p><p style={{ margin:0, fontSize:12, lineHeight:1.6, color:C.text }}>{iaText[idx]}</p></div>)}<button style={btn(false,C.grayL,C.blue)} onClick={()=>setIaText(null)}>Relancer</button></div>}
          </>)}

        </div><BNav/>
      </div>
    );
  };

  const Collect=()=>{
    if(collectMode==="copier-coller") return (
      <div><SBar title="Copier-coller"/>
        <div style={cnt}>
          <button onClick={()=>{ setCM(null); setPasteEdit(null); setPasteRaw(""); }} style={{ background:"none", border:"none", cursor:"pointer", color:C.blue, fontSize:13, padding:"8px 0" }}>← Retour</button>
          {!pasteEdit?(<>
            <div style={{ ...cd(11), padding:"10px 13px", background:C.bluePale, marginBottom:8 }}>
              <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:C.blueL }}>Mode copier-coller</p>
              <p style={{ margin:0, fontSize:10, color:C.blueL, lineHeight:1.5 }}>1. Ouvre Booking/Airbnb<br/>2. Sélectionne tout (Ctrl+A, Ctrl+C)<br/>3. Colle ici → extraction auto<br/>4. Valide avant enregistrement</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={sml}>Source</p><select value={pasteSrc} onChange={e=>setPasteSrc(e.target.value)} style={inp()}>{["Booking","Airbnb","Abritel","Vacancéole","Labellemontagne","Goélia","PAP"].map(s=><option key={s}>{s}</option>)}</select></div>
              <div><p style={sml}>Semaine</p><select value={pasteWeekId} onChange={e=>setPWId(e.target.value)} style={inp()}>{STATIC_WEEKS.map(w=><option key={w.id} value={w.id}>{w.label?.slice(0,14)} {w.year}</option>)}</select></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={sml}>Capacité</p><select value={pasteCap} onChange={e=>setPCap(parseInt(e.target.value))} style={inp()}>{[2,4,6,8].map(n=><option key={n} value={n}>{n} pers.</option>)}</select></div>
              <div><p style={sml}>Concurrent</p><select value={pasteCompId} onChange={e=>setPComp(e.target.value)} style={inp()}>{competitors.map(c=><option key={c.id} value={c.id}>{c.name.slice(0,22)}</option>)}</select></div>
            </div>
            <p style={sml}>Texte collé</p>
            <textarea value={pasteRaw} onChange={e=>setPasteRaw(e.target.value)} placeholder="Colle ici le texte de la page Booking, Airbnb…" style={{ width:"100%", minHeight:110, padding:"9px", fontSize:11, border:`1px solid ${C.grayM}`, borderRadius:10, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
            <button style={btn(!pasteRaw.trim(),C.purple)} onClick={handleParse} disabled={!pasteRaw.trim()}>🔍 Analyser le texte →</button>
          </>):(<>
            <div style={{ ...cd(11), padding:"10px 13px", background:pasteEdit.warning?C.orangeL:C.greenL, marginBottom:8 }}>
              <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:pasteEdit.warning?C.orange:C.green }}>{pasteEdit.warning?`⚠ ${pasteEdit.warning}`:"✓ Extraction réussie — vérifiez si nécessaire"}</p>
              {pasteEdit.allPrices?.length>0&&<p style={{ margin:0, fontSize:10, color:C.textS }}>Détectés : {pasteEdit.allPrices.map(p=>`${p}€`).join(" · ")}</p>}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={sml}>Prix / semaine € *</p><input type="number" style={inp()} value={pasteEdit.priceWeek} onChange={e=>setPasteEdit({ ...pasteEdit, priceWeek:e.target.value, priceNight:Math.round(parseFloat(e.target.value||0)/7) })}/></div>
              <div><p style={sml}>Prix / nuit €</p><input type="number" style={inp()} value={pasteEdit.priceNight} onChange={e=>setPasteEdit({ ...pasteEdit, priceNight:e.target.value })}/></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={sml}>Prix barré €</p><input type="number" style={inp()} value={pasteEdit.originalPrice} onChange={e=>setPasteEdit({ ...pasteEdit, originalPrice:e.target.value })}/></div>
              <div><p style={sml}>Frais ménage €</p><input type="number" style={inp()} value={pasteEdit.cleaningFee} onChange={e=>setPasteEdit({ ...pasteEdit, cleaningFee:e.target.value })}/></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={sml}>Promotion</p><select value={pasteEdit.promoLabel} onChange={e=>setPasteEdit({ ...pasteEdit, promoLabel:e.target.value })} style={inp()}><option value="">Aucune</option>{["Genius -10%","Last minute","Early booking","PDJ inclus","Annulation gratuite","-5%","-8%","-10%","-15%","-19%","-20%"].map(p=><option key={p} value={p}>{p}</option>)}</select></div>
              <div><p style={sml}>Note (/10)</p><input type="number" step="0.1" min="0" max="10" style={inp()} value={pasteEdit.rating} onChange={e=>setPasteEdit({ ...pasteEdit, rating:e.target.value })}/></div>
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
          <select value={form.weekId} onChange={e=>setForm({ ...form, weekId:e.target.value })} style={{ ...inp(), marginBottom:6 }}>{STATIC_WEEKS.map(w=><option key={w.id} value={w.id}>{w.label} {w.year}</option>)}</select>
          <p style={sml}>Concurrent *</p>
          <select value={form.competitorId} onChange={e=>{ const c=competitors.find(x=>x.id===e.target.value); setForm({ ...form, competitorId:e.target.value, source:c?.source||"", type:c?.property_type||"résidence" }); }} style={{ ...inp(), marginBottom:6 }}>{competitors.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
            <div><p style={sml}>Source</p><input style={inp()} placeholder="Booking…" value={form.source} onChange={e=>setForm({ ...form, source:e.target.value })}/></div>
            <div><p style={sml}>Capacité</p><select value={form.capacity} onChange={e=>setForm({ ...form, capacity:parseInt(e.target.value) })} style={inp()}>{[2,4,6,8].map(n=><option key={n} value={n}>{n} pers.</option>)}</select></div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
            <div><p style={sml}>Prix / semaine € *</p><input type="number" style={inp()} placeholder="650" value={form.priceWeek} onChange={e=>setForm({ ...form, priceWeek:e.target.value, priceNight:e.target.value?Math.round(parseFloat(e.target.value)/7):"" })}/></div>
            <div><p style={sml}>Prix barré €</p><input type="number" style={inp()} placeholder="Optionnel" value={form.originalPrice} onChange={e=>setForm({ ...form, originalPrice:e.target.value })}/></div>
          </div>
          <p style={sml}>Promotion</p>
          <select value={form.promoLabel} onChange={e=>setForm({ ...form, promoLabel:e.target.value })} style={{ ...inp(), marginBottom:6 }}><option value="">Aucune</option>{["Genius -10%","Remise 7 nuits -5%","Last minute","Early booking","PDJ inclus","Annulation gratuite","Promo -19%","-10%","-15%","-20%"].map(p=><option key={p} value={p}>{p}</option>)}</select>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
            <div><p style={sml}>Frais ménage €</p><input type="number" style={inp()} placeholder="0" value={form.cleaningFee} onChange={e=>setForm({ ...form, cleaningFee:e.target.value })}/></div>
            <div><p style={sml}>Date relevé *</p><input type="date" style={inp()} value={form.collectedAt} onChange={e=>setForm({ ...form, collectedAt:e.target.value })}/></div>
          </div>
          <div><p style={sml}>URL annonce</p><input style={{ ...inp(), marginBottom:6 }} placeholder="https://…" value={form.url} onChange={e=>setForm({ ...form, url:e.target.value })}/></div>
          <button style={btn(!form.priceWeek)} onClick={handleSaveForm} disabled={!form.priceWeek}>Enregistrer ✓</button>
          <p style={{ fontSize:9, color:C.gray, textAlign:"center" }}>Les anciens relevés ne sont jamais écrasés</p>
        </div><BNav/>
      </div>
    );
  };

  const ImportScreen=()=>(
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
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.gold }}>⊘ Doublons : {csvResult.dup}</p>
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.gray }}>⊝ Ignorées : {csvResult.skipped}</p>
            {csvResult.errors.map((e,i)=><p key={i} style={{ margin:0, fontSize:10, color:C.red }}>✗ {e}</p>)}
          </div>
        )}
        <p style={sml}>Coller le CSV</p>
        <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} placeholder={"week_start;source;property_name;property_type;capacity;price_week\n2026-08-01;Airbnb;Appt 6p La Foux;particulier;6;680"} style={{ width:"100%", minHeight:100, padding:"8px", fontSize:10, fontFamily:"monospace", border:`1px solid ${C.grayM}`, borderRadius:9, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setCsvText(ev.target.result); r.readAsText(f,"UTF-8"); }} style={{ display:"none" }}/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
          <button onClick={()=>fileRef.current?.click()} style={{ ...btn(false,C.grayL,C.text), margin:0 }}>📂 Fichier .CSV</button>
          <button onClick={()=>{ const template=["week_start;source;competitor_id;property_name;property_type;capacity;price_week;price_night;original_price;promo_label;promo_percent;cleaning_fee;url;collected_at;reliability_status","2026-08-01;Booking;cv;Les Chalets du Verdon;résidence;6;620;89;680;Genius -10%;10;0;https://booking.com;"+new Date().toISOString().slice(0,10)+";réel"].join("\n"); const b=new Blob([template],{ type:"text/csv;charset=utf-8" }); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download="template_benchmark_v2.csv"; a.click(); }} style={{ ...btn(false,C.grayL,C.blueL), margin:0, border:`1px solid ${C.blueL}` }}>⬇ Modèle CSV</button>
        </div>
        <button style={btn(csvLoading||!csvText.trim())} onClick={handleImportCsv} disabled={csvLoading||!csvText.trim()}>{csvLoading?"Import en cours…":"Importer →"}</button>
        {imports.length>0&&(<><p style={sml}>Imports précédents</p><div style={cd()}>{imports.slice(0,3).map((im,i)=><div key={im.id||i} style={rw(i===Math.min(imports.length,3)-1)}><div><p style={{ margin:0, fontSize:12, fontWeight:500, color:C.text }}>{im.import_source}</p><p style={{ margin:0, fontSize:10, color:C.gray }}>{im.imported_at?.slice(0,10)} · {im.rows_imported} lignes</p></div><Badge label={im.status?.toUpperCase()||"OK"} color={im.status==="ok"?C.green:C.orange} bg={im.status==="ok"?C.greenL:C.orangeL}/></div>)}</div></>)}

        {/* ══ IMPORT TARIFS LES CIMES (bloc distinct) ════════════ */}
        <div style={{ height:1, background:C.grayM, margin:"16px 0 4px" }}/>
        <div style={{ ...cd(11), padding:"10px 13px", background:C.bluePale, marginBottom:8 }}>
          <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:C.blue }}>💰 Importer tarifs Les Cimes</p>
          <p style={{ margin:0, fontSize:9, color:C.blueL, fontFamily:"monospace", lineHeight:1.6 }}>period_id · period_start · period_end · period_label · season · stay_nights · capacity · price_total · notes</p>
        </div>
        {ourCsvResult&&(
          <div style={{ ...cd(10), padding:"10px 12px", background:ourCsvResult.errors.length===0?C.greenL:C.goldL, marginBottom:8 }}>
            <p style={{ margin:"0 0 3px", fontSize:12, fontWeight:700, color:ourCsvResult.errors.length===0?C.green:C.gold }}>Résultat import tarifs Les Cimes</p>
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.green }}>✓ Importés : {ourCsvResult.ok}</p>
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.blue }}>↻ Mis à jour : {ourCsvResult.updated}</p>
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.gray }}>⊝ Ignorées : {ourCsvResult.skipped}</p>
            {ourCsvResult.errors.map((e,i)=><p key={i} style={{ margin:0, fontSize:10, color:C.red }}>✗ {e}</p>)}
          </div>
        )}
        <textarea value={ourCsvText} onChange={e=>setOurCsvText(e.target.value)} placeholder={"period_id;period_start;period_end;period_label;season;stay_nights;capacity;accommodation_type;price_total;notes\n2026_w2;2026-06-27;2026-07-04;27 juin → 3 juil;ete;7;6;2P6;340;Tarif été 2026"} style={{ width:"100%", minHeight:90, padding:"8px", fontSize:10, fontFamily:"monospace", border:`1px solid ${C.grayM}`, borderRadius:9, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
          <button onClick={()=>{ const tpl=["period_id;period_start;period_end;period_label;season;stay_nights;capacity;accommodation_type;price_total;notes","2026_w2;2026-06-27;2026-07-04;27 juin → 3 juil;ete;7;6;2P6;340;Tarif été 2026","2026_w3;2026-07-04;2026-07-11;4 juil → 10 juil;ete;7;8;3P8;460;Tarif été 2026"].join("\n"); const b=new Blob([tpl],{ type:"text/csv;charset=utf-8" }); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download="modele_tarifs_les_cimes.csv"; a.click(); }} style={{ ...btn(false,C.grayL,C.blueL), margin:0, border:`1px solid ${C.blueL}` }}>⬇ Modèle CSV tarifs</button>
          <button style={{ ...btn(ourCsvLoading||!ourCsvText.trim(),C.blue), margin:0 }} onClick={handleImportOurCsv} disabled={ourCsvLoading||!ourCsvText.trim()}>{ourCsvLoading?"Import…":"Importer tarifs →"}</button>
        </div>
      </div><BNav/>
    </div>
  );

  const Diagnostic=()=>{
    const qualified=rates.filter(r=>!r.is_example&&(r.comparability_score??50)>=settings.minScore);
    const excluded=rates.filter(r=>!r.is_example&&(r.comparability_score??50)<settings.minScore);
    const oldRates=rates.filter(r=>daysSince(r.collected_at)>settings.obsoleteDays);
    const noCompId=rates.filter(r=>!r.is_example&&!r.competitor_id);
    const lastImport=imports[0];
    const localKeys=Object.keys(localStorage).filter(k=>k.startsWith("rates_"));
    const totalLocal=localKeys.reduce((s,k)=>s+(ls.get(k).length),0);
    return (
      <div><SBar title="Diagnostic"/>
        <div style={cnt}>
          <p style={{ margin:"8px 0 4px", fontSize:14, fontWeight:700, color:C.text }}>État du système</p>
          <p style={sml}>Environnement</p>
          <div style={cd()}>
            {[{ l:"Supabase URL", v:SB_READY?"Oui":"Non (démo)", c:SB_READY?C.green:C.red },{ l:"Mode stockage", v:SB_READY?"Supabase":"Local", c:SB_READY?C.green:C.gold },{ l:"Session", v:user?.email||"Non connecté", c:user?C.green:C.red },{ l:"Token persistant", v:sessionStorage.getItem("sb_token")?"Oui":"Non", c:sessionStorage.getItem("sb_token")?C.green:C.gray }].map((r,i,arr)=>(
              <div key={r.l} style={rw(i===arr.length-1)}><span style={{ fontSize:11, color:C.text }}>{r.l}</span><span style={{ fontSize:10, fontWeight:600, color:r.c }}>{r.v}</span></div>
            ))}
          </div>
          <p style={sml}>Relevés · {selWeekId} · {cap}</p>
          <div style={cd()}>
            {[{ l:"Total chargés", v:rates.length, c:rates.length>0?C.green:C.red },{ l:`Qualifiés (≥${settings.minScore})`, v:qualified.length, c:qualified.length>=3?C.green:qualified.length>0?C.orange:C.red },{ l:"Exclus", v:excluded.length, c:excluded.length===0?C.green:C.orange },{ l:"Sans competitor_id", v:noCompId.length, c:noCompId.length===0?C.green:C.orange },{ l:`Obsolètes (>${settings.obsoleteDays}j)`, v:oldRates.length, c:oldRates.length===0?C.green:C.orange },{ l:"Stockés localement", v:totalLocal, c:totalLocal>0?C.blue:C.gray }].map((r,i,arr)=>(
              <div key={r.l} style={rw(i===arr.length-1)}><span style={{ fontSize:11, color:C.text }}>{r.l}</span><Badge label={String(r.v)} color={r.c} bg={r.c+"22"} size={11}/></div>
            ))}
          </div>
          <p style={sml}>Recommandation courante</p>
          <div style={cd()}>
            {[{ l:"Action", v:reco.action, c:reco.urgency==="normal"?C.green:reco.urgency==="haut"?C.red:C.orange },{ l:"Confiance", v:`${reco.confidence} (${reco.confScore}/100)`, c:{fort:C.green,moyen:C.orange,faible:C.red}[reco.confidence] },{ l:"Médiane", v:reco.ref?`${fmt(reco.ref)}€/sem`:"—", c:reco.ref?C.blue:C.gray },{ l:"Données obsolètes", v:reco.hasOld?"Oui":"Non", c:reco.hasOld?C.orange:C.green }].map((r,i,arr)=>(
              <div key={r.l} style={rw(i===arr.length-1)}><span style={{ fontSize:11, color:C.text }}>{r.l}</span><span style={{ fontSize:11, fontWeight:600, color:r.c }}>{r.v}</span></div>
            ))}
          </div>
          {lastImport&&(<><p style={sml}>Dernier import</p><div style={{ ...cd(11), padding:"10px 13px" }}><p style={{ margin:"0 0 2px", fontSize:12, fontWeight:500, color:C.text }}>{lastImport.import_source} · {lastImport.imported_at?.slice(0,10)}</p><div style={{ display:"flex", gap:8 }}><Badge label={`✓ ${lastImport.rows_imported}`} color={C.green} bg={C.greenL}/><Badge label={`⊘ ${lastImport.rows_duplicate||0}`} color={C.gold} bg={C.goldL}/></div></div></>)}
          {sbErrors.length>0&&(<><p style={sml}>Erreurs Supabase</p><div style={cd()}>{sbErrors.slice(-3).reverse().map((e,i,arr)=><div key={i} style={rw(i===arr.length-1)}><div><p style={{ margin:0, fontSize:11, color:C.red }}>{e.path}</p><p style={{ margin:0, fontSize:10, color:C.textS }}>{e.ts?.slice(11,19)} — {e.msg?.slice(0,60)}</p></div></div>)}</div></>)}
          <p style={sml}>Tarifs Les Cimes</p>
          <div style={cd()}>
            {[
              { l:"Tarifs Supabase (total)", v:String(ourRates.length), c:ourRates.length>0?C.green:C.gray },
              { l:"Tarif courant trouvé", v:currentOurRate?"Oui":"Non", c:currentOurRate?C.green:C.orange },
              { l:"Source tarif courant", v:ourRateSource, c:currentOurRate?C.green:C.gold },
              { l:"Dernière maj courante", v:currentOurRate?.updated_at?currentOurRate.updated_at.slice(0,10):"—", c:C.gray },
            ].map((r,i,arr)=>(
              <div key={r.l} style={rw(i===arr.length-1)}><span style={{ fontSize:11, color:C.text }}>{r.l}</span><span style={{ fontSize:11, fontWeight:600, color:r.c }}>{r.v}</span></div>
            ))}
          </div>
          <p style={sml}>Checklist production</p>
          <div style={cd()}>
            {[{ l:"VITE_SUPABASE_URL configuré", ok:SB_READY },{ l:"Mode Supabase actif", ok:SB_READY },{ l:"Session persistante", ok:!!sessionStorage.getItem("sb_token") },{ l:"Données exemple désactivées", ok:!showExamples },{ l:"≥3 relevés qualifiés", ok:qualified.length>=3 },{ l:"/api/analyse-reco déployée", ok:false, note:"Déployer avec ANTHROPIC_API_KEY." },{ l:"/api/scrape-market déployée", ok:false, note:"Voir api/scrape-market.js" },{ l:"/api/scrape-market-batch déployée", ok:false, note:"Voir api/scrape-market-batch.js" }].map((c,i,arr)=>(
              <div key={c.l} style={rw(i===arr.length-1)}><div><span style={{ fontSize:11, color:C.text }}>{c.l}</span>{c.note&&<p style={{ margin:"1px 0 0", fontSize:9, color:C.gray }}>{c.note}</p>}</div><Badge label={c.ok?"✓ OK":"✗ NON"} color={c.ok?C.green:C.red} bg={c.ok?C.greenL:C.redL}/></div>
            ))}
          </div>
        </div><BNav/>
      </div>
    );
  };

  const TrackPrices=()=>{
    const ctx = getTrackedPeriodContext();
    // Historique filtré
    const fltCompetitors = Array.from(new Set(histAll.map(r=>r.competitor||r.property_name).filter(Boolean))).sort();
    const fltSources = Array.from(new Set(histAll.map(r=>r.source).filter(Boolean))).sort();
    const filtered = histAll.filter(r=>{
      if(histFilters.competitor && (r.competitor||r.property_name)!==histFilters.competitor) return false;
      if(histFilters.source && r.source!==histFilters.source) return false;
      if(histFilters.capacity && Number(r.capacity)!==histFilters.capacity) return false;
      if(histFilters.status && (r.reliability_status||"à vérifier")!==histFilters.status) return false;
      if(histFilters.segment){
        const seg = (r.market_segment==="private"||r.is_private_rental===true) ? "private" : (String(r.property_type||"").toLowerCase().includes("hôtel")||String(r.property_type||"").toLowerCase().includes("hotel")) ? "hotel" : "residence";
        if(seg!==histFilters.segment) return false;
      }
      return true;
    });
    // Évolution vs relevé précédent (même concurrent/source/capacité/durée)
    const evoFor = (r, idx) => {
      const prev = filtered.slice(idx+1).find(x=>
        (x.competitor||x.property_name)===(r.competitor||r.property_name) &&
        (x.source_channel||x.source)===(r.source_channel||r.source) &&
        Number(x.capacity)===Number(r.capacity) &&
        Number(x.stay_nights||7)===Number(r.stay_nights||7));
      if(!prev) return null;
      const d = Number(r.price_total||r.price_week||0) - Number(prev.price_total||prev.price_week||0);
      return d;
    };
    return (
      <div><SBar title="Suivi prix"/>
        <div style={cnt}>
          {/* A. Relevé rapide → renvoie vers le module du Dashboard */}
          <div style={{ ...cd(11), padding:"11px 13px", background:C.bluePale, marginTop:8 }}>
            <p style={{ margin:"0 0 4px", fontSize:12, fontWeight:700, color:C.blue }}>📊 Suivi des prix concurrents</p>
            <p style={{ margin:0, fontSize:10, color:C.blueL, lineHeight:1.5 }}>Le relevé rapide (concurrents suivis, sources, dates, prix) se trouve dans le Dashboard. Cette page centralise l'historique de tous les relevés.</p>
            <button onClick={()=>setScreen("dashboard")} style={{ ...btn(false,C.blue), marginTop:8, marginBottom:0 }}>→ Aller au relevé rapide</button>
          </div>

          {/* B. Historique */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <p style={sml}>Historique des relevés</p>
            <button onClick={loadHistAll} style={{ fontSize:10, color:C.blue, background:"none", border:"none", cursor:"pointer", fontWeight:600, marginTop:12 }}>↻ Recharger</button>
          </div>

          <div style={{ display:"flex", gap:4, marginBottom:6, flexWrap:"wrap" }}>
            <select value={histFilters.competitor} onChange={e=>setHistFilters(f=>({ ...f, competitor:e.target.value }))} style={{ ...inp(), flex:"1 1 45%", fontSize:11, padding:"5px 7px" }}><option value="">Tous concurrents</option>{fltCompetitors.map(n=><option key={n} value={n}>{n}</option>)}</select>
            <select value={histFilters.source} onChange={e=>setHistFilters(f=>({ ...f, source:e.target.value }))} style={{ ...inp(), flex:"1 1 45%", fontSize:11, padding:"5px 7px" }}><option value="">Toutes sources</option>{fltSources.map(n=><option key={n} value={n}>{n}</option>)}</select>
            <select value={histFilters.capacity} onChange={e=>setHistFilters(f=>({ ...f, capacity:parseInt(e.target.value)||0 }))} style={{ ...inp(), flex:"1 1 45%", fontSize:11, padding:"5px 7px" }}><option value="0">Toutes cap.</option>{[2,4,6,8].map(n=><option key={n} value={n}>{n}P</option>)}</select>
            <select value={histFilters.status} onChange={e=>setHistFilters(f=>({ ...f, status:e.target.value }))} style={{ ...inp(), flex:"1 1 45%", fontSize:11, padding:"5px 7px" }}><option value="">Tous statuts</option>{["validé","à vérifier","rejeté"].map(n=><option key={n} value={n}>{n}</option>)}</select>
            <select value={histFilters.segment} onChange={e=>setHistFilters(f=>({ ...f, segment:e.target.value }))} style={{ ...inp(), flex:"1 1 45%", fontSize:11, padding:"5px 7px" }}><option value="">Tous segments</option><option value="residence">Résidences / Pros</option><option value="private">Particuliers</option><option value="hotel">Hôtels / secondaires</option></select>
          </div>

          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
            <span style={{ fontSize:10, color:C.gray }}>{filtered.length} relevé(s){filtered.length>200?" · 200 affichés":""}</span>
            <button onClick={()=>exportHistoryCsv(filtered)} disabled={!filtered.length} style={{ fontSize:10, fontWeight:700, color:filtered.length?C.white:C.gray, background:filtered.length?C.green:C.grayL, border:"none", borderRadius:6, padding:"5px 10px", cursor:filtered.length?"pointer":"default" }}>⬇ Exporter historique prix</button>
          </div>

          {histLoading&&<p style={{ textAlign:"center", padding:16, color:C.gray, fontSize:12 }}>Chargement…</p>}
          {!histLoading&&filtered.length===0&&<p style={{ textAlign:"center", padding:16, color:C.gray, fontSize:11, fontStyle:"italic" }}>Aucun relevé. Faites un relevé depuis le Dashboard.</p>}

          <div style={cd()}>
            {filtered.slice(0,200).map((r,idx,arr)=>{
              const evo = evoFor(r, idx);
              const nights = r.stay_nights||7;
              return (
                <div key={r.id||idx} style={rw(idx===Math.min(arr.length,200)-1)}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <span style={{ fontSize:11, fontWeight:600, color:C.text }}>{r.competitor||r.property_name}</span>
                    <div style={{ display:"flex", gap:4, marginTop:1, alignItems:"center", flexWrap:"wrap" }}>
                      {(()=>{ const priv=r.market_segment==="private"||r.is_private_rental===true; const hotel=String(r.property_type||"").toLowerCase().includes("hôtel")||String(r.property_type||"").toLowerCase().includes("hotel"); return <Badge label={priv?"Particulier":hotel?"Hôtel":"Pro"} color={priv?"#FF5A5F":hotel?C.purple:C.blue} bg={priv?"#FFE9EA":hotel?C.purpleL:C.bluePale} size={8}/>; })()}
                      <Badge label={r.source_label||r.source||"?"} color={C.blue} bg={C.bluePale} size={8}/>
                      {r.source_channel&&<span style={{ fontSize:8, color:C.gray }}>({r.source_channel})</span>}
                      <span style={{ fontSize:8, color:C.gray }}>{r.collected_at} · {r.capacity}P · {nights}n</span>
                      <ReliaBadge status={r.reliability_status||"à vérifier"}/>
                      {r.edited_at&&<span style={{ fontSize:8, color:C.gold, fontWeight:600 }}>modifié</span>}
                    </div>
                    <p style={{ margin:"1px 0 0", fontSize:8, color:C.gray }}>{r.period_start} → {r.period_end}</p>
                    {(r.source_url||r.source_search_url)&&<a href={r.source_url||r.source_search_url} target="_blank" rel="noreferrer" style={{ fontSize:8, color:C.blue, textDecoration:"none" }}>↗ source</a>}
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.text }}>{fmt(Number(r.price_total||r.price_week))}€</p>
                    <p style={{ margin:0, fontSize:8, color:C.gray }}>{fmt(Number(r.price_night||Math.round(Number(r.price_total||r.price_week||0)/nights)))}€/n</p>
                    {evo!==null&&<p style={{ margin:0, fontSize:9, fontWeight:700, color:evo>0?C.red:evo<0?C.green:C.gray }}>{evo>0?"+":""}{evo===0?"stable":fmt(evo)+"€"}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div><BNav/>
      </div>
    );
  };

  const BenchmarkDecision=()=>{
    const baseCtx = getTrackedPeriodContext();
    const acc = ACCOMMODATION_TYPES[benchAccType] || ACCOMMODATION_TYPES["2P6"];
    // La capacité de travail est imposée par la typologie choisie
    const ctx = { ...baseCtx, capacity: acc.capacity };
    const datesInvalid = !ctx.checkin || !ctx.checkout || !ctx.stayNights || ctx.stayNights<=0;
    // Tarif Les Cimes pour cette typologie (dates + durée + capacité + typologie)
    const benchOurRate = getOurRateForContext(ourRates, ctx, benchAccType);
    const benchFallback = OUR_TARIFS[`${acc.capacity}p`]?.[selWeek?.season_type] || 0;
    const benchOurPrice = benchOurRate
      ? Number(benchOurRate.price_total || benchOurRate.price_week || benchOurRate.price || 0)
      : benchFallback;
    const benchOurNight = benchOurPrice ? Math.round(benchOurPrice / ctx.stayNights) : 0;
    const benchOurSource = benchOurRate
      ? (benchOurRate.match_type==="dates+typologie" ? "Supabase · correspondance dates+typologie"
        : benchOurRate.match_type==="period_id+typologie" ? "Supabase · correspondance period_id+typologie"
        : benchOurRate.match_type==="dates" ? "Supabase · correspondance dates"
        : "Supabase · correspondance period_id")
      : "Grille interne fallback";
    // Famille d'une source (gère les anciens types)
    const famOf = ch => {
      if (ch==="booking"||ch==="direct"||ch==="tour_operator"||ch==="marketplace") return ch;
      if (ch==="maeva") return "tour_operator";
      if (ch==="airbnb"||ch==="abritel"||ch==="expedia") return "marketplace";
      return "other";
    };
    // Marché vérifié PRO (résidences) : sert à la médiane principale — exclut les particuliers
    const verified = (histAll||[]).filter(r=>
      !r.is_example &&
      TRUSTED_STATUSES.includes(r.reliability_status || "à vérifier") &&
      r.week_id===ctx.periodId &&
      Number(r.capacity)===Number(acc.capacity) &&
      Number(r.stay_nights||7)===Number(ctx.stayNights) &&
      r.market_segment!=="private" && r.is_private_rental!==true &&
      (!r.source_channel || benchSourceFilter[famOf(r.source_channel)] !== false)
    );
    // Marché PARTICULIERS : pression prix uniquement (ne pilote pas la médiane principale)
    const privateRates = (histAll||[]).filter(r=>
      !r.is_example &&
      TRUSTED_STATUSES.includes(r.reliability_status || "à vérifier") &&
      r.week_id===ctx.periodId &&
      Number(r.capacity)===Number(acc.capacity) &&
      Number(r.stay_nights||7)===Number(ctx.stayNights) &&
      (r.market_segment==="private" || r.is_private_rental===true)
    );
    const privPrices = privateRates.map(r=>Number(r.price_total||r.price_week||r.price||0)).filter(Boolean);
    const privMedian = median(privPrices);
    const privMin = privPrices.length ? Math.min(...privPrices) : null;
    const privGapPct = (benchOurPrice && privMedian) ? Math.round(((benchOurPrice - privMedian) / privMedian) * 100) : null;
    const privPressure = privGapPct==null ? "indéterminée" : privGapPct>30 ? "forte" : privGapPct>=15 ? "moyenne" : "faible";
    const dec = calcBenchmarkDecision({ ourPrice:benchOurPrice, marketRates:verified, stayNights:ctx.stayNights });
    const priceOf = r => Number(r.price_total||r.price_week||r.price||0);
    const usedSources = Array.from(new Set(verified.map(r=>r.source).filter(Boolean)));
    const actChoices = [["increase","Augmenter"],["promo","Baisser / promo"],["maintain","Maintenir"],["surveiller","Surveiller"],["need_data","Relevés insuffisants"]];
    const prioColor = p => p==="high"?C.red:p==="medium"?C.orange:C.green;

    async function submitDecision() {
      setDecSaving(true); setDecMsg(null);
      try {
        await saveCommercialDecision({
          period_id: ctx.periodId, period_label: ctx.label, period_start: ctx.checkin, period_end: ctx.checkout,
          stay_nights: ctx.stayNights, capacity: ctx.capacity,
          our_price_before: benchOurPrice||null,
          our_price_after: parseFloat(decForm.our_price_after)||null,
          direct_price: parseFloat(decForm.direct_price)||null,
          market_median: dec.marketMedian||null, market_min: dec.marketMin||null, market_max: dec.marketMax||null,
          validated_rates_count: dec.validatedCount||0,
          action_type: decForm.action_type, action_label: (actChoices.find(a=>a[0]===decForm.action_type)||[])[1]||decForm.action_type,
          priority: dec.priority||"normal",
          decision_status: decForm.decision_status||"à faire",
          notes: decForm.notes ? `[${acc.label}] ${decForm.notes}` : `[${acc.label}]`,
        });
        await reloadDecisions();
        setDecMsg("ok");
        setDecForm({ action_type:"maintain", our_price_after:"", direct_price:"", decision_status:"à faire", notes:"" });
      } catch(e) { setDecMsg("err:"+e.message); }
      setDecSaving(false);
      setTimeout(()=>setDecMsg(null),3000);
    }

    return (
      <div><SBar title="Benchmark & décisions"/>
        <div style={cnt}>
          {/* A. Sélecteur de travail (même sélecteur que le relevé) */}
          <div style={{ ...cd(11), padding:"10px 12px", marginTop:8 }}>
            <p style={{ margin:"0 0 6px", fontSize:11, fontWeight:700, color:C.blue }}>Période de travail</p>
            <div style={{ display:"flex", gap:4, marginBottom:8 }}>
              {[["period","Période 7 nuits"],["custom","Dates personnalisées"]].map(([v,l])=>(
                <button key={v} onClick={()=>setTrackedMode(v)} style={{ flex:1, padding:"6px 4px", fontSize:10, fontWeight:trackedMode===v?700:400, background:trackedMode===v?C.blue:C.white, color:trackedMode===v?C.white:C.text, border:`1px solid ${trackedMode===v?C.blue:C.grayM}`, borderRadius:8, cursor:"pointer" }}>{l}</button>
              ))}
            </div>
            {trackedMode==="period" ? (<>
              <div style={formGrid}>
                <div>
                  <p style={{ ...sml, margin:"0 0 4px" }}>Saison</p>
                  <select value={trackedSeason} onChange={e=>setTrackedSeason(e.target.value)} style={inp()}><option value="ete">Été</option><option value="hiver">Hiver</option><option value="all">Toutes</option></select>
                </div>
                <div>
                  <p style={{ ...sml, margin:"0 0 4px" }}>Durée</p>
                  <select value={trackedStayNights} onChange={e=>setTrackedStayNights(Number(e.target.value))} style={inp()}><option value={7}>7 nuits</option><option value={2}>2 nuits</option></select>
                </div>
              </div>
              <p style={{ ...sml, margin:"8px 0 4px" }}>Période</p>
              <select value={trackedPeriodId} onChange={e=>setTrackedPeriodId(e.target.value)} style={inp()}>
                {trackedAvailablePeriods.length===0&&<option value="">Aucune période</option>}
                {trackedAvailablePeriods.map(p=><option key={p.id} value={p.id}>{periodOptionLabel(p)}</option>)}
              </select>
            </>) : (
              <div style={formGrid}>
                <div><p style={{ ...sml, margin:"0 0 4px" }}>Arrivée</p><input type="date" value={trackedCheckin} onChange={e=>setTrackedCheckin(e.target.value)} style={inp()}/></div>
                <div><p style={{ ...sml, margin:"0 0 4px" }}>Départ</p><input type="date" value={trackedCheckout} onChange={e=>setTrackedCheckout(e.target.value)} style={inp()}/></div>
              </div>
            )}
            <div style={{ ...cd(9), padding:"7px 10px", background:C.bluePale, marginTop:8 }}>
              <p style={{ margin:0, fontSize:9, color:C.blue, fontWeight:600 }}>Capacité liée à la typologie : {acc.capacity}P ({acc.label})</p>
            </div>
            <p style={{ margin:"6px 0 0", fontSize:9, color:datesInvalid?C.red:C.gray }}>{datesInvalid?"Dates invalides : vérifiez arrivée et départ.":`${trackedMode==="custom"?"Dates personnalisées":ctx.label} · ${acc.capacity}P · ${ctx.stayNights} nuits`}</p>
          </div>

          {/* Filtre sources incluses */}
          <div style={{ ...cd(11), padding:"9px 12px" }}>
            <p style={{ ...sml, margin:"0 0 5px" }}>Sources incluses</p>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {[["booking","Booking"],["direct","Direct"],["tour_operator","Tour opérateurs"],["marketplace","Marketplaces"],["other","Autres"]].map(([k,l])=>(
                <button key={k} onClick={()=>setBenchSourceFilter(f=>({ ...f, [k]:!f[k] }))} style={{ fontSize:10, fontWeight:benchSourceFilter[k]?700:400, color:benchSourceFilter[k]?C.white:C.gray, background:benchSourceFilter[k]?C.blue:C.grayL, border:"none", borderRadius:14, padding:"5px 11px", cursor:"pointer" }}>{benchSourceFilter[k]?"✓ ":""}{l}</button>
              ))}
            </div>
          </div>

          {/* Typologie Les Cimes + occupation cible */}
          <div style={{ ...cd(11), padding:"9px 12px" }}>
            <div style={formGrid}>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Typologie Les Cimes</p>
                <select value={benchAccType} onChange={e=>setBenchAccType(e.target.value)} style={inp()}>
                  {Object.entries(ACCOMMODATION_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Occupation cible</p>
                <select value={benchOccupancy} onChange={e=>setBenchOccupancy(Number(e.target.value))} style={inp()}>
                  {[2,4,6,8].map(n=><option key={n} value={n}>{n} personnes</option>)}
                </select>
              </div>
            </div>
            <p style={{ margin:"6px 0 0", fontSize:8, color:C.gray }}>{ACCOMMODATION_TYPES[benchAccType]?.surfaceMin}–{ACCOMMODATION_TYPES[benchAccType]?.surfaceMax} m² · cible {ACCOMMODATION_TYPES[benchAccType]?.targetMin}–{ACCOMMODATION_TYPES[benchAccType]?.targetMax} pers. · segment {ACCOMMODATION_TYPES[benchAccType]?.segment}</p>
          </div>

          {/* B + C : cartes */}
          <div style={responsiveGrid(2)}>
            <div style={{ ...cd(11,0), padding:"10px 12px", background:C.bluePale }}>
              <p style={{ margin:"0 0 1px", fontSize:8, color:C.blueL, fontWeight:700, textTransform:"uppercase" }}>Nos tarifs Les Cimes</p>
              <p style={{ margin:"0 0 2px", fontSize:9, color:C.blueL }}>Typologie : <strong>{acc.label}</strong> · Capacité : <strong>{acc.capacity}P</strong></p>
              {benchOurPrice>0?(<>
                <p style={{ margin:0, fontSize:18, fontWeight:700, color:C.blue }}>{fmt(benchOurPrice)}€<span style={{ fontSize:10 }}>/séjour</span></p>
                <p style={{ margin:0, fontSize:10, color:C.blueL }}>{fmt(benchOurNight)}€/nuit · {benchOurSource}</p>
                {(()=>{ const ppn=pricePerPersonNight(benchOurPrice, ctx.stayNights, benchOccupancy); return ppn?<p style={{ margin:"1px 0 0", fontSize:10, color:C.blueL, fontWeight:600 }}>{fmt(ppn)}€/pers/nuit ({benchOccupancy}P)</p>:null; })()}
              </>):(<p style={{ margin:0, fontSize:13, color:C.gray, fontStyle:"italic" }}>Tarif {acc.label} à définir</p>)}
              <button onClick={()=>{ setScreen("dashboard"); setDashTarifTab("saisie"); setDashOurPeriodId(selWeekId); setDashOurCap(acc.capacity); }} style={{ ...btn(false,C.white,C.blue), margin:"7px 0 0", border:`1px solid ${C.blueL}`, padding:"6px" }}>Modifier tarif</button>
            </div>
            <div style={{ ...cd(11,0), padding:"10px 12px", background:dec.validatedCount>=3?C.greenL:C.goldL }}>
              <p style={{ margin:"0 0 1px", fontSize:8, color:dec.validatedCount>=3?C.green:C.gold, fontWeight:700, textTransform:"uppercase" }}>Marché vérifié ({dec.validatedCount})</p>
              {dec.marketMedian?(<>
                <p style={{ margin:0, fontSize:18, fontWeight:700, color:C.text }}>{fmt(dec.marketMedian)}€<span style={{ fontSize:10 }}>médiane</span></p>
                <p style={{ margin:0, fontSize:10, color:C.gray }}>min {fmt(dec.marketMin)}€ · max {fmt(dec.marketMax)}€</p>
                {usedSources.length>0&&<p style={{ margin:"2px 0 0", fontSize:8, color:C.gray }}>Sources : {usedSources.join(", ")}</p>}
              </>):(<p style={{ margin:0, fontSize:11, color:C.gold }}>Pas assez de relevés validés.</p>)}
            </div>
          </div>

          {/* Marché pro vs particuliers */}
          <div style={responsiveGrid(2)}>
            <div style={{ ...cd(11,0), padding:"9px 11px", background:C.bluePale }}>
              <p style={{ margin:"0 0 2px", fontSize:8, color:C.blueL, fontWeight:700, textTransform:"uppercase" }}>🏢 Marché pro (médiane principale)</p>
              <p style={{ margin:0, fontSize:10, color:C.blue }}>{dec.validatedCount} relevés{dec.marketMedian?` · médiane ${fmt(dec.marketMedian)}€`:""}</p>
              {dec.marketMedian&&<p style={{ margin:0, fontSize:9, color:C.blueL }}>min {fmt(dec.marketMin)}€ · max {fmt(dec.marketMax)}€</p>}
            </div>
            <div style={{ ...cd(11,0), padding:"9px 11px", background:"#FFE9EA" }}>
              <p style={{ margin:"0 0 2px", fontSize:8, color:"#C2185B", fontWeight:700, textTransform:"uppercase" }}>🏠 Marché particuliers (pression)</p>
              <p style={{ margin:0, fontSize:10, color:"#FF5A5F" }}>{privateRates.length} relevés{privMedian?` · médiane ${fmt(privMedian)}€`:""}</p>
              {privMedian&&<p style={{ margin:0, fontSize:9, color:"#C2185B" }}>min {fmt(privMin)}€</p>}
            </div>
          </div>

          {/* Bloc pression particuliers */}
          {privateRates.length>0&&(
            <div style={{ ...cd(11), padding:"10px 12px", borderLeft:`3px solid ${privPressure==="forte"?C.red:privPressure==="moyenne"?C.orange:C.green}` }}>
              <p style={{ margin:"0 0 4px", fontSize:11, fontWeight:700, color:C.text }}>⚠ Pression des particuliers : <span style={{ color:privPressure==="forte"?C.red:privPressure==="moyenne"?C.orange:C.green }}>{privPressure}</span></p>
              <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:5 }}>
                <span style={{ fontSize:9, color:C.gray }}>Annonces suivies : <strong>{(catalog||[]).filter(isPrivateCompetitor).length}</strong></span>
                <span style={{ fontSize:9, color:C.gray }}>Prix validés : <strong>{privPrices.length}</strong></span>
                {privMin&&<span style={{ fontSize:9, color:C.gray }}>Mini particulier : <strong>{fmt(privMin)}€</strong></span>}
                {privMedian&&<span style={{ fontSize:9, color:C.gray }}>Médiane : <strong>{fmt(privMedian)}€</strong></span>}
                {privGapPct!=null&&<span style={{ fontSize:9, color:C.gray }}>Écart Les Cimes : <strong style={{ color:privGapPct>0?C.red:C.green }}>{privGapPct>0?"+":""}{privGapPct}%</strong></span>}
              </div>
              <p style={{ margin:0, fontSize:8, color:C.gray, fontStyle:"italic" }}>Les particuliers servent d'alerte prix, mais ne doivent pas piloter seuls la grille tarifaire.</p>
            </div>
          )}
          <p style={sml}>Concurrents validés</p>
          {verified.length===0?(
            <div style={{ ...cd(11), padding:"12px", textAlign:"center", border:`2px dashed ${C.grayM}` }}>
              <p style={{ margin:"0 0 8px", fontSize:11, color:C.gray }}>Aucun relevé validé pour ce contexte.</p>
              <button onClick={()=>setScreen("track")} style={{ ...btn(false,C.blue), width:"auto", padding:"7px 14px", margin:0 }}>Faire un relevé prix →</button>
            </div>
          ):(
            <div style={cd()}>
              {verified.map(r=>({ r, sc:scoreRateForAccommodation(r, benchAccType) }))
                .sort((a,b)=>b.sc.score-a.sc.score)
                .map(({r,sc},i,arr)=>{
                const pt=priceOf(r); const gap=ourPrice?ourPrice-pt:null;
                const segColor = sc.segment==="Comparable"?C.green:sc.segment==="Premium"?C.purple:sc.segment==="Secondaire"?C.gray:C.orange;
                const segBg = sc.segment==="Comparable"?C.greenL:sc.segment==="Premium"?C.purpleL:sc.segment==="Secondaire"?C.grayL:C.orangeL;
                const ppn = pricePerPersonNight(pt, r.stay_nights||7, benchOccupancy);
                return (
                  <div key={r.id||i} style={rw(i===arr.length-1)}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <span style={{ fontSize:11, fontWeight:600, color:C.text }}>{r.competitor||r.property_name}</span>
                      <div style={{ display:"flex", gap:4, marginTop:1, alignItems:"center", flexWrap:"wrap" }}>
                        <Badge label={r.source||"?"} color={C.blue} bg={C.bluePale} size={8}/>
                        <Badge label={sc.segment} color={segColor} bg={segBg} size={8}/>
                        <span style={{ fontSize:8, color:C.gray }}>{r.property_type} · score {sc.score}</span>
                      </div>
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.text }}>{fmt(pt)}€</p>
                      <p style={{ margin:0, fontSize:8, color:C.gray }}>{fmt(Math.round(pt/(r.stay_nights||7)))}€/n{ppn?` · ${fmt(ppn)}€/p/n`:""}</p>
                      {gap!==null&&<p style={{ margin:0, fontSize:9, fontWeight:700, color:gap>0?C.green:C.red }}>{gap>0?"+":""}{fmt(gap)}€</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* E. Décision recommandée */}
          <div style={{ ...cd(11), padding:"11px 13px", background:dec.actionType==="need_data"?C.goldL:dec.actionType==="increase"?C.greenL:dec.actionType==="promo"?C.orangeL:C.bluePale, marginTop:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.text }}>{dec.actionLabel}</p>
              <Badge label={dec.priority} color={prioColor(dec.priority)} bg={C.white} size={9}/>
            </div>
            {dec.actionType==="need_data"?(
              <p style={{ margin:0, fontSize:10, color:C.gold }}>Validez au moins 3 relevés pour une recommandation fiable.</p>
            ):(<>
              <p style={{ margin:0, fontSize:11, color:C.text }}>Prix public conseillé : <strong>{fmt(dec.recommendedPrice)}€</strong> · Prix direct : <strong>{fmt(dec.directPrice)}€</strong></p>
              {dec.gapPct!==null&&<p style={{ margin:"2px 0 0", fontSize:9, color:C.gray }}>Écart actuel vs médiane : {dec.gapPct>0?"+":""}{dec.gapPct}%{dec.potentialGain?` · gain potentiel ${dec.potentialGain>0?"+":""}${fmt(dec.potentialGain)}€`:""}</p>}
            </>)}
            {accommodationAdvice(benchAccType)&&<p style={{ margin:"6px 0 0", paddingTop:6, borderTop:`0.5px solid ${C.grayM}`, fontSize:9, color:C.text, fontStyle:"italic" }}>💡 {accommodationAdvice(benchAccType)}</p>}
          </div>

          {/* F. Enregistrer décision */}
          <p style={sml}>Enregistrer une décision commerciale</p>
          <div style={{ ...cd(11), padding:"11px 13px" }}>
            <div style={formGrid}>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Action</p>
                <select value={decForm.action_type} onChange={e=>setDecForm(f=>({ ...f, action_type:e.target.value }))} style={inp()}>{actChoices.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
              </div>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Statut</p>
                <select value={decForm.decision_status} onChange={e=>setDecForm(f=>({ ...f, decision_status:e.target.value }))} style={inp()}>{["à faire","appliqué","annulé"].map(s=><option key={s} value={s}>{s}</option>)}</select>
              </div>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Nouveau prix public</p>
                <input type="number" style={inp()} placeholder={dec.recommendedPrice?String(dec.recommendedPrice):"735"} value={decForm.our_price_after} onChange={e=>setDecForm(f=>({ ...f, our_price_after:e.target.value }))}/>
              </div>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Prix direct conseillé</p>
                <input type="number" style={inp()} placeholder={dec.directPrice?String(dec.directPrice):"705"} value={decForm.direct_price} onChange={e=>setDecForm(f=>({ ...f, direct_price:e.target.value }))}/>
              </div>
            </div>
            <p style={{ ...sml, margin:"8px 0 4px" }}>Note</p>
            <input style={{ ...inp(), marginBottom:8 }} placeholder="ex : aligner sur Labellemontagne" value={decForm.notes} onChange={e=>setDecForm(f=>({ ...f, notes:e.target.value }))}/>
            {decMsg==="ok"&&<div style={{ ...cd(8), padding:"7px 10px", background:C.greenL, marginBottom:6 }}><p style={{ margin:0, fontSize:11, fontWeight:600, color:C.green }}>✓ Décision enregistrée</p></div>}
            {decMsg?.startsWith("err")&&<div style={{ ...cd(8), padding:"7px 10px", background:C.redL, marginBottom:6 }}><p style={{ margin:0, fontSize:11, color:C.red }}>✗ {decMsg.slice(4)}</p></div>}
            <button onClick={submitDecision} disabled={decSaving} style={btn(decSaving,C.blue)}>{decSaving?"Enregistrement…":"Enregistrer la décision"}</button>
          </div>

          {/* Historique des décisions */}
          <p style={sml}>Historique des décisions</p>
          {decisions.length===0&&<p style={{ fontSize:11, color:C.gray, textAlign:"center", padding:"12px 0", fontStyle:"italic" }}>Aucune décision enregistrée.</p>}
          <div style={cd()}>
            {decisions.slice(0,50).map((d,i,arr)=>(
              <div key={d.id||i} style={{ padding:"9px 12px", borderBottom:i===Math.min(arr.length,50)-1?"none":`0.5px solid ${C.grayL}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <span style={{ fontSize:11, fontWeight:600, color:C.text }}>{d.action_label||d.action_type}</span>
                    <div style={{ display:"flex", gap:4, marginTop:1, alignItems:"center", flexWrap:"wrap" }}>
                      <span style={{ fontSize:8, color:C.gray }}>{(d.created_at||"").slice(0,10)} · {d.period_label||d.period_id} · {d.capacity}P</span>
                      <Badge label={d.decision_status} color={d.decision_status==="appliqué"?C.green:d.decision_status==="annulé"?C.red:C.orange} bg={d.decision_status==="appliqué"?C.greenL:d.decision_status==="annulé"?C.redL:C.goldL} size={8}/>
                    </div>
                    <p style={{ margin:"2px 0 0", fontSize:9, color:C.gray }}>{d.our_price_before?`${fmt(Number(d.our_price_before))}€`:"—"} → {d.our_price_after?`${fmt(Number(d.our_price_after))}€`:"—"}{d.direct_price?` · direct ${fmt(Number(d.direct_price))}€`:""}</p>
                    {d.notes&&<p style={{ margin:"1px 0 0", fontSize:8, color:C.gray, fontStyle:"italic" }}>{d.notes}</p>}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:3, flexShrink:0 }}>
                    {d.decision_status!=="appliqué"&&<button onClick={async()=>{ await updateCommercialDecision(d.id,{ decision_status:"appliqué", applied_at:new Date().toISOString() }); reloadDecisions(); }} style={{ fontSize:8, fontWeight:700, color:C.green, background:C.greenL, border:"none", borderRadius:5, padding:"3px 6px", cursor:"pointer" }}>✓ Appliqué</button>}
                    <button onClick={async()=>{ await deleteCommercialDecision(d.id); reloadDecisions(); }} style={{ fontSize:8, color:C.gray, background:C.grayL, border:"none", borderRadius:5, padding:"3px 6px", cursor:"pointer" }}>🗑</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div><BNav/>
      </div>
    );
  };

  const Promotions=()=>{
    const acc = ACCOMMODATION_TYPES[promoAccType] || ACCOMMODATION_TYPES["2P6"];
    const capacity = acc.capacity;
    const n = Number(promoStayNights);
    // Contexte dates : 7 nuits = période samedi→samedi ; 2/3/4 = dates perso
    let checkin = promoCheckin, checkout = promoCheckout, periodId, label;
    if (n===7) {
      const per = trackedAvailablePeriods[0] || ALL_PERIODS.find(p=>p.season===promoSeason && Number(p.stay_nights||7)===7);
      // on réutilise le sélecteur de période du module via trackedPeriodId si dispo
      const chosen = ALL_PERIODS.find(p=>p.id===trackedPeriodId && Number(p.stay_nights)===7) || per;
      if (chosen) { checkin = chosen.period_start||chosen.week_start; checkout = chosen.period_end||addDaysStr(checkin,7); periodId = chosen.id; label = chosen.label||`${checkin} → ${checkout}`; }
    } else {
      if (checkin && !checkout) checkout = addDaysStr(checkin, n);
      if (checkin && checkout) { periodId = `promo_${checkin}_${checkout}_${capacity}p`; label = `${checkin} → ${checkout}`; }
    }
    const datesInvalid = !checkin || !checkout || daysBetween(checkin,checkout)<=0;
    const stayNights = n;
    const todayStr = dateObjToISO(new Date());
    const daysToArrival = checkin ? daysBetween(todayStr, checkin) : null;
    const famOf = ch => {
      if (ch==="booking"||ch==="direct"||ch==="tour_operator"||ch==="marketplace") return ch;
      if (ch==="maeva") return "tour_operator";
      if (ch==="airbnb"||ch==="abritel"||ch==="expedia") return "marketplace";
      return "other";
    };
    // Marché validé PRO : correspondance par DATES, durée, capacité, sources (exclut particuliers)
    const verified = (histAll||[]).filter(r=>
      !r.is_example &&
      TRUSTED_STATUSES.includes(r.reliability_status||"à vérifier") &&
      String(r.period_start||"")===String(checkin||"") &&
      String(r.period_end||"")===String(checkout||"") &&
      Number(r.stay_nights||7)===stayNights &&
      Number(r.capacity)===capacity &&
      r.market_segment!=="private" && r.is_private_rental!==true &&
      (!r.source_channel || promoSourceFilter[famOf(r.source_channel)] !== false)
    );
    // Marché particuliers : pression prix
    const privRates = (histAll||[]).filter(r=>
      !r.is_example &&
      TRUSTED_STATUSES.includes(r.reliability_status||"à vérifier") &&
      String(r.period_start||"")===String(checkin||"") &&
      String(r.period_end||"")===String(checkout||"") &&
      Number(r.stay_nights||7)===stayNights &&
      Number(r.capacity)===capacity &&
      (r.market_segment==="private" || r.is_private_rental===true)
    );
    const privPrices = privRates.map(r=>Number(r.price_total||r.price_week||r.price||0)).filter(Boolean);
    const privMed = median(privPrices);
    // Tarif semaine de référence Les Cimes (toujours 7 nuits, même typologie/capacité, mêmes dates de début si possible)
    const weeklyRate = getOurRateForContext(ourRates, { periodId, checkin, checkout:checkin?addDaysStr(checkin,7):checkout, stayNights:7, capacity }, promoAccType)
                    || getOurRateForContext(ourRates, { periodId, checkin, checkout, stayNights:7, capacity }, promoAccType);
    const weeklyPrice = weeklyRate ? Number(weeklyRate.price_total||weeklyRate.price_week||weeklyRate.price||0) : 0;
    const weeklyNight = weeklyPrice ? Math.round(weeklyPrice/7) : 0;
    // Règle court séjour
    const ssRule = findShortStayRule(shortStayRules, promoAccType, promoSeason, stayNights);
    // Prix Les Cimes : court séjour calculé depuis le prix semaine (ou tarif direct si 7 nuits)
    const ourShortPrice = stayNights===7
      ? weeklyPrice
      : (weeklyPrice ? calcShortStayOurPrice({ weeklyPrice, stayNights, rule:ssRule }) : 0);
    const ourPrice = ourShortPrice;
    const privGap = (ourPrice && privMed) ? Math.round(((ourPrice - privMed) / privMed) * 100) : null;
    const privPressure = privGap==null ? null : privGap>30 ? "forte" : privGap>=15 ? "moyenne" : "faible";
    // Recommandation court séjour (marché pro prioritaire)
    const ssReco = calcShortStayPromoRecommendation({ ourShortPrice, marketRates:verified, privateRates:privRates, stayNights, rule:ssRule });
    const opp = {
      promoType: ssReco.promoType, promoLabel: ssRule?.stay_label || (stayNights===7?"Semaine 7 nuits":`${stayNights} nuits`),
      marketMedian: ssReco.marketMedian, validatedCount: ssReco.validatedCount,
      recommendedPrice: ssReco.recommendedPrice, directPrice: ssReco.directPrice,
      priority: ssReco.pressure==="forte"?"high":ssReco.pressure==="moyenne"?"medium":"normal",
      needData: ssReco.needData, pressure: ssReco.pressure, explanation: ssReco.explanation,
    };
    const usableSources = (catalog||[]).flatMap(c=>sourcesForCompetitor(c).map(s=>s.source_name));
    const distinctSources = Array.from(new Set(usableSources));
    const promoColor = t => t==="last_minute"?C.red:(t==="weekend"||t==="week_end")?C.purple:t==="court_sejour"?C.orange:C.blue;

    async function saveOpp() {
      const message = buildPromoMessage({ promo_type:opp.promoType, stay_nights:stayNights, pressure:opp.pressure });
      try {
        await savePromoOpportunity({
          period_id:periodId, period_label:label, period_start:checkin, period_end:checkout, stay_nights:stayNights,
          accommodation_type:promoAccType, capacity,
          our_price:ourPrice||null, market_median:opp.marketMedian||null,
          recommended_price:opp.recommendedPrice||null, direct_price:opp.directPrice||null,
          promo_type:opp.promoType, promo_label:opp.promoLabel, priority:opp.priority||"normal",
          source_summary:distinctSources.slice(0,6).join(", "),
          suggested_message:message,
          status:"à étudier", notes:null,
        });
        await reloadPromoOpps(); setPromoMsg("ok"); setTimeout(()=>setPromoMsg(null),3000);
      } catch(e) { setPromoMsg("err:"+e.message); }
    }

    return (
      <div><SBar title="Promotions & courts séjours"/>
        <div style={cnt}>
          <div style={{ ...cd(11), padding:"11px 13px", background:C.purpleL, marginTop:8 }}>
            <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.purple }}>🎯 Promotions & courts séjours</p>
            <p style={{ margin:"2px 0 0", fontSize:10, color:C.purple }}>Analyse des offres marché par durée et propositions promo (nuitée, week-end, mid-week, dernière minute).</p>
          </div>

          {/* Sélecteurs */}
          <div style={{ ...cd(11), padding:"10px 12px" }}>
            <p style={{ ...sml, margin:"0 0 4px" }}>Durée analysée</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4, marginBottom:8 }}>
              {[2,3,4,7].map(d=><button key={d} onClick={()=>setPromoStayNights(d)} style={{ padding:"6px 0", background:n===d?C.purple:C.grayL, border:"none", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:n===d?700:400, color:n===d?C.white:C.text }}>{d}n</button>)}
            </div>
            <div style={formGrid}>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Typologie</p>
                <select value={promoAccType} onChange={e=>setPromoAccType(e.target.value)} style={inp()}>{Object.entries(ACCOMMODATION_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select>
              </div>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Saison</p>
                <select value={promoSeason} onChange={e=>setPromoSeason(e.target.value)} style={inp()}><option value="ete">Été</option><option value="hiver">Hiver</option></select>
              </div>
            </div>
            {n===7 ? (<>
              <p style={{ ...sml, margin:"8px 0 4px" }}>Période (samedi → samedi)</p>
              <select value={trackedPeriodId} onChange={e=>setTrackedPeriodId(e.target.value)} style={inp()}>
                {ALL_PERIODS.filter(p=>p.season===promoSeason && Number(p.stay_nights||7)===7).map(p=><option key={p.id} value={p.id}>{periodOptionLabel(p)}</option>)}
              </select>
            </>) : (
              <div style={{ ...formGrid, marginTop:8 }}>
                <div><p style={{ ...sml, margin:"0 0 4px" }}>Arrivée</p><input type="date" value={promoCheckin} onChange={e=>setPromoCheckin(e.target.value)} style={inp()}/></div>
                <div><p style={{ ...sml, margin:"0 0 4px" }}>Départ</p><input type="date" value={promoCheckout} onChange={e=>setPromoCheckout(e.target.value)} style={inp()}/></div>
              </div>
            )}
            <p style={{ margin:"6px 0 0", fontSize:9, color:datesInvalid?C.red:C.gray }}>{datesInvalid?"Choisissez des dates valides.":`${label} · ${capacity}P · ${stayNights} nuits${daysToArrival!=null?` · J-${daysToArrival}`:""}`}</p>
            {distinctSources.length>0&&<p style={{ margin:"4px 0 0", fontSize:8, color:C.gray }}>Sources marché suivies : {distinctSources.slice(0,8).join(", ")}</p>}
          </div>

          {/* Filtre sources incluses */}
          <div style={{ ...cd(11), padding:"9px 12px" }}>
            <p style={{ ...sml, margin:"0 0 5px" }}>Sources incluses</p>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {[["booking","Booking"],["direct","Direct"],["tour_operator","Tour opérateurs"],["marketplace","Marketplaces"],["other","Autres"]].map(([k,l])=>(
                <button key={k} onClick={()=>setPromoSourceFilter(f=>({ ...f, [k]:!f[k] }))} style={{ fontSize:10, fontWeight:promoSourceFilter[k]?700:400, color:promoSourceFilter[k]?C.white:C.gray, background:promoSourceFilter[k]?C.purple:C.grayL, border:"none", borderRadius:14, padding:"5px 11px", cursor:"pointer" }}>{promoSourceFilter[k]?"✓ ":""}{l}</button>
              ))}
            </div>
          </div>

          {/* Alerte pression particuliers */}
          {privPressure==="forte"&&(
            <div style={{ ...cd(11), padding:"10px 12px", borderLeft:`3px solid ${C.red}`, background:"#FFE9EA" }}>
              <p style={{ margin:"0 0 3px", fontSize:11, fontWeight:700, color:C.red }}>⚠ Pression particuliers forte ({privGap>0?"+":""}{privGap}% vs médiane particuliers)</p>
              <p style={{ margin:0, fontSize:9, color:"#C2185B" }}>Les particuliers sont agressifs sur cette période. Réponse conseillée : créer une offre directe courte durée (2-3 nuits) ou dernière minute plutôt que baisser toute la grille semaine. Mettez en avant les services inclus (piscine, sauna, résidence, accueil, wifi).</p>
            </div>
          )}

          {/* Proposition */}
          {opp.needData ? (
            <div style={{ ...cd(11), padding:"12px", textAlign:"center", border:`2px dashed ${C.grayM}` }}>
              <p style={{ margin:"0 0 8px", fontSize:11, color:C.gray }}>Relevés insuffisants pour cette durée ({opp.validatedCount}/3). Lancez un relevé concurrents suivis.</p>
              <button onClick={()=>{ if(!datesInvalid){ setTrackedMode("custom"); setTrackedStayNights(stayNights); setTrackedCheckin(checkin); setTrackedCheckout(checkout); setTrackedCapacity(capacity); setTrackedSeason(promoSeason); } setScreen("dashboard"); }} disabled={datesInvalid} style={{ ...btn(datesInvalid,C.blue), width:"auto", padding:"7px 14px", margin:0 }}>Faire un relevé sur ces dates</button>
            </div>
          ) : (
            <div style={{ ...cd(11), padding:"12px 13px", borderLeft:`3px solid ${promoColor(opp.promoType)}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.text }}>{opp.promoType==="last_minute"?"🔥 ":"🎯 "}{opp.promoLabel}</p>
                <Badge label={opp.priority} color={opp.priority==="high"?C.red:opp.priority==="medium"?C.orange:C.green} bg={C.grayL} size={9}/>
              </div>
              <p style={{ margin:0, fontSize:10, color:C.gray }}>{acc.label} · {label}</p>
              {/* Référence semaine → court séjour Les Cimes */}
              <div style={{ ...cd(8), padding:"7px 10px", background:C.bluePale, margin:"6px 0" }}>
                {weeklyPrice>0?(<>
                  <p style={{ margin:0, fontSize:9, color:C.blueL }}>Prix semaine référence : <strong>{fmt(weeklyPrice)}€</strong> · {fmt(weeklyNight)}€/nuit</p>
                  {stayNights!==7&&<p style={{ margin:"1px 0 0", fontSize:10, color:C.blue, fontWeight:700 }}>{stayNights} nuits court séjour calculé : {fmt(ourShortPrice)}€{ssRule?` (×${ssRule.multiplier})`:""}</p>}
                  {ssRule&&<p style={{ margin:"1px 0 0", fontSize:8, color:C.gray }}>Règle : {ssRule.stay_label} · multiplicateur {ssRule.multiplier}{ssRule.min_price?` · plancher ${fmt(ssRule.min_price)}€`:""}</p>}
                </>):(<p style={{ margin:0, fontSize:9, color:C.gray, fontStyle:"italic" }}>Aucun tarif semaine {acc.label} pour ces dates — définissez-le dans Gestion tarifs.</p>)}
              </div>
              <div style={{ margin:"6px 0", display:"flex", gap:14, flexWrap:"wrap" }}>
                <div><p style={{ margin:0, fontSize:8, color:C.gray }}>Marché pro</p><p style={{ margin:0, fontSize:14, fontWeight:700, color:C.text }}>{fmt(opp.marketMedian)}€</p></div>
                <div><p style={{ margin:0, fontSize:8, color:C.gray }}>Conseillé</p><p style={{ margin:0, fontSize:14, fontWeight:700, color:C.blue }}>{fmt(opp.recommendedPrice)}€</p></div>
                <div><p style={{ margin:0, fontSize:8, color:C.gray }}>Direct</p><p style={{ margin:0, fontSize:14, fontWeight:700, color:C.green }}>{fmt(opp.directPrice)}€</p></div>
                {ourShortPrice>0&&<div><p style={{ margin:0, fontSize:8, color:C.gray }}>Notre court séjour</p><p style={{ margin:0, fontSize:14, fontWeight:700, color:C.gray }}>{fmt(ourShortPrice)}€</p></div>}
              </div>
              {opp.explanation&&<p style={{ margin:"0 0 6px", fontSize:8, color:C.gray, fontStyle:"italic" }}>{opp.explanation}</p>}
              <div style={{ ...cd(8), padding:"7px 10px", background:C.grayL, marginBottom:8 }}>
                <p style={{ margin:0, fontSize:10, color:C.text, fontStyle:"italic" }}>"{buildPromoMessage({ promo_type:opp.promoType, stay_nights:stayNights, pressure:opp.pressure })}"</p>
              </div>
              {promoMsg==="ok"&&<p style={{ margin:"0 0 6px", fontSize:11, color:C.green, fontWeight:600 }}>✓ Opportunité enregistrée</p>}
              {promoMsg?.startsWith("err")&&<p style={{ margin:"0 0 6px", fontSize:11, color:C.red }}>✗ {promoMsg.slice(4)}</p>}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                <button onClick={saveOpp} style={{ ...btn(false,C.purple), margin:0 }}>Enregistrer opportunité</button>
                <button onClick={()=>setPromoMsgPreview({ kind:"facebook", text:buildPromoMessage({ promo_type:opp.promoType, stay_nights:stayNights, pressure:opp.pressure }) })} style={{ ...btn(false,C.blue), margin:0 }}>Message Facebook</button>
                <button onClick={()=>setPromoMsgPreview({ kind:"email", text:buildPromoMessage({ promo_type:opp.promoType, stay_nights:stayNights, pressure:opp.pressure }) })} style={{ ...btn(false,C.white,C.blue), margin:0, border:`1px solid ${C.blueL}` }}>Email promo</button>
                <button onClick={()=>setPromoMsgPreview(null)} style={{ ...btn(false,C.grayL,C.text), margin:0 }}>Effacer aperçu</button>
              </div>
              {promoMsgPreview&&(
                <div style={{ ...cd(8), padding:"9px 11px", marginTop:8, background:C.bluePale }}>
                  <p style={{ margin:"0 0 4px", fontSize:9, fontWeight:700, color:C.blue, textTransform:"uppercase" }}>{promoMsgPreview.kind==="email"?"Email promo":"Post Facebook"}</p>
                  {promoMsgPreview.kind==="email"&&<p style={{ margin:"0 0 4px", fontSize:10, color:C.text }}><strong>Objet :</strong> {opp.promoLabel} aux Cimes du Val d'Allos — {fmt(opp.directPrice)}€</p>}
                  <p style={{ margin:0, fontSize:10, color:C.text, whiteSpace:"pre-wrap" }}>{promoMsgPreview.text}{"\n\n"}📅 {label} · {capacity} personnes{"\n"}💶 À partir de {fmt(opp.directPrice)}€ en réservation directe{"\n"}📞 Réservez dès maintenant !</p>
                </div>
              )}
            </div>
          )}

          {/* Historique des opportunités */}
          <p style={sml}>Opportunités enregistrées</p>
          {promoOpps.length===0&&<p style={{ fontSize:11, color:C.gray, textAlign:"center", padding:"12px 0", fontStyle:"italic" }}>Aucune opportunité enregistrée.</p>}
          <div style={cd()}>
            {promoOpps.slice(0,50).map((o,i,arr)=>(
              <div key={o.id||i} style={{ padding:"9px 12px", borderBottom:i===Math.min(arr.length,50)-1?"none":`0.5px solid ${C.grayL}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <span style={{ fontSize:11, fontWeight:600, color:C.text }}>{o.promo_label||o.promo_type}</span>
                    <div style={{ display:"flex", gap:4, marginTop:1, alignItems:"center", flexWrap:"wrap" }}>
                      <span style={{ fontSize:8, color:C.gray }}>{(o.created_at||"").slice(0,10)} · {o.accommodation_type} · {o.capacity}P · {o.stay_nights}n</span>
                    </div>
                    <p style={{ margin:"1px 0 0", fontSize:9, color:C.gray }}>{o.period_label||o.period_id} · conseillé {fmt(Number(o.recommended_price||0))}€ · direct {fmt(Number(o.direct_price||0))}€</p>
                  </div>
                  <div style={{ flexShrink:0 }}>
                    <select value={o.status||"à étudier"} onChange={async e=>{ await updatePromoOpportunity(o.id,{ status:e.target.value }); reloadPromoOpps(); }} style={{ ...inp(), fontSize:9, padding:"4px 6px" }}>
                      {["à étudier","à publier","publié","ignoré"].map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={async()=>{ await deletePromoOpportunity(o.id); reloadPromoOpps(); }} style={{ marginTop:4, width:"100%", fontSize:8, color:C.gray, background:C.grayL, border:"none", borderRadius:5, padding:"3px 6px", cursor:"pointer" }}>🗑</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div><BNav/>
      </div>
    );
  };

 return (
  <div style={appShell}>
    <div style={appContainer}>
      {!user && (
        <LoginScreen
          loginErr={loginErr}
          SB_READY={SB_READY}
          loginEmail={loginEmail}
          setLE={setLE}
          loginPwd={loginPwd}
          setLP={setLP}
          loginLoading={loginLoading}
          handleLogin={handleLogin}
        />
      )}

      {user && isDesktop && (
        <div style={mainGrid}>
          <SideNav/>
          <div style={ph}>
            {screen === "dashboard" && Dashboard()}
            {screen === "weeks" && Weeks()}
            {screen === "week" && WeekDetail()}
            {screen === "collect" && Collect()}
            {screen === "benchmark" && BenchmarkDecision()}
            {screen === "promotions" && Promotions()}
            {screen === "tarifs" && TarifsLesCimes()}
            {screen === "competitors_residence" && CompetitorsSegmentScreen({ segment: "residence" })}
            {screen === "competitors_private" && CompetitorsSegmentScreen({ segment: "private" })}
            {screen === "track" && TrackPrices()}
            {screen === "import" && ImportScreen()}
            {screen === "diag" && Diagnostic()}
          </div>
        </div>
      )}

      {user && isMobile && (
        <div style={ph}>
          {screen === "dashboard" && Dashboard()}
          {screen === "weeks" && Weeks()}
          {screen === "week" && WeekDetail()}
          {screen === "collect" && Collect()}
            {screen === "benchmark" && BenchmarkDecision()}
            {screen === "promotions" && Promotions()}
            {screen === "tarifs" && TarifsLesCimes()}
            {screen === "competitors_residence" && CompetitorsSegmentScreen({ segment: "residence" })}
            {screen === "competitors_private" && CompetitorsSegmentScreen({ segment: "private" })}
            {screen === "track" && TrackPrices()}
          {screen === "import" && ImportScreen()}
          {screen === "diag" && Diagnostic()}
        </div>
      )}
    </div>
  </div>
);
}

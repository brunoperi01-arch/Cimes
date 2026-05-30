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

async function saveOurRate(rate) {
  const stayNights = Number(rate.stay_nights || 7);
  const priceTotal = Number(rate.price_total || 0);
  if (!priceTotal) throw new Error("Prix total manquant.");
  if (!rate.period_id || !rate.capacity) throw new Error("Période et capacité requises.");
  const priceNight = rate.price_night ? Number(rate.price_night) : Math.round(priceTotal / stayNights);
  const payload = {
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

  if (SB_READY) {
    const filter = [
      `period_id=eq.${encodeURIComponent(payload.period_id)}`,
      `capacity=eq.${encodeURIComponent(payload.capacity)}`,
      `stay_nights=eq.${encodeURIComponent(payload.stay_nights)}`,
      `select=id`,
    ].join("&");
    const existing = await sb.select("our_rates", filter);
    if (existing?.length) {
      return await sb.update("our_rates", `id=eq.${existing[0].id}`, payload);
    }
    return await sb.insert("our_rates", payload);
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
  const payload = {
    name:                String(item.name).trim(),
    property_type:       item.property_type || "résidence",
    platform:            item.platform || "Booking.com",
    booking_url:         item.booking_url || null,
    search_location:     item.search_location || "La Foux d'Allos",
    comparability_score: Number(item.comparability_score || 80),
    notes:               item.notes || null,
    is_active:           item.is_active !== false,
  };
  if (SB_READY) {
    if (item.id) return await sb.update("competitor_catalog", `id=eq.${item.id}`, { ...payload, updated_at:new Date().toISOString() });
    return await sb.insert("competitor_catalog", payload);
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
    try {
      await saveCompetitorCatalogItem({
        name:o.name, property_type:o.property_type||"résidence", platform:o.platform||"Booking.com",
        booking_url:o.booking_url||null, search_location:o.search_location||"La Foux d'Allos",
        comparability_score:parseFloat(o.comparability_score)||80, notes:o.notes||null,
      });
      ok++;
    } catch(e) { errors.push(e.message); }
  }
  return { ok, skipped, errors:errors.slice(0,4) };
}

// Lien Booking fiable pour un concurrent suivi (URL exacte si fournie)
function buildTrackedBookingUrl(competitor, period, capacity) {
  const checkin = period.period_start || period.week_start;
  const checkout = period.period_end || addDaysStr(checkin, period.stay_nights || 7);
  const baseUrl = competitor.booking_url || "https://www.booking.com/searchresults.html";
  const params = new URLSearchParams({
    checkin,
    checkout,
    group_adults: String(capacity),
    no_rooms: "1",
    group_children: "0",
  });
  if (baseUrl.includes("booking.com/searchresults")) {
    params.set("ss", competitor.search_location || competitor.name || "La Foux d'Allos");
  }
  return baseUrl.includes("?") ? `${baseUrl}&${params.toString()}` : `${baseUrl}?${params.toString()}`;
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
  const [catSaving, setCatSaving]         = useState(false);
  const [catCsvText, setCatCsvText]       = useState("");
  const [catCsvResult, setCatCsvResult]   = useState(null);
  const [catVerifyPrice, setCatVerifyPrice] = useState({});
  const [catSaved, setCatSaved]           = useState({});
  const [ourForm, setOurForm]             = useState({ priceTotal:"", notes:"" });
  const [ourSaving, setOurSaving]         = useState(false);
  const [ourSaved, setOurSaved]           = useState(null);
  const [ourCsvText, setOurCsvText]       = useState("");
  const [ourCsvResult, setOurCsvResult]   = useState(null);
  const [ourCsvLoading, setOurCsvLoading] = useState(false);

  // ── Dashboard : gestion tarifs Les Cimes ──────────────────────
  const [dashTarifTab, setDashTarifTab]   = useState("saisie"); // saisie | import | liste
  const [dashOurPeriodId, setDashOurPeriodId] = useState("2026_w7");
  const [dashOurCap, setDashOurCap]       = useState(6);
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
  const currentOurRate = ourRates.find(r =>
    r.period_id === selWeekId &&
    Number(r.capacity) === capNum &&
    Number(r.stay_nights || 7) === Number(_nights) &&
    r.is_active !== false
  );
  const fallbackOurPrice = OUR_TARIFS[cap]?.[selWeek?.season_type] || 0;
  const ourPrice = currentOurRate?.price_total ? Number(currentOurRate.price_total) : fallbackOurPrice;
  const ourNight = ourPrice ? Math.round(ourPrice / _nights) : 0;
  const ourRateSource = currentOurRate ? "Supabase" : "Grille interne fallback";
  const reco     = calcReco(ourPrice,rates,settings);

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

  async function reloadOurRates() { try { const d=await getOurRates(); setOurRates(d||[]); } catch {} }

  // ── Concurrents suivis : chargement + handlers ────────────────
  async function reloadCatalog() { try { const d=await getCompetitorCatalog(); setCatalog(d||[]); } catch {} }

  async function handleSaveCatalogItem() {
    if (!catForm?.name?.trim()) return;
    setCatSaving(true);
    try {
      await saveCompetitorCatalogItem(catForm);
      await reloadCatalog();
      setCatForm(null);
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

  // Enregistre un relevé vérifié pour un concurrent suivi (validé immédiatement)
  async function saveTrackedRate(competitor, period, capacity, verifiedPrice, key) {
    const price = Number(verifiedPrice)||0;
    if (!price || isOwnProperty(competitor.name)) return;
    const nights = period.stay_nights || 7;
    const checkin = period.period_start || period.week_start;
    const checkout = period.period_end || addDaysStr(checkin, nights);
    try {
      await saveCompetitorRate({
        week_id:            period.id,
        source:             "Booking.com",
        property_name:      competitor.name,
        competitor:         competitor.name,
        property_type:      competitor.property_type || "résidence",
        competitor_id:      null,
        comparability_score:competitor.comparability_score || 80,
        capacity:           Number(capacity),
        price:              price,
        price_week:         price,
        price_total:        price,
        price_night:        Math.round(price / nights),
        price_week_equiv:   Math.round((price / nights) * 7),
        stay_nights:        nights,
        period_start:       checkin,
        period_end:         checkout,
        season:             period.season || "ete",
        source_url:         buildTrackedBookingUrl(competitor, period, capacity),
        source_search_url:  buildTrackedBookingUrl(competitor, period, capacity),
        collected_at:       new Date().toISOString().slice(0,10),
        collection_type:    "relevé manuel Booking",
        reliability_status: "validé",
        validated_at:       new Date().toISOString(),
        validation_notes:   "Prix vérifié manuellement sur Booking",
        is_example:         false,
      }, competitors);
      setCatSaved(p=>({ ...p, [key]:"ok" }));
      setCatVerifyPrice(p=>({ ...p, [key]:"" }));
      if (period.id===selWeekId && Number(capacity)===capNum) loadRates();
    } catch(e) {
      setCatSaved(p=>({ ...p, [key]:e.message?.includes("DUPLICATE")?"dup":"err" }));
    }
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
  const ph  ={ width:390, margin:"0 auto", fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", background:C.grayL, minHeight:760, borderRadius:44, overflow:"hidden", border:`0.5px solid ${C.grayM}` };
  const sbar={ height:46, display:"flex", alignItems:"flex-end", justifyContent:"space-between", padding:"0 20px 6px", background:C.grayL };
  const cnt ={ padding:"0 14px 80px" };
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

  const NAV=[{id:"dashboard",icon:"▣",l:"Dashboard"},{id:"weeks",icon:"📅",l:"Périodes"},{id:"collect",icon:"✏️",l:"Saisie"},{id:"import",icon:"📥",l:"Import"},{id:"diag",icon:"🔬",l:"Diagnostic"}];
  const BNav=()=>(
    <div style={{ position:"sticky", bottom:0, background:C.white, borderTop:`0.5px solid ${C.grayM}`, display:"flex", padding:"6px 0 16px", zIndex:10 }}>
      {NAV.map(n=>(
        <button key={n.id} onClick={()=>{ setScreen(n.id); setCM(null); setIaText(null); setPasteEdit(null); }} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
          <span style={{ fontSize:16 }}>{n.icon}</span>
          <span style={{ fontSize:9, fontWeight:screen===n.id?700:400, color:screen===n.id?C.blue:C.gray }}>{n.l}</span>
        </button>
      ))}
    </div>
  );

  // ══ ÉCRANS ════════════════════════════════════════════════════
  const Dashboard=()=>{
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
    return (
    <div><SBar title="Dashboard"/>
      <div style={{ background:`linear-gradient(135deg,${C.blue},${C.blueL})`, padding:"10px 16px 16px" }}>
        <p style={{ margin:0, fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.5)", textTransform:"uppercase" }}>Les Cimes du Val d'Allos · Veille tarifaire</p>
        <h1 style={{ margin:"2px 0", fontSize:18, fontWeight:700, color:C.white }}>Benchmark {yr}</h1>
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
          <p style={{ margin:0, fontSize:10, color:SB_READY?C.green:C.gold }}>{SB_READY?"Session restaurée au refresh.":"Configurer VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY."}</p>
        </div>
        <div style={{ ...cd(11), padding:"10px 13px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><p style={{ margin:0, fontSize:13, fontWeight:500, color:C.text }}>Données exemple</p><p style={{ margin:0, fontSize:10, color:C.textS }}>Désactiver en production</p></div>
          <button onClick={()=>setSE(p=>!p)} style={{ width:44, height:26, borderRadius:13, background:showExamples?C.blue:C.grayM, border:"none", cursor:"pointer", position:"relative" }}>
            <div style={{ position:"absolute", top:3, left:showExamples?21:3, width:20, height:20, borderRadius:"50%", background:C.white, transition:"left 0.15s" }}/>
          </button>
        </div>
        <p style={sml}>Accès rapides</p>
        <div style={cd()}>
          {[{ icon:"✏️", l:"Saisir un relevé", s:"collect", m:"manuelle" },{ icon:"📋", l:"Copier-coller Booking/Airbnb", s:"collect", m:"copier-coller" },{ icon:"📥", l:"Importer un CSV", s:"import" },{ icon:"🔬", l:"Diagnostic système", s:"diag" }].map((item,i,arr)=>(
            <div key={i} style={{ ...rw(i===arr.length-1), cursor:"pointer" }} onClick={()=>{ setScreen(item.s); if(item.m) setCM(item.m); }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}><span style={{ fontSize:16 }}>{item.icon}</span><span style={{ fontSize:13, fontWeight:500, color:C.text }}>{item.l}</span></div>
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={C.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          ))}
        </div>

        {/* ══ GESTION TARIFS LES CIMES ══════════════════════════ */}
        <p style={sml}>💰 Gestion tarifs Les Cimes</p>

        {/* Mini résumé */}
        <div style={{ ...cd(11), padding:"10px 13px", background:C.bluePale, marginBottom:8 }}>
          <p style={{ margin:"0 0 3px", fontSize:13, fontWeight:700, color:C.blue }}>{(ourRates||[]).filter(r=>r.is_active!==false).length} tarif(s) saisi(s)</p>
          <p style={{ margin:0, fontSize:10, color:C.blueL }}>Période courante : {selWeek?.label} · {cap}</p>
          <p style={{ margin:"1px 0 0", fontSize:10, color:C.blueL }}>Source : <strong>{ourRateSource}</strong>{ourPrice>0?` · ${fmt(ourPrice)}€/séjour · ${fmt(ourNight)}€/nuit`:""}</p>
          {currentOurRate?.updated_at&&<p style={{ margin:"1px 0 0", fontSize:9, color:C.gray }}>Dernière maj : {currentOurRate.updated_at.slice(0,10)}</p>}
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", background:C.grayM, padding:2, borderRadius:9, marginBottom:8 }}>
          {[["saisie","Saisie rapide"],["import","Import CSV"],["liste","Tarifs enregistrés"]].map(([id,lbl])=>(
            <button key={id} style={tabB(dashTarifTab===id)} onClick={()=>setDashTarifTab(id)}>{lbl}</button>
          ))}
        </div>

        {/* ── Saisie rapide ── */}
        {dashTarifTab==="saisie"&&(
          <div style={{ ...cd(11), padding:"11px 13px" }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Période</p>
                <select value={dashOurPeriodId} onChange={e=>setDashOurPeriodId(e.target.value)} style={inp()}>
                  <optgroup label="Été 7 nuits">
                    {ALL_PERIODS.filter(p=>p.season==="ete").map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
                  </optgroup>
                  <optgroup label="Hiver 7 nuits">
                    {ALL_PERIODS.filter(p=>p.season==="hiver"&&(p.stay_nights||7)===7).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
                  </optgroup>
                  <optgroup label="Hiver 2 nuits">
                    {ALL_PERIODS.filter(p=>p.season==="hiver"&&p.stay_nights===2).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Capacité</p>
                <select value={dashOurCap} onChange={e=>setDashOurCap(parseInt(e.target.value))} style={inp()}>{[2,4,6,8].map(n=><option key={n} value={n}>{n}P</option>)}</select>
              </div>
            </div>
            <div style={{ display:"flex", gap:5, marginBottom:6, flexWrap:"wrap" }}>
              <span style={{ fontSize:9, background:C.grayL, color:C.gray, padding:"3px 7px", borderRadius:6 }}>Durée : {dashNights} nuits</span>
              <span style={{ fontSize:9, background:C.grayL, color:C.gray, padding:"3px 7px", borderRadius:6 }}>{dashPeriod?.season==="hiver"?"Hiver":"Été"}</span>
              {ALL_PERIODS.find(p=>p.id===dashOurPeriodId)&&ourRates.find(r=>r.period_id===dashOurPeriodId&&Number(r.capacity)===Number(dashOurCap)&&Number(r.stay_nights||7)===dashNights)&&<span style={{ fontSize:9, background:C.greenL, color:C.green, padding:"3px 7px", borderRadius:6, fontWeight:700 }}>existant · sera mis à jour</span>}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Prix total séjour € *</p>
                <input type="number" style={inp()} placeholder="340" value={dashOurPrice} onChange={e=>setDashOurPrice(e.target.value)}/>
              </div>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Prix / nuit (auto)</p>
                <input type="text" disabled style={{ ...inp(), background:C.grayL, color:C.gray }} value={dashOurPrice?dashPriceNight+"€/nuit":"—"}/>
              </div>
            </div>
            <p style={{ ...sml, margin:"0 0 4px" }}>Notes (optionnel)</p>
            <input style={{ ...inp(), marginBottom:8 }} placeholder="ex : grille été 2026" value={dashOurNotes} onChange={e=>setDashOurNotes(e.target.value)}/>
            {dashOurSaved==="ok"&&<div style={{ ...cd(8), padding:"7px 10px", background:C.greenL, marginBottom:6 }}><p style={{ margin:0, fontSize:11, fontWeight:600, color:C.green }}>✓ Tarif enregistré</p></div>}
            {dashOurSaved?.startsWith("err")&&<div style={{ ...cd(8), padding:"7px 10px", background:C.redL, marginBottom:6 }}><p style={{ margin:0, fontSize:11, color:C.red }}>✗ {dashOurSaved.slice(4)}</p></div>}
            <button style={btn(dashOurSaving||!dashOurPrice,C.blue)} onClick={handleDashSaveOurRate} disabled={dashOurSaving||!dashOurPrice}>{dashOurSaving?"Enregistrement…":"Enregistrer tarif Les Cimes"}</button>
          </div>
        )}

        {/* ── Import CSV ── */}
        {dashTarifTab==="import"&&(
          <div style={{ ...cd(11), padding:"11px 13px" }}>
            <p style={{ margin:"0 0 4px", fontSize:11, fontWeight:700, color:C.blue }}>Importer grille tarifaire Les Cimes</p>
            <p style={{ margin:"0 0 6px", fontSize:9, color:C.gray, fontFamily:"monospace", lineHeight:1.5 }}>period_id;period_start;period_end;period_label;season;stay_nights;capacity;price_total;notes</p>
            {ourCsvResult&&(
              <div style={{ ...cd(8), padding:"8px 10px", background:ourCsvResult.errors.length===0?C.greenL:C.goldL, marginBottom:6 }}>
                <p style={{ margin:"0 0 1px", fontSize:11, color:C.green }}>✓ Importés : {ourCsvResult.ok}</p>
                <p style={{ margin:"0 0 1px", fontSize:11, color:C.blue }}>↻ Mis à jour : {ourCsvResult.updated}</p>
                <p style={{ margin:"0 0 1px", fontSize:11, color:C.gray }}>⊝ Ignorées : {ourCsvResult.skipped}</p>
                {ourCsvResult.errors.map((e,i)=><p key={i} style={{ margin:0, fontSize:10, color:C.red }}>✗ {e}</p>)}
              </div>
            )}
            <textarea value={ourCsvText} onChange={e=>setOurCsvText(e.target.value)} placeholder={"2026_w2;2026-06-27;2026-07-04;27 juin → 3 juil;ete;7;6;340;Tarif été 2026"} style={{ width:"100%", minHeight:80, padding:"8px", fontSize:10, fontFamily:"monospace", border:`1px solid ${C.grayM}`, borderRadius:9, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              <button onClick={()=>{ const tpl=["period_id;period_start;period_end;period_label;season;stay_nights;capacity;price_total;notes","2026_w2;2026-06-27;2026-07-04;27 juin → 3 juil;ete;7;6;340;Tarif été 2026","2026_w3;2026-07-04;2026-07-11;4 juil → 10 juil;ete;7;6;360;Tarif été 2026"].join("\n"); const b=new Blob([tpl],{ type:"text/csv;charset=utf-8" }); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download="modele_tarifs_les_cimes.csv"; a.click(); }} style={{ ...btn(false,C.grayL,C.blueL), margin:0, border:`1px solid ${C.blueL}` }}>⬇ Modèle CSV</button>
              <button style={{ ...btn(ourCsvLoading||!ourCsvText.trim(),C.blue), margin:0 }} onClick={handleImportOurCsv} disabled={ourCsvLoading||!ourCsvText.trim()}>{ourCsvLoading?"Import…":"Importer tarifs"}</button>
            </div>
          </div>
        )}

        {/* ── Tarifs enregistrés ── */}
        {dashTarifTab==="liste"&&(
          <div>
            <div style={{ display:"flex", gap:4, marginBottom:8, flexWrap:"wrap" }}>
              {[[0,"Toutes années"],[2026,"2026"],[2027,"2027"]].map(([v,l])=>(
                <button key={l} onClick={()=>setDashListFilter(f=>({ ...f, year:v }))} style={{ padding:"4px 9px", fontSize:10, fontWeight:dashListFilter.year===v?700:400, background:dashListFilter.year===v?C.blue:C.white, color:dashListFilter.year===v?C.white:C.text, border:`1px solid ${dashListFilter.year===v?C.blue:C.grayM}`, borderRadius:14, cursor:"pointer" }}>{l}</button>
              ))}
              {[[0,"Toutes cap."],[2,"2P"],[4,"4P"],[6,"6P"],[8,"8P"]].map(([v,l])=>(
                <button key={"c"+l} onClick={()=>setDashListFilter(f=>({ ...f, cap:v }))} style={{ padding:"4px 9px", fontSize:10, fontWeight:dashListFilter.cap===v?700:400, background:dashListFilter.cap===v?C.green:C.white, color:dashListFilter.cap===v?C.white:C.text, border:`1px solid ${dashListFilter.cap===v?C.green:C.grayM}`, borderRadius:14, cursor:"pointer" }}>{l}</button>
              ))}
              {[[0,"Toutes durées"],[7,"7n"],[2,"2n"]].map(([v,l])=>(
                <button key={"n"+l} onClick={()=>setDashListFilter(f=>({ ...f, nights:v }))} style={{ padding:"4px 9px", fontSize:10, fontWeight:dashListFilter.nights===v?700:400, background:dashListFilter.nights===v?C.purple:C.white, color:dashListFilter.nights===v?C.white:C.text, border:`1px solid ${dashListFilter.nights===v?C.purple:C.grayM}`, borderRadius:14, cursor:"pointer" }}>{l}</button>
              ))}
            </div>
            <p style={{ ...sml, margin:"0 0 5px" }}>{listFiltered.length} tarif(s){listFiltered.length>30?" · 30 affichés":""}</p>
            {listFiltered.length===0&&<p style={{ fontSize:11, color:C.gray, textAlign:"center", padding:"14px 0", fontStyle:"italic" }}>Aucun tarif enregistré pour ces filtres.</p>}
            <div style={cd()}>
              {listFiltered.slice(0,30).map((r,i,arr)=>(
                <div key={r.id||`${r.period_id}_${r.capacity}_${r.stay_nights}`} style={rw(i===Math.min(arr.length,30)-1)}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:12, fontWeight:500, color:C.text }}>{r.period_label||r.period_id}</p>
                    <div style={{ display:"flex", gap:4, marginTop:1, flexWrap:"wrap" }}>
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

        {/* ══ CONCURRENTS SUIVIS ════════════════════════════════ */}
        <p style={sml}>🏢 Concurrents suivis</p>

        <div style={{ ...cd(11), padding:"9px 12px", background:C.goldL, marginBottom:8 }}>
          <p style={{ margin:0, fontSize:9, color:C.orange, fontWeight:600, lineHeight:1.4 }}>Les prix Claude sont indicatifs. Les prix validés manuellement sont prioritaires.</p>
        </div>

        {/* Liste + ajout */}
        <div style={cd()}>
          {catalog.length===0&&<div style={{ padding:"12px 13px" }}><p style={{ margin:0, fontSize:11, color:C.gray, fontStyle:"italic" }}>Aucun concurrent suivi. Ajoutez-en un pour relever ses prix Booking facilement.</p></div>}
          {catalog.map((c,i)=>(
            <div key={c.id} style={rw(i===catalog.length-1)}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                  <span style={{ fontSize:12, fontWeight:500, color:C.text }}>{c.name}</span>
                  <Badge label={c.property_type} color={c.property_type==="hôtel"?C.purple:c.property_type==="particulier"?"#FF5A5F":C.blue} bg={c.property_type==="hôtel"?C.purpleL:c.property_type==="particulier"?"#FFE9EA":C.bluePale} size={8}/>
                </div>
                <div style={{ display:"flex", gap:5, marginTop:1, alignItems:"center", flexWrap:"wrap" }}>
                  <span style={{ fontSize:9, color:C.gray }}>score {c.comparability_score||"?"}/100 · {c.platform}</span>
                  {c.booking_url&&<span style={{ fontSize:8, color:C.green }}>URL Booking ✓</span>}
                </div>
                {c.notes&&<p style={{ margin:"1px 0 0", fontSize:9, color:C.gray, fontStyle:"italic" }}>{c.notes}</p>}
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                <button onClick={()=>setCatForm({ ...c })} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:C.blue, padding:2 }}>✎</button>
                <button onClick={()=>handleDeleteCatalogItem(c.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.gray, padding:2 }}>🗑</button>
              </div>
            </div>
          ))}
        </div>

        {/* Formulaire ajout/édition */}
        {catForm ? (
          <div style={{ ...cd(11), padding:"11px 13px" }}>
            <p style={{ margin:"0 0 6px", fontSize:11, fontWeight:700, color:C.blue }}>{catForm.id?"Modifier le concurrent":"Ajouter un concurrent"}</p>
            <p style={{ ...sml, margin:"0 0 4px" }}>Nom *</p>
            <input style={{ ...inp(), marginBottom:6 }} placeholder="Résidence Les Chalets du Verdon" value={catForm.name||""} onChange={e=>setCatForm(f=>({ ...f, name:e.target.value }))}/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Type</p>
                <select value={catForm.property_type||"résidence"} onChange={e=>setCatForm(f=>({ ...f, property_type:e.target.value }))} style={inp()}>{["résidence","hôtel","particulier"].map(t=><option key={t} value={t}>{t}</option>)}</select>
              </div>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Plateforme</p>
                <select value={catForm.platform||"Booking.com"} onChange={e=>setCatForm(f=>({ ...f, platform:e.target.value }))} style={inp()}>{["Booking.com","Airbnb","Abritel"].map(t=><option key={t} value={t}>{t}</option>)}</select>
              </div>
            </div>
            <p style={{ ...sml, margin:"0 0 4px" }}>URL Booking</p>
            <input style={{ ...inp(), marginBottom:6 }} placeholder="https://www.booking.com/hotel/..." value={catForm.booking_url||""} onChange={e=>setCatForm(f=>({ ...f, booking_url:e.target.value }))}/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Score comparabilité</p>
                <input type="number" style={inp()} placeholder="88" value={catForm.comparability_score??""} onChange={e=>setCatForm(f=>({ ...f, comparability_score:e.target.value }))}/>
              </div>
              <div>
                <p style={{ ...sml, margin:"0 0 4px" }}>Localisation</p>
                <input style={inp()} placeholder="La Foux d'Allos" value={catForm.search_location||""} onChange={e=>setCatForm(f=>({ ...f, search_location:e.target.value }))}/>
              </div>
            </div>
            <p style={{ ...sml, margin:"0 0 4px" }}>Notes</p>
            <input style={{ ...inp(), marginBottom:8 }} placeholder="Concurrent direct" value={catForm.notes||""} onChange={e=>setCatForm(f=>({ ...f, notes:e.target.value }))}/>
            {catForm.error&&<div style={{ ...cd(8), padding:"7px 10px", background:C.redL, marginBottom:6 }}><p style={{ margin:0, fontSize:11, color:C.red }}>✗ {catForm.error}</p></div>}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              <button onClick={()=>setCatForm(null)} style={{ ...btn(false,C.grayL,C.text), margin:0 }}>Annuler</button>
              <button onClick={handleSaveCatalogItem} disabled={catSaving||!catForm.name?.trim()} style={{ ...btn(catSaving||!catForm.name?.trim(),C.blue), margin:0 }}>{catSaving?"…":"Enregistrer"}</button>
            </div>
          </div>
        ) : (
          <button onClick={()=>setCatForm({ name:"", property_type:"résidence", platform:"Booking.com", booking_url:"", search_location:"La Foux d'Allos", comparability_score:80, notes:"" })} style={{ ...btn(false,C.blue), marginBottom:8 }}>+ Ajouter concurrent</button>
        )}

        {/* Import CSV concurrents suivis */}
        <div style={{ ...cd(11), padding:"11px 13px" }}>
          <p style={{ margin:"0 0 4px", fontSize:11, fontWeight:700, color:C.blue }}>Importer concurrents suivis (CSV)</p>
          <p style={{ margin:"0 0 6px", fontSize:9, color:C.gray, fontFamily:"monospace", lineHeight:1.5 }}>name;property_type;platform;booking_url;search_location;comparability_score;notes</p>
          {catCsvResult&&(
            <div style={{ ...cd(8), padding:"8px 10px", background:catCsvResult.errors.length===0?C.greenL:C.goldL, marginBottom:6 }}>
              <p style={{ margin:"0 0 1px", fontSize:11, color:C.green }}>✓ Importés : {catCsvResult.ok}</p>
              <p style={{ margin:"0 0 1px", fontSize:11, color:C.gray }}>⊝ Ignorés : {catCsvResult.skipped}</p>
              {catCsvResult.errors.map((e,i)=><p key={i} style={{ margin:0, fontSize:10, color:C.red }}>✗ {e}</p>)}
            </div>
          )}
          <textarea value={catCsvText} onChange={e=>setCatCsvText(e.target.value)} placeholder={"Résidence Les Chalets du Verdon;résidence;Booking.com;https://www.booking.com/...;La Foux d'Allos;88;Concurrent direct"} style={{ width:"100%", minHeight:70, padding:"8px", fontSize:10, fontFamily:"monospace", border:`1px solid ${C.grayM}`, borderRadius:9, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            <button onClick={()=>{ const tpl=["name;property_type;platform;booking_url;search_location;comparability_score;notes","Résidence Les Chalets du Verdon;résidence;Booking.com;https://www.booking.com/...;La Foux d'Allos;88;Concurrent direct","Central Park;résidence;Booking.com;https://www.booking.com/...;La Foux d'Allos;82;Concurrent direct"].join("\n"); const b=new Blob([tpl],{ type:"text/csv;charset=utf-8" }); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download="modele_concurrents_suivis.csv"; a.click(); }} style={{ ...btn(false,C.grayL,C.blueL), margin:0, border:`1px solid ${C.blueL}` }}>⬇ Modèle CSV</button>
            <button onClick={handleImportCatalogCsv} disabled={!catCsvText.trim()} style={{ ...btn(!catCsvText.trim(),C.blue), margin:0 }}>Importer concurrents suivis</button>
          </div>
        </div>

        {/* Relevé rapide concurrents suivis (période + capacité courantes) */}
        {catalog.length>0&&(()=>{
          const period = selWeek;
          const checkin = period?.period_start || period?.week_start;
          const checkout = period?.period_end || (checkin?addDaysStr(checkin, period?.stay_nights||7):"");
          return (
            <>
              <p style={sml}>Relevé rapide concurrents suivis</p>
              <div style={{ ...cd(11,4), padding:"8px 12px", background:C.bluePale }}>
                <p style={{ margin:0, fontSize:10, color:C.blueL, fontWeight:600 }}>{period?.label} · {cap}</p>
                <p style={{ margin:"1px 0 0", fontSize:9, color:C.blueL }}>Booking : arrivée {fmtDateShort(checkin)} · départ {fmtDateShort(checkout)}</p>
              </div>
              <div style={cd()}>
                {catalog.map((c,i)=>{
                  const key=`${period?.id}_${capNum}_${c.id}`;
                  const st=catSaved[key];
                  const vp=catVerifyPrice[key]??"";
                  const url=buildTrackedBookingUrl(c, period||{}, capNum);
                  return (
                    <div key={c.id} style={{ padding:"8px 12px", borderBottom:i<catalog.length-1?`0.5px solid ${C.grayL}`:"none" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:11, fontWeight:500, color:C.text, flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.name}</span>
                        <a href={url} target="_blank" rel="noreferrer" style={{ fontSize:9, fontWeight:600, color:C.blue, background:C.white, padding:"4px 8px", borderRadius:6, textDecoration:"none", border:`1px solid ${C.grayM}`, flexShrink:0 }}>↗ Ouvrir Booking</a>
                      </div>
                      {st==="ok" ? (
                        <p style={{ margin:"5px 0 0", fontSize:9, color:C.green, fontWeight:600 }}>✓ Prix validé enregistré</p>
                      ) : (
                        <div style={{ display:"flex", gap:6, marginTop:5, alignItems:"center" }}>
                          <input type="number" placeholder="Prix vérifié" value={vp} onChange={e=>setCatVerifyPrice(p=>({ ...p, [key]:e.target.value }))} style={{ flex:1, padding:"5px 8px", fontSize:10, border:`1px solid ${C.grayM}`, borderRadius:6, boxSizing:"border-box" }}/>
                          <button onClick={()=>saveTrackedRate(c, period, capNum, vp, key)} disabled={!vp} style={{ padding:"5px 8px", fontSize:9, fontWeight:700, background:vp?C.green:C.grayL, color:vp?C.white:C.gray, border:"none", borderRadius:6, cursor:vp?"pointer":"default", whiteSpace:"nowrap" }}>Enregistrer prix vérifié</button>
                        </div>
                      )}
                      {st==="dup"&&<p style={{ margin:"4px 0 0", fontSize:9, color:C.gold }}>= Relevé déjà existant</p>}
                      {st==="err"&&<p style={{ margin:"4px 0 0", fontSize:9, color:C.red }}>✗ Erreur d'enregistrement</p>}
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}
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
    const barTitle = periodMode === "ete_7" ? `Périodes Été ${yr}` : periodMode === "hiver_7" ? "Périodes Hiver 7n" : "Périodes Hiver 2n";
    return (
      <div><SBar title={barTitle}/>
        <div style={{ padding:"6px 14px 4px" }}>
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
        <textarea value={ourCsvText} onChange={e=>setOurCsvText(e.target.value)} placeholder={"period_id;period_start;period_end;period_label;season;stay_nights;capacity;price_total;notes\n2026_w2;2026-06-27;2026-07-04;27 juin → 3 juil;ete;7;6;340;Tarif été 2026"} style={{ width:"100%", minHeight:90, padding:"8px", fontSize:10, fontFamily:"monospace", border:`1px solid ${C.grayM}`, borderRadius:9, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
          <button onClick={()=>{ const tpl=["period_id;period_start;period_end;period_label;season;stay_nights;capacity;price_total;notes","2026_w2;2026-06-27;2026-07-04;27 juin → 3 juil;ete;7;6;340;Tarif été 2026","2026_w3;2026-07-04;2026-07-11;4 juil → 10 juil;ete;7;6;360;Tarif été 2026"].join("\n"); const b=new Blob([tpl],{ type:"text/csv;charset=utf-8" }); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download="modele_tarifs_les_cimes.csv"; a.click(); }} style={{ ...btn(false,C.grayL,C.blueL), margin:0, border:`1px solid ${C.blueL}` }}>⬇ Modèle CSV tarifs</button>
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

 return (
  <div style={{ padding:"20px 0 40px", display:"flex", justifyContent:"center" }}>
    <div style={ph}>
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

      {user && screen === "dashboard" && Dashboard()}
      {user && screen === "weeks" && Weeks()}
      {user && screen === "week" && WeekDetail()}
      {user && screen === "collect" && Collect()}
      {user && screen === "import" && ImportScreen()}
      {user && screen === "diag" && Diagnostic()}
    </div>
 </div>
);
}

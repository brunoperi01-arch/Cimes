// ══════════════════════════════════════════════════════════════════
// src/services/competitorRatesService.js
// Domaine "competitor" — relevés concurrents. Câblé sur le nouveau schéma :
//   competitor_rates  (relevés ; competitor_id + platform_id en FK)
//   competitors       (catalogue ; ex competitor_catalog)
//   platforms         (sources ; ex competitor_sources)
//
// Filtrage des relevés : par dates exactes (period_start + stay_nights +
// capacity), conformément à la règle "les concurrents ne suivent pas nos
// semaines". Corrections de prix : simple update (updated_at via trigger),
// ancien prix archivé dans legacy_data.
// ══════════════════════════════════════════════════════════════════
import { sb, ls, SB_READY, stripUserId } from "./supabaseClient.js";
import { addDaysStr } from "../utils/dates.js";
import { isOwnProperty, competitorSegment } from "../domain/comparability.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CATALOG_LS = "competitor_catalog";
export const SOURCES_LS = "competitor_sources";
export const DEFAULT_COMPETITORS = [];

// ── Helpers internes (auparavant dans App.jsx) ──────────────────────────────
function normalizeBookingBaseUrl(url) {
  if (!url) return url;
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return url; }
}
function normalizeLfdnasBaseUrl(url) {
  if (!url) return url;
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return url; }
}
function isDuplicate(list, row) {
  return (list || []).some(r =>
    r.competitor_id === row.competitor_id &&
    String(r.period_start) === String(row.period_start) &&
    Number(r.capacity) === Number(row.capacity) &&
    Number(r.price_total) === Number(row.price_total) &&
    String(r.collected_at).slice(0,10) === String(row.collected_at).slice(0,10)
  );
}

// reliability valides (CHECK competitor_rates)
const RELIA_MAP = { "réel":"reel","reel":"reel","validé":"valide","valide":"valide",
  "saisi manuellement":"saisi_manuellement","saisi_manuellement":"saisi_manuellement",
  "importé csv":"importe_csv","importe csv":"importe_csv","importe_csv":"importe_csv",
  "à vérifier":"valide","a verifier":"valide" };
function normalizeReliability(s) { return RELIA_MAP[String(s||"").toLowerCase()] || "valide"; }

// Résout un nom de concurrent → competitor_id (uuid), en le créant si absent.
async function resolveCompetitorId(name, hints = {}) {
  if (!name) return null;
  if (UUID_RE.test(String(name))) return name;
  if (!SB_READY) return null;
  try {
    const found = await sb.select("competitors", `name=eq.${encodeURIComponent(name)}&select=id`);
    if (found?.length) return found[0].id;
    // créer le concurrent manquant
    const seg = competitorSegment(hints) === "private" ? "private" : "residence";
    const ins = await sb.insert("competitors", { name: String(name).trim(), segment: seg, property_type: hints.property_type || null, is_active: true });
    const row = Array.isArray(ins) ? ins[0] : ins;
    return row?.id || null;
  } catch { return null; }
}

// Résout un nom de source → platform_id (uuid), en la créant si absente.
async function resolvePlatformId(name) {
  if (!name) return null;
  if (UUID_RE.test(String(name))) return name;
  if (!SB_READY) return null;
  try {
    const found = await sb.select("platforms", `name=eq.${encodeURIComponent(name)}&select=id`);
    if (found?.length) return found[0].id;
    const ins = await sb.insert("platforms", { name: String(name).trim(), channel_type: "other", is_active: true });
    const row = Array.isArray(ins) ? ins[0] : ins;
    return row?.id || null;
  } catch { return null; }
}

// period_start à partir d'une clé période (date ISO directe, ou uuid/clé → periods)
async function resolvePeriodStart(weekId) {
  if (!weekId) return null;
  const v = String(weekId);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;        // déjà une date ISO
  if (!SB_READY) return null;
  try {
    const q = UUID_RE.test(v) ? `id=eq.${v}` : `period_id=eq.${encodeURIComponent(v)}`;
    const rows = await sb.select("periods", `${q}&select=period_start`);
    return rows?.[0]?.period_start || null;
  } catch { return null; }
}

// Enrichit les lignes lues (compat champs UI : price_week, property_name, etc.)
export function enrichRates(rawRates, competitors) {
  return (rawRates || []).map(r => {
    const priceTotal = Number(r.price_total ?? r.price_week ?? r.price ?? 0);
    const stayNights = Number(r.stay_nights || 7);
    const priceNight = Number(r.price_night ?? (priceTotal ? Math.round(priceTotal / stayNights) : 0));
    const comp = (competitors || []).find(c => c.id === r.competitor_id || c.name === r.competitor || c.name === r.property_name);
    const name = comp?.name || r.competitor || r.property_name || "Concurrent";
    return {
      ...r,
      price_total: priceTotal, price_week: priceTotal, price: priceTotal, price_night: priceNight,
      property_name: name, competitor_name: name, competitor: name,
      source_url: r.source_url ?? r.url ?? "",
      property_type: comp?.property_type ?? r.property_type ?? r.competitor_accommodation ?? "particulier",
      segment: r.segment ?? (comp ? competitorSegment(comp) : "residence"),
      reliability_status: r.reliability_status ?? "valide",
    };
  });
}

// Lecture des relevés d'une période (filtre dates exactes + capacité)
export async function getCompetitorRates({ weekId, capacity, showExamples = false }, allCompetitors) {
  let raw = [];
  if (SB_READY) {
    const periodStart = await resolvePeriodStart(weekId);
    const parts = [`order=collected_at.desc`, `select=*`];
    if (periodStart) parts.unshift(`period_start=eq.${encodeURIComponent(periodStart)}`);
    if (capacity != null) parts.unshift(`capacity=eq.${encodeURIComponent(capacity)}`);
    raw = await sb.select("competitor_rates", parts.join("&"));
    if (!showExamples) raw = (raw || []).filter(r => r.is_example !== true);
  } else {
    raw = (ls.get(`rates_${weekId}_${capacity}`) || []).filter(r => showExamples || !r.is_example);
  }
  return enrichRates(raw || [], allCompetitors);
}

// Création d'un relevé concurrent (résout competitor_id + platform_id)
export async function saveCompetitorRate(rate, allCompetitors) {
  const clean = stripUserId(rate);
  const competitorName = clean.competitor || clean.property_name || clean.competitor_name || clean.source || "Concurrent";
  const priceValue = Number(clean.price_total ?? clean.price ?? clean.price_week ?? 0);
  const stayNights = Number(clean.stay_nights || 7);
  const collectedAt = clean.collected_at || clean.collectedAt || new Date().toISOString();
  const sourceName = clean.source || clean.platform || null;
  const sourceUrl = clean.source_url || clean.url || null;
  if (!priceValue) throw new Error("Prix manquant : impossible d'enregistrer ce relevé.");

  const periodStart = clean.period_start || (await resolvePeriodStart(clean.week_id));
  if (!periodStart) throw new Error("Date de séjour (period_start) requise.");
  const periodEnd = clean.period_end || addDaysStr(periodStart, stayNights);

  if (SB_READY) {
    const competitor_id = await resolveCompetitorId(competitorName, clean);
    const platform_id = sourceName ? await resolvePlatformId(sourceName) : null;
    const payload = {
      competitor_id,
      platform_id,
      period_id: null,                          // FK nullable : comparaison par dates
      period_start: periodStart,
      period_end: periodEnd,
      stay_nights: stayNights,
      capacity: clean.capacity != null ? Number(clean.capacity) : null,
      competitor_accommodation: clean.competitor_accommodation || clean.detected_rooms || clean.property_type || null,
      price_total: priceValue,                  // price_night est GÉNÉRÉ → omis
      segment: competitorSegment(clean) === "private" ? "private" : "residence",
      reliability_status: normalizeReliability(clean.reliability_status),
      is_example: clean.is_example ?? false,
      source_type: clean.source_type || clean.collection_type || sourceName || null,
      source_url: sourceUrl,
      collected_at: collectedAt,
      notes: clean.notes || null,
    };
    // anti-doublon : même concurrent + dates + capacité + jour de relevé
    const dupParts = [`period_start=eq.${encodeURIComponent(periodStart)}`, `select=id`];
    if (competitor_id) dupParts.unshift(`competitor_id=eq.${competitor_id}`);
    if (payload.capacity != null) dupParts.unshift(`capacity=eq.${payload.capacity}`);
    const existing = await sb.select("competitor_rates", dupParts.join("&"));
    if (existing?.length) throw new Error("DUPLICATE");
    const ins = await sb.insert("competitor_rates", payload);
    return Array.isArray(ins) ? ins[0] : ins;
  }

  // Repli localStorage
  const id = "r_" + Date.now();
  const full = {
    ...clean, id, competitor: competitorName, property_name: competitorName,
    competitor_id: clean.competitor_id || null,
    period_start: periodStart, period_end: periodEnd, stay_nights: stayNights,
    price_total: priceValue, price: priceValue, price_week: priceValue,
    price_night: Math.round(priceValue / stayNights),
    segment: competitorSegment(clean) === "private" ? "private" : "residence",
    reliability_status: normalizeReliability(clean.reliability_status),
    source_url: sourceUrl, collected_at: collectedAt,
  };
  const key = `rates_${clean.week_id || periodStart}_${clean.capacity}`;
  if (isDuplicate(ls.get(key) || [], full)) throw new Error("DUPLICATE");
  ls.push(key, full);
  return full;
}

export async function deleteCompetitorRate(id, weekId, capacity) {
  if (SB_READY) return sb.delete("competitor_rates", `id=eq.${id}`);
  const key = `rates_${weekId}_${capacity}`;
  ls.set(key, (ls.get(key) || []).filter(r => r.id !== id));
}

// Historique d'un concurrent sur une période (par dates + capacité)
export async function getHistoricalRates({ weekId, competitorId, capacity }) {
  if (SB_READY) {
    const periodStart = await resolvePeriodStart(weekId);
    const parts = [`order=collected_at.asc`, `select=*,competitors(name)`];
    if (periodStart) parts.unshift(`period_start=eq.${encodeURIComponent(periodStart)}`);
    if (competitorId) parts.unshift(`competitor_id=eq.${competitorId}`);
    if (capacity != null) parts.unshift(`capacity=eq.${capacity}`);
    return sb.select("competitor_rates", parts.join("&"));
  }
  return (ls.get(`rates_${weekId}_${capacity}`) || []).filter(r => r.competitor_id === competitorId)
    .sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at)));
}

// ── CATALOGUE → table competitors ───────────────────────────────────────────
export async function getCompetitorCatalog() {
  let rows = [];
  if (SB_READY) {
    try { rows = await sb.select("competitors", "is_active=eq.true&order=name.asc&select=*"); }
    catch { rows = []; }
  } else {
    rows = (ls.get(CATALOG_LS) || []).filter(r => r.is_active !== false);
  }
  return (rows || []).filter(r => !isOwnProperty(r.name) && !r.is_own_property);
}

export async function saveCompetitorCatalogItem(item) {
  if (!item.name) throw new Error("Nom du concurrent requis.");
  if (isOwnProperty(item.name)) throw new Error("Les Cimes ne peut pas être enregistré comme concurrent.");
  const isPrivate = competitorSegment(item) === "private";
  const PRIVATE_SUBTYPES = ["particulier", "studio"];
  const payload = {
    name:          String(item.name).trim(),
    segment:       isPrivate ? "private" : "residence",
    property_type: isPrivate ? (PRIVATE_SUBTYPES.includes(item.property_type) ? item.property_type : "particulier") : (item.property_type || "residence"),
    source_type:   item.source_type || item.platform || item.preferred_channel || null,
    location:      item.search_location || item.location || null,
    url:           item.booking_url ? normalizeBookingBaseUrl(item.booking_url) : (item.url || item.direct_url || null),
    is_active:     item.is_active !== false,
    notes:         item.notes || null,
  };
  if (SB_READY) {
    if (item.id) { await sb.update("competitors", `id=eq.${item.id}`, payload); return { ...payload, id: item.id }; }
    const existing = await sb.select("competitors", `name=eq.${encodeURIComponent(payload.name)}&select=id`);
    if (existing?.length) { await sb.update("competitors", `id=eq.${existing[0].id}`, payload); return { ...payload, id: existing[0].id }; }
    const ins = await sb.insert("competitors", payload); return Array.isArray(ins) ? ins[0] : ins;
  }
  const all = ls.get(CATALOG_LS);
  if (item.id) { const i = all.findIndex(r => r.id === item.id); if (i >= 0) { all[i] = { ...all[i], ...payload }; ls.set(CATALOG_LS, all); return all[i]; } }
  const created = { ...payload, id: "cc_" + Date.now() };
  all.push(created); ls.set(CATALOG_LS, all); return created;
}

export async function deleteCompetitorCatalogItem(id) {
  if (SB_READY) return sb.update("competitors", `id=eq.${id}`, { is_active: false });
  ls.set(CATALOG_LS, (ls.get(CATALOG_LS) || []).filter(r => r.id !== id));
  return true;
}

// ── SOURCES → table platforms (par concurrent : on stocke l'URL côté competitors)
// Dans le nouveau modèle, une "source" = une plateforme. On crée/active la
// plateforme ; le lien fin concurrent↔URL n'a plus de table dédiée.
export async function getCompetitorSources() {
  if (SB_READY) {
    try { return await sb.select("platforms", "is_active=eq.true&order=name.asc&select=*"); }
    catch { return []; }
  }
  return (ls.get(SOURCES_LS) || []).filter(r => r.is_active !== false);
}

export async function saveCompetitorSource(source) {
  const name = source.source_name || source.name || "Autre";
  const isLfdnas = String(name).toLowerCase().includes("france du nord") || String(source.source_url || "").toLowerCase().includes("lafrancedunordausud.fr");
  const cleanedUrl = isLfdnas ? normalizeLfdnasBaseUrl(source.source_url) : (source.source_url || null);
  const payload = {
    name: String(name).trim(),
    channel_type: source.source_type || "other",
    url: cleanedUrl,
    is_active: source.is_active !== false,
    notes: source.notes || null,
  };
  if (SB_READY) {
    if (source.id && UUID_RE.test(String(source.id))) { await sb.update("platforms", `id=eq.${source.id}`, payload); return { ...payload, id: source.id }; }
    const existing = await sb.select("platforms", `name=eq.${encodeURIComponent(payload.name)}&select=id`);
    if (existing?.length) { await sb.update("platforms", `id=eq.${existing[0].id}`, payload); return { ...payload, id: existing[0].id }; }
    const ins = await sb.insert("platforms", payload); return Array.isArray(ins) ? ins[0] : ins;
  }
  const all = ls.get(SOURCES_LS);
  if (source.id) { const i = all.findIndex(r => r.id === source.id); if (i >= 0) { all[i] = { ...all[i], ...payload }; ls.set(SOURCES_LS, all); return all[i]; } }
  const created = { ...payload, id: "cs_" + Date.now() };
  all.push(created); ls.set(SOURCES_LS, all); return created;
}

export async function deleteCompetitorSource(id) {
  if (SB_READY) return sb.update("platforms", `id=eq.${id}`, { is_active: false });
  ls.set(SOURCES_LS, (ls.get(SOURCES_LS) || []).filter(r => r.id !== id));
  return true;
}

export async function getAllCompetitorRatesHistory() {
  if (SB_READY) {
    try { return await sb.select("competitor_rates", "order=collected_at.desc&limit=1000&select=*"); }
    catch { return []; }
  }
  const keys = Object.keys(localStorage).filter(k => k.startsWith("rates_"));
  const all = keys.flatMap(k => ls.get(k) || []);
  return all.sort((a, b) => String(b.collected_at).localeCompare(String(a.collected_at))).slice(0, 1000);
}

// Correction de prix : simple update (updated_at via trigger).
// L'ancien prix est archivé dans legacy_data (pas de table d'historique).
export async function correctCompetitorRate(rate, newPriceTotal, reason) {
  const newTotal = Number(newPriceTotal) || 0;
  if (!newTotal) throw new Error("Prix corrigé invalide.");
  const oldTotal = Number(rate.price_total || rate.price_week || rate.price || 0);
  if (SB_READY) {
    // archive l'ancien prix dans legacy_data sans écraser le reste
    const legacy = { ...(rate.legacy_data || {}), corrected_from: oldTotal, correction_reason: reason || null, corrected_at: new Date().toISOString() };
    return await sb.update("competitor_rates", `id=eq.${rate.id}`, { price_total: newTotal, legacy_data: legacy });
  }
  const keys = Object.keys(localStorage).filter(k => k.startsWith("rates_"));
  for (const k of keys) {
    const arr = ls.get(k) || []; const i = arr.findIndex(r => r.id === rate.id);
    if (i >= 0) { arr[i] = { ...arr[i], price_total: newTotal, price: newTotal, price_week: newTotal, price_night: Math.round(newTotal / Number(arr[i].stay_nights || 7)) }; ls.set(k, arr); break; }
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════
// src/services/ownOnlineRatesService.js
// Domaine "online_own" — tarifs Les Cimes constatés en ligne chez les
// partenaires. Câblé sur online_own_rates + platforms (schéma 9B).
// N'écrit JAMAIS competitor_rates.
//
// Schéma cible online_own_rates :
//   platform_id FK→platforms | period_id FK→periods | apartment_type FK
//   expected_public_price | expected_promo_price | expected_price (GÉNÉRÉ)
//   detected_price | validated_price | effective_seen_price (GÉNÉRÉ)
//   gap_amount (GÉNÉRÉ) | gap_pct (GÉNÉRÉ) | status | reliability_status
//   collected_at timestamptz | validated_at | notes
//
// Les sources de diffusion Les Cimes = lignes de la table platforms.
// ══════════════════════════════════════════════════════════════════
import { sb, ls, SB_READY } from "./supabaseClient.js";
import { dateObjToISO, addDaysStr } from "../utils/dates.js";
import { parseCsv, parseCsvNumber } from "../utils/csv.js";
import { ACCOMMODATION_TYPES, getOurRateForContext, normalizeAccommodationType } from "../domain/accommodations.js";
import { getActivePromoForContext } from "../domain/promotions.js";
import { getExpectedOurOnlinePrice, onlineRateStatus } from "../domain/onlineRates.js";

export const ONLINE_SOURCES_LS = "lescimes_online_sources";
export const ONLINE_RATES_LS = "lescimes_online_rates";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// channel_type valides (CHECK platforms)
const CHANNEL_OK = ["booking","tour_operator","marketplace","direct","classified","other"];
function normalizeChannelType(t) {
  const v = String(t || "").toLowerCase();
  if (CHANNEL_OK.includes(v)) return v;
  if (v.includes("booking")) return "booking";
  if (v.includes("airbnb") || v.includes("abritel") || v.includes("expedia")) return "marketplace";
  if (v.includes("pap") || v.includes("leboncoin")) return "classified";
  if (v.includes("maeva") || v.includes("ski") || v.includes("travelski") || v.includes("carrefour") || v === "tour_operator") return "tour_operator";
  if (v.includes("direct") || v.includes("officiel")) return "direct";
  return "other";
}

// status diffusion valides (CHECK online_own_rates)
const STATUS_MAP = { "à vérifier":"a_verifier", "a verifier":"a_verifier", "a_verifier":"a_verifier",
  "ok":"ok", "trop haut":"trop_haut", "trop_haut":"trop_haut", "trop bas":"trop_bas", "trop_bas":"trop_bas",
  "promo absente":"promo_absente", "promo_absente":"promo_absente", "non trouvé":"non_trouve",
  "non trouve":"non_trouve", "non_trouve":"non_trouve" };
function normalizeStatus(s) { return STATUS_MAP[String(s||"").toLowerCase()] || "a_verifier"; }

// reliability valides (CHECK)
const RELIA_MAP = { "réel":"reel","reel":"reel","validé":"valide","valide":"valide",
  "saisi manuellement":"saisi_manuellement","saisi_manuellement":"saisi_manuellement",
  "importé csv":"importe_csv","importe csv":"importe_csv","importe_csv":"importe_csv" };
function normalizeReliability(s) { return RELIA_MAP[String(s||"").toLowerCase()] || "valide"; }

// Résout une plateforme par id uuid ou par nom → platform_id (uuid) ou null.
async function resolvePlatformId({ platform_id, source_id, source_name }) {
  const direct = platform_id || source_id;
  if (direct && UUID_RE.test(String(direct))) return direct;
  if (!SB_READY || !source_name) return null;
  try {
    const rows = await sb.select("platforms", `name=eq.${encodeURIComponent(source_name)}&select=id`);
    return rows?.[0]?.id || null;
  } catch { return null; }
}
async function resolvePeriodUuid(periodIdOrKey) {
  if (!periodIdOrKey) return null;
  const v = String(periodIdOrKey);
  if (UUID_RE.test(v)) return v;
  if (!SB_READY) return null;
  try { const rows = await sb.select("periods", `period_id=eq.${encodeURIComponent(v)}&select=id`); return rows?.[0]?.id || null; }
  catch { return null; }
}

// ── SOURCES = plateformes ───────────────────────────────────────────────────
export async function getOurOnlineSources() {
  if (SB_READY) {
    try {
      const r = await sb.select("platforms", "is_active=eq.true&select=*&order=name.asc");
      // adapter au format attendu par l'UI (source_name/source_type/source_url)
      return (r || []).map(p => ({ id: p.id, source_name: p.name, source_type: p.channel_type, source_url: p.url, is_active: p.is_active, notes: p.notes }));
    } catch (e) { console.warn("getOurOnlineSources:", e?.message); return ls.get(ONLINE_SOURCES_LS) || []; }
  }
  return ls.get(ONLINE_SOURCES_LS) || [];
}
export async function saveOurOnlineSource(s) {
  const name = String(s.source_name || s.name || "").trim();
  if (!name) throw new Error("Nom de source requis.");
  const payload = {
    name,
    channel_type: normalizeChannelType(s.source_type || s.channel_type),
    url:          s.source_url || s.url || null,
    is_active:    s.is_active !== false,
    notes:        s.notes || null,
  };
  if (SB_READY) {
    try {
      if (s.id && !String(s.id).startsWith("local_")) { await sb.update("platforms", `id=eq.${s.id}`, payload); return { id:s.id, source_name:name, source_type:payload.channel_type, source_url:payload.url }; }
      // upsert par nom (unique)
      const existing = await sb.select("platforms", `name=eq.${encodeURIComponent(name)}&select=id`);
      if (existing?.length) { await sb.update("platforms", `id=eq.${existing[0].id}`, payload); return { id:existing[0].id, source_name:name }; }
      const ins = await sb.insert("platforms", payload); const row = Array.isArray(ins)?ins[0]:ins;
      return { id: row.id, source_name: name, source_type: payload.channel_type };
    } catch (e) {
      const all = ls.get(ONLINE_SOURCES_LS)||[]; const row={ id:s.id||"local_"+Date.now(), source_name:name, source_type:payload.channel_type, source_url:payload.url, is_active:payload.is_active, notes:payload.notes };
      const i=all.findIndex(x=>x.id===row.id); if(i>=0)all[i]=row; else all.unshift(row); ls.set(ONLINE_SOURCES_LS, all); return row;
    }
  }
  const all = ls.get(ONLINE_SOURCES_LS)||[]; const row={ id:s.id||"local_"+Date.now(), source_name:name, source_type:payload.channel_type, source_url:payload.url, is_active:payload.is_active, notes:payload.notes };
  const i=all.findIndex(x=>x.id===row.id); if(i>=0)all[i]=row; else all.unshift(row); ls.set(ONLINE_SOURCES_LS, all); return row;
}
export async function deleteOurOnlineSource(id) {
  if (SB_READY && !String(id).startsWith("local_")) { try { await sb.update("platforms", `id=eq.${id}`, { is_active:false }); return; } catch {} }
  const all = (ls.get(ONLINE_SOURCES_LS)||[]).filter(x=>x.id!==id); ls.set(ONLINE_SOURCES_LS, all);
}

// ── RELEVÉS ─────────────────────────────────────────────────────────────────
export async function getOurOnlineRates() {
  if (SB_READY) {
    try { const r = await sb.select("online_own_rates", "select=*&order=collected_at.desc&limit=500"); return r || []; }
    catch (e) { console.warn("getOurOnlineRates:", e?.message); return ls.get(ONLINE_RATES_LS) || []; }
  }
  return ls.get(ONLINE_RATES_LS) || [];
}
export async function saveOurOnlineRate(r) {
  const expected = Number(r.expected_price || 0);
  const validated = r.validated_price != null ? Number(r.validated_price) : null;

  if (SB_READY) {
    const platform_id = await resolvePlatformId(r);
    const period_id = await resolvePeriodUuid(r.period_id);
    // payload : colonnes GÉNÉRÉES omises (expected_price, effective_seen_price, gap_amount, gap_pct)
    const payload = {
      platform_id,
      period_id,
      apartment_type:        r.apartment_type || r.accommodation_type || null,
      capacity:              r.capacity != null ? Number(r.capacity) : null,
      stay_nights:           Number(r.stay_nights || 7),
      expected_public_price: r.expected_public_price != null ? Number(r.expected_public_price) : null,
      expected_promo_price:  r.expected_promo_price != null ? Number(r.expected_promo_price) : null,
      detected_price:        r.detected_price != null ? Number(r.detected_price) : null,
      validated_price:       validated,
      status:                normalizeStatus(r.status),
      reliability_status:    normalizeReliability(r.reliability_status),
      collected_at:          r.collected_at || new Date().toISOString(),
      validated_at:          validated != null ? new Date().toISOString() : null,
      notes:                 r.notes || null,
    };
    try { const ins = await sb.insert("online_own_rates", payload); return Array.isArray(ins)?ins[0]:ins; }
    catch (e) { console.warn("saveOurOnlineRate:", e?.message); /* repli ci-dessous */ }
  }

  // Repli localStorage : gap calculés localement (pas de génération)
  const gapAmount = (validated != null && expected > 0) ? Math.round(validated - expected) : null;
  const gapPct = (validated != null && expected > 0) ? Math.round((gapAmount / expected) * 100) : null;
  const rowLs = {
    id: "local_" + Date.now(),
    platform_id:           r.platform_id || r.source_id || null,
    source_name:           r.source_name || null,
    period_start:          r.period_start || null,
    period_end:            r.period_end || null,
    stay_nights:           Number(r.stay_nights || 7),
    apartment_type:        r.apartment_type || r.accommodation_type || null,
    capacity:              r.capacity != null ? Number(r.capacity) : null,
    expected_public_price: r.expected_public_price ?? null,
    expected_promo_price:  r.expected_promo_price ?? null,
    expected_price:        expected || null,
    detected_price:        r.detected_price ?? null,
    validated_price:       validated,
    effective_seen_price:  validated ?? r.detected_price ?? null,
    gap_amount:            gapAmount,
    gap_pct:               gapPct,
    status:                normalizeStatus(r.status),
    reliability_status:    normalizeReliability(r.reliability_status),
    collected_at:          r.collected_at || dateObjToISO(new Date()),
    notes:                 r.notes || null,
  };
  const all = ls.get(ONLINE_RATES_LS) || []; all.unshift(rowLs); ls.set(ONLINE_RATES_LS, all); return rowLs;
}

// Import CSV des tarifs Les Cimes constatés en ligne (domaine online_own).
// Colonnes : source_name;source_type;period_start;period_end;stay_nights;accommodation_type;capacity;online_price[;notes]
// Le prix attendu (officiel/promo) est recalculé ici à partir de our_rates + our_promotions.
export async function importOurOnlineRatesCsv(csvText, { ourRates = [], ourPromotions = [] } = {}) {
  const { rows } = parseCsv(csvText);
  let ok = 0, errors = 0;
  for (const row of rows) {
    const get = name => row[name] || "";
    const accType = normalizeAccommodationType(get("accommodation_type")) || get("accommodation_type") || null;
    const capacity = parseInt(get("capacity")) || (accType ? ACCOMMODATION_TYPES[accType]?.capacity : null);
    const stayNights = parseInt(get("stay_nights")) || 7;
    const periodStart = get("period_start") || null;
    const periodEnd = get("period_end") || (periodStart ? addDaysStr(periodStart, stayNights) : null);
    const onlinePrice = parseCsvNumber(get("online_price") || get("validated_price") || get("price"));
    if (!periodStart || !onlinePrice) { errors++; continue; }
    const ctx = { checkin: periodStart, checkout: periodEnd, capacity, stayNights, period_start: periodStart, period_end: periodEnd };
    const publicRate = getOurRateForContext(ourRates, ctx, accType);
    const activePromo = getActivePromoForContext(ourPromotions, ctx, accType);
    const exp = getExpectedOurOnlinePrice({ publicRate, activePromo });
    const status = onlineRateStatus({ validated: onlinePrice, expected: exp.expected_price, expectedPublic: exp.expected_public_price, expectedPromo: exp.expected_promo_price });
    try {
      await saveOurOnlineRate({
        source_name: get("source_name") || "Import CSV", source_type: get("source_type") || "other",
        period_start: periodStart, period_end: periodEnd, stay_nights: stayNights,
        apartment_type: accType, capacity,
        expected_public_price: exp.expected_public_price, expected_promo_price: exp.expected_promo_price, expected_price: exp.expected_price,
        validated_price: onlinePrice, status, reliability_status: "importe_csv",
        notes: get("notes") || null,
      });
      ok++;
    } catch { errors++; }
  }
  return { ok, errors };
}

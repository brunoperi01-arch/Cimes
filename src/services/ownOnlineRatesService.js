// ══════════════════════════════════════════════════════════════════
// src/services/ownOnlineRatesService.js
// Domaine "online_own" — tarifs Les Cimes constatés en ligne chez les
// partenaires (our_online_sources + our_online_rates).
// Persistance Supabase + repli localStorage. N'écrit JAMAIS competitor_rates.
// ══════════════════════════════════════════════════════════════════
import { sb, ls, SB_READY } from "./supabaseClient.js";
import { dateObjToISO, addDaysStr } from "../utils/dates.js";
import { parseCsv, parseCsvNumber } from "../utils/csv.js";
import { ACCOMMODATION_TYPES, getOurRateForContext, normalizeAccommodationType } from "../domain/accommodations.js";
import { getActivePromoForContext } from "../domain/promotions.js";
import { getExpectedOurOnlinePrice, onlineRateStatus } from "../domain/onlineRates.js";

export const ONLINE_SOURCES_LS = "lescimes_online_sources";
export const ONLINE_RATES_LS = "lescimes_online_rates";

export async function getOurOnlineSources() {
  if (SB_READY) {
    try { const r = await sb.select("our_online_sources", "select=*&order=source_name.asc"); return r || []; }
    catch (e) { console.warn("getOurOnlineSources:", e?.message); return ls.get(ONLINE_SOURCES_LS) || []; }
  }
  return ls.get(ONLINE_SOURCES_LS) || [];
}
export async function saveOurOnlineSource(s) {
  const payload = {
    source_name: String(s.source_name||"").trim(),
    source_type: s.source_type || "channel",
    source_url:  s.source_url || null,
    is_active:   s.is_active !== false,
    notes:       s.notes || null,
    updated_at:  new Date().toISOString(),
  };
  if (!payload.source_name) throw new Error("Nom de source requis.");
  if (SB_READY) {
    try {
      if (s.id && !String(s.id).startsWith("local_")) { await sb.update("our_online_sources", `id=eq.${s.id}`, payload); return { ...payload, id:s.id }; }
      const ins = await sb.insert("our_online_sources", payload); return Array.isArray(ins)?ins[0]:ins;
    } catch (e) {
      const all = ls.get(ONLINE_SOURCES_LS)||[]; const row={ ...payload, id:s.id||"local_"+Date.now() };
      const i=all.findIndex(x=>x.id===row.id); if(i>=0)all[i]=row; else all.unshift(row); ls.set(ONLINE_SOURCES_LS, all); return row;
    }
  }
  const all = ls.get(ONLINE_SOURCES_LS)||[]; const row={ ...payload, id:s.id||"local_"+Date.now() };
  const i=all.findIndex(x=>x.id===row.id); if(i>=0)all[i]=row; else all.unshift(row); ls.set(ONLINE_SOURCES_LS, all); return row;
}
export async function deleteOurOnlineSource(id) {
  if (SB_READY && !String(id).startsWith("local_")) { try { await sb.delete("our_online_sources", `id=eq.${id}`); return; } catch {} }
  const all = (ls.get(ONLINE_SOURCES_LS)||[]).filter(x=>x.id!==id); ls.set(ONLINE_SOURCES_LS, all);
}
export async function getOurOnlineRates() {
  if (SB_READY) {
    try { const r = await sb.select("our_online_rates", "select=*&order=collected_at.desc&limit=500"); return r || []; }
    catch (e) { console.warn("getOurOnlineRates:", e?.message); return ls.get(ONLINE_RATES_LS) || []; }
  }
  return ls.get(ONLINE_RATES_LS) || [];
}
export async function saveOurOnlineRate(r) {
  const expected = Number(r.expected_price || 0);
  const validated = r.validated_price != null ? Number(r.validated_price) : null;
  const gapAmount = (validated != null && expected > 0) ? Math.round(validated - expected) : null;
  const gapPct = (validated != null && expected > 0) ? Math.round((gapAmount / expected) * 100) : null;
  const payload = {
    source_id:             r.source_id || null,
    source_name:           r.source_name || null,
    source_type:           r.source_type || null,
    source_url:            r.source_url || null,
    period_start:          r.period_start || null,
    period_end:            r.period_end || null,
    stay_nights:           Number(r.stay_nights || 7),
    accommodation_type:    r.accommodation_type || null,
    capacity:              r.capacity != null ? Number(r.capacity) : null,
    expected_public_price: r.expected_public_price != null ? Number(r.expected_public_price) : null,
    expected_promo_price:  r.expected_promo_price != null ? Number(r.expected_promo_price) : null,
    expected_price:        expected || null,
    detected_price:        r.detected_price != null ? Number(r.detected_price) : null,
    validated_price:       validated,
    gap_amount:            gapAmount,
    gap_pct:               gapPct,
    status:                r.status || "à vérifier",
    reliability_status:    r.reliability_status || "validé",
    collected_at:          r.collected_at || dateObjToISO(new Date()),
    validated_at:          new Date().toISOString(),
    notes:                 r.notes || null,
  };
  if (SB_READY) {
    try { const ins = await sb.insert("our_online_rates", payload); return Array.isArray(ins)?ins[0]:ins; }
    catch (e) { const all=ls.get(ONLINE_RATES_LS)||[]; const row={ ...payload, id:"local_"+Date.now() }; all.unshift(row); ls.set(ONLINE_RATES_LS, all); return row; }
  }
  const all=ls.get(ONLINE_RATES_LS)||[]; const row={ ...payload, id:"local_"+Date.now() }; all.unshift(row); ls.set(ONLINE_RATES_LS, all); return row;
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
    // Prix attendu recalculé (jamais inventé) à partir des 2 sources internes
    const ctx = { checkin: periodStart, checkout: periodEnd, capacity, stayNights, period_start: periodStart, period_end: periodEnd };
    const publicRate = getOurRateForContext(ourRates, ctx, accType);
    const activePromo = getActivePromoForContext(ourPromotions, ctx, accType);
    const exp = getExpectedOurOnlinePrice({ publicRate, activePromo });
    const status = onlineRateStatus({ validated: onlinePrice, expected: exp.expected_price, expectedPublic: exp.expected_public_price, expectedPromo: exp.expected_promo_price });
    try {
      await saveOurOnlineRate({
        source_name: get("source_name") || "Import CSV", source_type: get("source_type") || "other",
        period_start: periodStart, period_end: periodEnd, stay_nights: stayNights,
        accommodation_type: accType, capacity,
        expected_public_price: exp.expected_public_price, expected_promo_price: exp.expected_promo_price, expected_price: exp.expected_price,
        validated_price: onlinePrice, status, reliability_status: "importé CSV",
        notes: get("notes") || null,
      });
      ok++;
    } catch { errors++; }
  }
  return { ok, errors };
}

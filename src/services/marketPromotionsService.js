// ══════════════════════════════════════════════════════════════════
// src/services/marketPromotionsService.js
// Persistance des promotions marché (table market_promotions) + lancement
// du scan via /api/scrape-promotions. Logique pure dans domain/marketPromotions.js.
// ══════════════════════════════════════════════════════════════════
import { sb, ls, SB_READY, stripUserId } from "./supabaseClient.js";
import { normalizePromotionType } from "../domain/marketPromotions.js";
import { dateObjToISO } from "../utils/dates.js";

export const MARKET_PROMOTIONS_LS = "lescimes_market_promotions";

function isDuplicateError(e) {
  const msg = String(e?.message || e || "");
  return msg.includes("DUPLICATE") || msg.includes("23505") || msg.includes("duplicate") || msg.includes("unique");
}

// ── Lecture (avec filtres) ───────────────────────────────────────────
// filters: { station, operator, type, activeOnly, showExamples }
export async function getMarketPromotions(filters = {}) {
  let rows = [];
  if (SB_READY) {
    try {
      const parts = ["select=*", "order=collected_at.desc", "limit=500"];
      if (filters.station) parts.push(`station_name=eq.${encodeURIComponent(filters.station)}`);
      if (filters.operator) parts.push(`operator_name=eq.${encodeURIComponent(filters.operator)}`);
      if (filters.type) parts.push(`promotion_type=eq.${encodeURIComponent(filters.type)}`);
      rows = await sb.select("market_promotions", parts.join("&"));
    } catch (e) {
      console.warn("getMarketPromotions Supabase:", e?.message);
      rows = ls.get(MARKET_PROMOTIONS_LS);
    }
  } else {
    rows = ls.get(MARKET_PROMOTIONS_LS);
  }
  if (!filters.showExamples) rows = (rows || []).filter(r => r.is_example !== true);
  return rows || [];
}

// ── Enregistrement d'une promo (résultat de scan ou saisie manuelle) ─
export async function saveMarketPromotion(promo) {
  const clean = stripUserId(promo);
  if (!clean.operator_name || !clean.station_name) throw new Error("Opérateur et station requis.");

  const payload = {
    operator_name: String(clean.operator_name).trim(),
    station_name: String(clean.station_name).trim(),
    property_name: clean.property_name || null,
    offer_title: clean.offer_title || null,
    promotion_type: clean.promotion_type || normalizePromotionType(clean.original_promotion_text || clean.offer_title),
    original_promotion_text: clean.original_promotion_text || null,
    discount_percent: clean.discount_percent != null ? Number(clean.discount_percent) : null,
    original_price: clean.original_price != null ? Number(clean.original_price) : null,
    discounted_price: clean.discounted_price != null ? Number(clean.discounted_price) : null,
    starting_price: clean.starting_price != null ? Number(clean.starting_price) : null,
    capacity: clean.capacity != null ? Number(clean.capacity) : null,
    booking_start: clean.booking_start || null,
    booking_end: clean.booking_end || null,
    stay_start: clean.stay_start || null,
    stay_end: clean.stay_end || null,
    conditions: clean.conditions || null,
    source_url: clean.source_url || null,
    reliability_status: clean.reliability_status || "à vérifier",
    is_example: clean.is_example ?? false,
    raw_data: clean.raw_data || null,
    collected_at: clean.collected_at || new Date().toISOString(),
  };

  if (SB_READY) {
    try {
      const ins = await sb.insert("market_promotions", payload);
      return Array.isArray(ins) ? ins[0] : ins;
    } catch (e) {
      if (isDuplicateError(e)) throw new Error("DUPLICATE");
      throw e;
    }
  }

  const all = ls.get(MARKET_PROMOTIONS_LS);
  const dupKey = `${payload.operator_name}|${payload.station_name}|${payload.offer_title}|${payload.source_url || ""}|${String(payload.collected_at).slice(0, 10)}`;
  if (all.some(r => `${r.operator_name}|${r.station_name}|${r.offer_title}|${r.source_url || ""}|${String(r.collected_at).slice(0, 10)}` === dupKey)) {
    throw new Error("DUPLICATE");
  }
  const full = { ...payload, id: "mp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) };
  ls.push(MARKET_PROMOTIONS_LS, full);
  return full;
}

// ── Enregistrement en lot (retour du scan) ───────────────────────────
export async function saveMarketPromotionsBatch(promotions) {
  let saved = 0, duplicates = 0, errors = 0;
  const errorDetails = [];
  for (const p of promotions || []) {
    try {
      await saveMarketPromotion(p);
      saved++;
    } catch (e) {
      if (String(e?.message) === "DUPLICATE") duplicates++;
      else { errors++; errorDetails.push(e?.message || String(e)); }
    }
  }
  return { saved, duplicates, errors, errorDetails };
}

export async function deleteMarketPromotion(id) {
  if (SB_READY) return sb.delete("market_promotions", `id=eq.${id}`);
  ls.set(MARKET_PROMOTIONS_LS, ls.get(MARKET_PROMOTIONS_LS).filter(r => r.id !== id));
}

// ── Lancement d'un scan (appelle la route serveur, jamais la clé API en client) ──
export async function runPromotionsScan({ stations, operators, stayStart, stayEnd }) {
  const res = await fetch("/api/scrape-promotions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stations, operators, stayStart, stayEnd }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data?.error || `Erreur scan (HTTP ${res.status}).`);
  }
  const detected = data.promotions || [];
  const batch = await saveMarketPromotionsBatch(detected);
  return {
    detectedCount: detected.length,
    savedCount: batch.saved,
    duplicatesCount: batch.duplicates,
    errorsCount: batch.errors,
    errorDetails: batch.errorDetails,
    apiErrors: data.errors || [],
    scannedAt: dateObjToISO(new Date()),
  };
}

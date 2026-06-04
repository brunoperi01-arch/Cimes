// ══════════════════════════════════════════════════════════════════
// src/services/promotionsService.js
// Persistance des promotions Les Cimes (our_promotions).
// Supabase + repli localStorage. La logique pure vit dans
// src/domain/promotions.js (normalizePromotion, getActivePromoForContext).
//
// RÈGLE : une promo n'écrase jamais le tarif officiel. La désactivation
// passe le statut à "expiree" (jamais de suppression dure par défaut).
// ══════════════════════════════════════════════════════════════════
import { sb, ls, SB_READY } from "./supabaseClient.js";
import { OUR_PROMOTIONS_LS, normalizePromotion } from "../domain/promotions.js";

// Lecture de toutes les promotions (normalisées)
export async function getOurPromotions() {
  if (SB_READY) {
    try {
      const rows = await sb.select("our_promotions", "select=*&order=period_start.asc");
      return (rows || []).map(normalizePromotion);
    } catch (e) {
      console.warn("getOurPromotions Supabase:", e?.message);
      return (ls.get(OUR_PROMOTIONS_LS) || []).map(normalizePromotion);
    }
  }
  return (ls.get(OUR_PROMOTIONS_LS) || []).map(normalizePromotion);
}

// Création / mise à jour d'une promo (payload aligné sur le schéma SQL)
export async function saveOurPromotion(promo) {
  const pricePromo = Number(promo.price_promo ?? promo.promo_price ?? 0);
  const pricePublic = Number(promo.price_public ?? promo.public_price ?? 0);
  if (!pricePromo) throw new Error("Prix promo manquant.");
  const stayNights = Number(promo.stay_nights || 7);
  const discountPct = pricePublic > 0 ? Math.round((1 - pricePromo / pricePublic) * 100) : 0;
  const payload = {
    period_start:       promo.period_start || null,
    period_end:         promo.period_end || null,
    stay_nights:        stayNights,
    accommodation_type: promo.accommodation_type || null,
    capacity:           promo.capacity != null ? Number(promo.capacity) : null,
    public_price:       pricePublic || null,
    promo_price:        pricePromo,
    discount_pct:       discountPct,
    promo_type:         promo.promo_type || "promo",
    promo_label:        promo.promo_label || promo.period_label || null,
    promo_channel:      promo.promo_channel || promo.channel || "direct",
    start_date:         promo.start_date || promo.date_start || null,
    end_date:           promo.end_date || promo.date_end || null,
    status:             promo.status || "active",
    notes:              promo.notes || null,
  };
  if (!payload.period_start || !payload.period_end) throw new Error("Période (dates) requise.");
  if (SB_READY) {
    if (promo.id && !String(promo.id).startsWith("local_")) {
      await sb.update("our_promotions", `id=eq.${promo.id}`, payload);
      return { ...payload, id: promo.id };
    }
    const ins = await sb.insert("our_promotions", payload);
    return Array.isArray(ins) ? ins[0] : ins;
  }
  // Hors Supabase : localStorage
  const all = ls.get(OUR_PROMOTIONS_LS);
  if (promo.id) { const i = all.findIndex(x => x.id === promo.id); if (i >= 0) all[i] = { ...all[i], ...payload }; }
  else all.unshift({ ...payload, id: "local_" + Date.now() });
  ls.set(OUR_PROMOTIONS_LS, all);
  return payload;
}

// Désactivation d'une promo (statut "expiree", pas de suppression dure)
export async function deleteOurPromotion(id) {
  if (SB_READY && !String(id).startsWith("local_")) {
    await sb.update("our_promotions", `id=eq.${id}`, { status: "expiree" });
    return;
  }
  const all = ls.get(OUR_PROMOTIONS_LS);
  const i = all.findIndex(x => x.id === id);
  if (i >= 0) { all[i].status = "expiree"; ls.set(OUR_PROMOTIONS_LS, all); }
}

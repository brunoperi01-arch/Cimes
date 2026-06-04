// ══════════════════════════════════════════════════════════════════
// src/services/officialRatesService.js
// Domaine "official" — tarifs officiels décidés par Les Cimes (our_rates).
// Persistance Supabase + repli localStorage. Ne touche QUE our_rates.
// ══════════════════════════════════════════════════════════════════
import { sb, ls, SB_READY, isMissingColumnError } from "./supabaseClient.js";
import { ACCOMMODATION_TYPES } from "../domain/accommodations.js";

export const OUR_RATES_LS = "our_rates";

// Lecture de tous les tarifs officiels actifs
export async function getOurRates() {
  if (SB_READY) {
    try { return await sb.select("our_rates", "is_active=eq.true&order=updated_at.desc&select=*"); }
    catch { return []; }
  }
  return ls.get(OUR_RATES_LS);
}

// Upsert d'un tarif officiel (par period_id + capacité + durée)
export async function saveOurRate(rate) {
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
  const idx = all.findIndex(r => r.period_id === payload.period_id && Number(r.capacity) === payload.capacity && Number(r.stay_nights || 7) === payload.stay_nights);
  if (idx >= 0) { all[idx] = { ...all[idx], ...payload, updated_at: new Date().toISOString() }; }
  else { all.push({ ...payload, id: "or_" + Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); }
  ls.set(OUR_RATES_LS, all);
  return all;
}

// Suppression d'un tarif officiel
export async function deleteOurRate(id) {
  if (SB_READY) return sb.delete("our_rates", `id=eq.${id}`);
  ls.set(OUR_RATES_LS, ls.get(OUR_RATES_LS).filter(r => r.id !== id));
  return true;
}

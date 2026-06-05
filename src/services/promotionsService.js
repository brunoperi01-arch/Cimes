// ══════════════════════════════════════════════════════════════════
// src/services/promotionsService.js
// Persistance des promotions Les Cimes — câblé sur la table promotions
// (nouveau schéma 9B). Logique pure dans src/domain/promotions.js.
//
// Schéma cible promotions :
//   id | period_id uuid FK→periods (nullable) | apartment_type FK→apartment_types
//   platform_id FK→platforms (nullable) | capacity | stay_nights
//   period_start/end | sale_start/end | public_price | promo_price
//   discount_pct (GÉNÉRÉ) | promo_type | promo_channel | promo_label | status | notes
//
// RÈGLE : une promo n'écrase jamais le tarif officiel. La désactivation
// passe le statut à "expiree" (jamais de suppression dure par défaut).
// ══════════════════════════════════════════════════════════════════
import { sb, ls, SB_READY } from "./supabaseClient.js";
import { OUR_PROMOTIONS_LS, normalizePromotion } from "../domain/promotions.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Résout une clé période (uuid ou clé métier texte) → uuid de periods, ou null.
async function resolvePeriodUuid(periodIdOrKey) {
  if (!periodIdOrKey) return null;
  const v = String(periodIdOrKey);
  if (UUID_RE.test(v)) return v;
  if (!SB_READY) return null;
  try {
    const rows = await sb.select("periods", `period_id=eq.${encodeURIComponent(v)}&select=id`);
    return rows?.[0]?.id || null;
  } catch { return null; }
}

// promo_type valides (contrainte CHECK). On mappe l'ancienne valeur "promo".
const PROMO_TYPES_OK = ["promo_directe", "derniere_minute", "court_sejour", "early_booking", "other"];
function normalizePromoType(t) {
  if (PROMO_TYPES_OK.includes(t)) return t;
  return "promo_directe"; // défaut sûr (ancien "promo" → promo_directe)
}

// Lecture de toutes les promotions (normalisées)
export async function getOurPromotions() {
  if (SB_READY) {
    try {
      const rows = await sb.select("promotions", "select=*&order=period_start.asc");
      return (rows || []).map(normalizePromotion);
    } catch (e) {
      console.warn("getOurPromotions Supabase:", e?.message);
      return (ls.get(OUR_PROMOTIONS_LS) || []).map(normalizePromotion);
    }
  }
  return (ls.get(OUR_PROMOTIONS_LS) || []).map(normalizePromotion);
}

// Création / mise à jour d'une promo (payload aligné sur la table promotions)
export async function saveOurPromotion(promo) {
  const pricePromo = Number(promo.price_promo ?? promo.promo_price ?? 0);
  const pricePublic = Number(promo.price_public ?? promo.public_price ?? 0);
  if (!pricePromo) throw new Error("Prix promo manquant.");
  const stayNights = Number(promo.stay_nights || 7);

  const apartmentType = promo.apartment_type || promo.accommodation_type || null;

  // discount_pct est GÉNÉRÉ en base → on ne l'envoie pas.
  const payload = {
    apartment_type: apartmentType,
    capacity:       promo.capacity != null ? Number(promo.capacity) : null,
    stay_nights:    stayNights,
    period_start:   promo.period_start || null,
    period_end:     promo.period_end || null,
    // fenêtre de VENTE (anciennement start_date/end_date)
    sale_start:     promo.sale_start || promo.start_date || promo.date_start || null,
    sale_end:       promo.sale_end || promo.end_date || promo.date_end || null,
    public_price:   pricePublic || null,
    promo_price:    pricePromo,
    promo_type:     normalizePromoType(promo.promo_type),
    promo_channel:  promo.promo_channel || promo.channel || "direct",
    promo_label:    promo.promo_label || promo.period_label || null,
    status:         promo.status || "active",
    notes:          promo.notes || null,
  };
  if (!payload.period_start || !payload.period_end) throw new Error("Période (dates) requise.");

  if (SB_READY) {
    // period_id (FK nullable) : on tente de résoudre, sinon on laisse null
    payload.period_id = await resolvePeriodUuid(promo.period_id);
    // platform_id : déjà un uuid si fourni, sinon null
    if (promo.platform_id && UUID_RE.test(String(promo.platform_id))) {
      payload.platform_id = promo.platform_id;
    }
    if (promo.id && !String(promo.id).startsWith("local_")) {
      await sb.update("promotions", `id=eq.${promo.id}`, payload);
      return { ...payload, id: promo.id };
    }
    const ins = await sb.insert("promotions", payload);
    return Array.isArray(ins) ? ins[0] : ins;
  }

  // Repli localStorage (discount_pct calculé localement pour l'affichage)
  const payloadLs = {
    ...payload,
    discount_pct: pricePublic > 0 ? Math.round((1 - pricePromo / pricePublic) * 100) : 0,
  };
  const all = ls.get(OUR_PROMOTIONS_LS);
  if (promo.id) { const i = all.findIndex(x => x.id === promo.id); if (i >= 0) all[i] = { ...all[i], ...payloadLs }; }
  else all.unshift({ ...payloadLs, id: "local_" + Date.now() });
  ls.set(OUR_PROMOTIONS_LS, all);
  return payloadLs;
}

// Désactivation d'une promo (statut "expiree", pas de suppression dure)
export async function deleteOurPromotion(id) {
  if (SB_READY && !String(id).startsWith("local_")) {
    await sb.update("promotions", `id=eq.${id}`, { status: "expiree" });
    return;
  }
  const all = ls.get(OUR_PROMOTIONS_LS);
  const i = all.findIndex(x => x.id === id);
  if (i >= 0) { all[i].status = "expiree"; ls.set(OUR_PROMOTIONS_LS, all); }
}

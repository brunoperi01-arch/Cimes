// ══════════════════════════════════════════════════════════════════
// src/domain/promotions.js
// Logique métier des promotions Les Cimes — pure, testable hors React.
// (La persistance Supabase/localStorage vit dans les services, pas ici.)
//
// RÈGLE : une promo n'écrase jamais le tarif officiel. Elle est lue à
// part et normalisée pour accepter les deux conventions de colonnes.
// ══════════════════════════════════════════════════════════════════
import { dateObjToISO } from "../utils/dates.js";

// Clé localStorage (utilisée par le service de persistance)
export const OUR_PROMOTIONS_LS = "lescimes_our_promotions";

export const PROMO_CHANNELS = {
  direct: "Direct", booking: "Booking", tour_operator: "Tour-opérateur",
  marketplace: "Marketplace", other: "Autre",
};
export const PROMO_TYPES = {
  promo_directe: "Promo directe", derniere_minute: "Dernière minute",
  court_sejour: "Court séjour", early_booking: "Early booking", other: "Autre",
};

// Normalise une promo : accepte price_public/public_price, channel/promo_channel,
// date_start/start_date… et calcule la remise si absente.
export function normalizePromotion(p) {
  if (!p) return p;
  const price_public = p.price_public ?? p.public_price ?? null;
  const price_promo = p.price_promo ?? p.promo_price ?? null;
  const channel = p.channel ?? p.promo_channel ?? "direct";
  const date_start = p.date_start ?? p.sale_start ?? p.start_date ?? null;
  const date_end = p.date_end ?? p.sale_end ?? p.end_date ?? null;
  const pub = Number(price_public || 0), pp = Number(price_promo || 0);
  const discount_pct = p.discount_pct != null ? p.discount_pct : (pub > 0 && pp > 0 ? Math.round((1 - pp / pub) * 100) : 0);
  return {
    ...p,
    price_public, public_price: price_public,
    price_promo, promo_price: price_promo,
    channel, promo_channel: channel,
    date_start, start_date: date_start, sale_start: date_start,
    date_end, end_date: date_end, sale_end: date_end,
    discount_pct,
    promo_type: p.promo_type || "promo",
    promo_label: p.promo_label || p.period_label || null,
    status: p.status || "active",
  };
}

// Promo active correspondant au contexte (dates + durée + capacité + typologie),
// uniquement statut "active" et dans sa fenêtre de dates.
export function getActivePromoForContext(promotions, ctx, accommodationType) {
  if (!promotions?.length || !ctx) return null;
  const capacity = Number(ctx.capacity);
  const stayNights = Number(ctx.stayNights || ctx.stay_nights || 7);
  const start = ctx.checkin || ctx.period_start || ctx.week_start;
  const end = ctx.checkout || ctx.period_end;
  const accType = String(accommodationType || ctx.accommodationType || "");
  const today = dateObjToISO(new Date());
  const sameDate = (a, b) => String(a || "").slice(0, 10) === String(b || "").slice(0, 10);
  const active = promotions.map(normalizePromotion).filter(p => {
    if ((p.status || "active") !== "active") return false;
    if (p.date_start && String(p.date_start).slice(0, 10) > today) return false; // pas encore commencée
    if (p.date_end && String(p.date_end).slice(0, 10) < today) return false;     // expirée
    return true;
  });
  // 1. dates + durée + capacité + typologie
  if (accType) {
    const m = active.find(p =>
      sameDate(p.period_start, start) && sameDate(p.period_end, end) &&
      Number(p.capacity) === capacity && Number(p.stay_nights || 7) === stayNights &&
      (!p.accommodation_type || String(p.accommodation_type) === accType)
    );
    if (m) return m;
  }
  // 2. dates + durée + capacité (sans typologie)
  const byDates = active.find(p =>
    sameDate(p.period_start, start) && sameDate(p.period_end, end) &&
    Number(p.capacity) === capacity && Number(p.stay_nights || 7) === stayNights
  );
  return byDates || null;
}

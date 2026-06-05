// ══════════════════════════════════════════════════════════════════
// src/services/officialRatesService.js
// Domaine "official" — tarifs officiels décidés par Les Cimes.
// Câblé sur la table official_rates (nouveau schéma 9B).
//
// Schéma cible official_rates :
//   id uuid | period_id uuid FK→periods | apartment_type text FK→apartment_types
//   capacity | stay_nights | price_total | price_night (GÉNÉRÉ) | source | is_active
//
// Points clés du câblage :
//   - period_id côté UI = clé métier texte → on résout vers l'uuid de periods
//   - price_night est une colonne générée → JAMAIS envoyée
//   - les champs dénormalisés (period_label, surfaces…) ne sont plus stockés ici
//   - unicité : index partiel (period_id, apartment_type, stay_nights) WHERE is_active
// ══════════════════════════════════════════════════════════════════
import { sb, ls, SB_READY } from "./supabaseClient.js";

export const OUR_RATES_LS = "official_rates";

// ── Résolution period_id : accepte un uuid OU une clé métier texte ──────────
// Renvoie l'uuid de la période (colonne periods.id), ou null si introuvable.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function resolvePeriodUuid(periodIdOrKey) {
  if (!periodIdOrKey) return null;
  const v = String(periodIdOrKey);
  if (UUID_RE.test(v)) return v;                 // déjà un uuid
  if (!SB_READY) return v;                        // hors-ligne : on garde tel quel
  try {
    const rows = await sb.select("periods", `period_id=eq.${encodeURIComponent(v)}&select=id`);
    return rows?.[0]?.id || null;
  } catch { return null; }
}

// Lecture de tous les tarifs officiels actifs.
// On joint periods pour ré-hydrater period_start/period_end/stay_nights
// (la grille raisonne sur les dates), et on expose accommodation_type
// (alias de apartment_type) pour compat avec l'UI historique.
export async function getOurRates() {
  if (SB_READY) {
    try {
      const rows = await sb.select("official_rates",
        "is_active=eq.true&order=updated_at.desc&select=*,periods(period_id,period_start,period_end,stay_nights,season,category,label)");
      return (rows || []).map(r => {
        const p = r.periods || {};
        return {
          ...r,
          accommodation_type: r.apartment_type,
          period_key:         p.period_id || null,
          period_start:       r.period_start || p.period_start || null,
          period_end:         r.period_end || p.period_end || null,
          stay_nights:        r.stay_nights || p.stay_nights || 7,
          season:             r.season || p.season || null,
          period_label:       r.period_label || p.label || null,
        };
      });
    } catch (e) {
      try { return await sb.select("official_rates", "is_active=eq.true&order=updated_at.desc&select=*"); }
      catch { return []; }
    }
  }
  return ls.get(OUR_RATES_LS);
}

// Upsert d'un tarif officiel (clé : period_id + apartment_type + stay_nights)
export async function saveOurRate(rate) {
  const stayNights = Number(rate.stay_nights || 7);
  const priceTotal = Number(rate.price_total || 0);
  if (!priceTotal) throw new Error("Prix total manquant.");
  if (!rate.period_id || !rate.capacity) throw new Error("Période et capacité requises.");

  const apartmentType = rate.apartment_type || rate.accommodation_type || null;
  // source doit respecter le CHECK ('saisie','import','api'). Tout libellé de
  // saisie (grille, dashboard…) est ramené à 'saisie'.
  const src = String(rate.source || "").toLowerCase();
  const source = src.includes("import") ? "import" : (src === "api" ? "api" : "saisie");

  if (SB_READY) {
    const periodUuid = await resolvePeriodUuid(rate.period_id);
    if (!periodUuid) throw new Error("Période introuvable dans la table periods.");

    // payload aligné sur official_rates — price_night OMIS (colonne générée)
    const payload = {
      period_id:      periodUuid,
      apartment_type: apartmentType,
      capacity:       Number(rate.capacity),
      stay_nights:    stayNights,
      price_total:    priceTotal,
      source:         source,
      is_active:      true,
    };

    // Upsert via l'index unique partiel (cellule active)
    const filterParts = [
      `period_id=eq.${encodeURIComponent(periodUuid)}`,
      `stay_nights=eq.${encodeURIComponent(stayNights)}`,
      `is_active=eq.true`,
      `select=id`,
    ];
    if (apartmentType) filterParts.splice(1, 0, `apartment_type=eq.${encodeURIComponent(apartmentType)}`);
    const filter = filterParts.join("&");

    const existing = await sb.select("official_rates", filter);
    if (existing?.length) return await sb.update("official_rates", `id=eq.${existing[0].id}`, payload);
    return await sb.insert("official_rates", payload);
  }

  // ── Repli localStorage (price_night calculé localement, pas généré) ───────
  const payloadLs = {
    period_id:      rate.period_id,
    apartment_type: apartmentType,
    capacity:       Number(rate.capacity),
    stay_nights:    stayNights,
    price_total:    priceTotal,
    price_night:    rate.price_night ? Number(rate.price_night) : Math.round(priceTotal / stayNights),
    source:         source,
    is_active:      true,
  };
  const all = ls.get(OUR_RATES_LS);
  const idx = all.findIndex(r =>
    r.period_id === payloadLs.period_id &&
    (r.apartment_type || null) === (apartmentType || null) &&
    Number(r.stay_nights || 7) === stayNights
  );
  if (idx >= 0) { all[idx] = { ...all[idx], ...payloadLs, updated_at: new Date().toISOString() }; }
  else { all.push({ ...payloadLs, id: "or_" + Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); }
  ls.set(OUR_RATES_LS, all);
  return all;
}

// Suppression d'un tarif officiel
export async function deleteOurRate(id) {
  if (SB_READY) return sb.delete("official_rates", `id=eq.${id}`);
  ls.set(OUR_RATES_LS, ls.get(OUR_RATES_LS).filter(r => r.id !== id));
  return true;
}

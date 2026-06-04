// ══════════════════════════════════════════════════════════════════
// src/services/competitorRatesService.js
// Domaine "competitor" — tarifs concurrents (competitor_rates +
// competitor_catalog + competitor_sources).
// Persistance Supabase + repli localStorage.
// ══════════════════════════════════════════════════════════════════
import { sb, ls, SB_READY, stripUserId, isMissingColumnError } from "./supabaseClient.js";
import { addDaysStr, dateObjToISO } from "../utils/dates.js";
import { isOwnProperty } from "../domain/comparability.js";

export const DEFAULT_COMPETITORS = [
  { id:"cv",        name:"Les Chalets du Verdon", property_type:"résidence",  source:"Vacancéole",      comparability_score:88, has_pool:true,  has_ski_access:true  },
  { id:"cp",        name:"Central Park",           property_type:"résidence",  source:"Labellemontagne", comparability_score:82, has_pool:false, has_ski_access:false },
  { id:"goe",       name:"Goélia La Foux",          property_type:"résidence",  source:"Goélia",          comparability_score:85, has_pool:true,  has_ski_access:true  },
  { id:"ham",       name:"Hôtel du Hameau",          property_type:"hôtel",      source:"Booking",         comparability_score:55, has_pool:false, has_ski_access:true  },
  { id:"airbnb_lf", name:"Airbnb La Foux",           property_type:"particulier",source:"Airbnb",          comparability_score:60, has_pool:false, has_ski_access:false },
  { id:"bk_lf",    name:"Booking La Foux",           property_type:"particulier",source:"Booking",         comparability_score:58, has_pool:false, has_ski_access:false },
  { id:"abr_lf",   name:"Abritel La Foux",           property_type:"particulier",source:"Abritel",         comparability_score:56, has_pool:false, has_ski_access:false },
  { id:"pap_lf",   name:"PAP Vacances",              property_type:"particulier",source:"PAP",             comparability_score:48, has_pool:false, has_ski_access:false },
];

export const CATALOG_LS = "competitor_catalog";
export const SOURCES_LS = "competitor_sources";

export function enrichRates(rawRates, competitors) {
  return (rawRates||[]).map(r=>{
    const priceWeek=Number(r.price_week??r.price??0);
    const priceNight=Number(r.price_night??(priceWeek?Math.round(priceWeek/7):0));
    const comp=competitors.find(c=>c.id===r.competitor_id||c.source===r.source||c.name===r.competitor||c.name===r.property_name);
    return { ...r, price_week:priceWeek, price_night:priceNight, property_name:r.property_name??r.competitor??r.source, competitor_name:r.competitor_name??r.property_name??r.competitor??comp?.name??r.source, competitor:r.competitor??r.property_name??r.source, price:Number(r.price??r.price_week??0), source_url:r.source_url??r.url??"", comparability_score:r.competitors?.comparability_score??comp?.comparability_score??50, property_type:r.competitors?.property_type??comp?.property_type??r.property_type??r.type??"particulier", reliability_status:r.reliability_status??"à vérifier", collection_type:r.collection_type??"scraping" };
  });
}

export async function getCompetitorRates({ weekId, capacity, showExamples=false }, allCompetitors) {
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

export async function saveCompetitorRate(rate, allCompetitors) {
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
      ...(clean.source_channel && { source_channel: clean.source_channel }),
      ...(clean.source_label && { source_label: clean.source_label }),
      ...(clean.original_detected_price != null && { original_detected_price: clean.original_detected_price }),
      ...(clean.market_segment && { market_segment: clean.market_segment }),
      ...(clean.is_private_rental != null && { is_private_rental: clean.is_private_rental }),
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

export async function deleteCompetitorRate(id, weekId, capacity) {
  if (SB_READY) return sb.delete("competitor_rates",`id=eq.${id}`);
  const key=`rates_${weekId}_${capacity}`;
  ls.set(key,ls.get(key).filter(r=>r.id!==id));
}

export async function getHistoricalRates({ weekId, competitorId, capacity }) {
  if (SB_READY) return sb.select("competitor_rates",`week_id=eq.${weekId}&competitor_id=eq.${competitorId}&capacity=eq.${capacity}&order=collected_at.asc&select=*,competitors(name)`);
  return ls.get(`rates_${weekId}_${capacity}`).filter(r=>r.competitor_id===competitorId).sort((a,b)=>a.collected_at.localeCompare(b.collected_at));
}

export async function getCompetitorCatalog() {
  let rows = [];
  if (SB_READY) {
    try { rows = await sb.select("competitor_catalog", "is_active=eq.true&order=property_type.asc,name.asc&select=*"); }
    catch { rows = []; }
  } else {
    rows = ls.get(CATALOG_LS).filter(r=>r.is_active!==false);
  }
  return (rows||[]).filter(r=>!isOwnProperty(r.name));
}

export async function saveCompetitorCatalogItem(item) {
  if (!item.name) throw new Error("Nom du concurrent requis.");
  if (isOwnProperty(item.name)) throw new Error("Les Cimes ne peut pas être enregistré comme concurrent.");
  const isPrivate = item.is_private_rental === true || item.market_segment === "private" || item.property_type === "particulier" || item.property_type === "studio";
  const PRIVATE_SUBTYPES = ["particulier","studio"];
  const basePayload = {
    name:                String(item.name).trim(),
    property_type:       isPrivate ? (PRIVATE_SUBTYPES.includes(item.property_type) ? item.property_type : "particulier") : (item.property_type || "résidence"),
    platform:            item.platform || "Booking.com",
    booking_url:         item.booking_url ? normalizeBookingBaseUrl(item.booking_url) : null,
    search_location:     item.search_location || "La Foux d'Allos",
    comparability_score: Number(item.comparability_score || (isPrivate ? 60 : 80)),
    notes:               item.notes || null,
    is_active:           item.is_active !== false,
  };
  const payload = {
    ...basePayload,
    direct_url:          item.direct_url || null,
    preferred_channel:   item.preferred_channel || "booking",
    market_segment:      isPrivate ? "private" : "residence",
    is_private_rental:   isPrivate,
    ...(item.detected_capacity != null && item.detected_capacity !== "" && { detected_capacity: Number(item.detected_capacity) }),
    ...(item.detected_rooms && { detected_rooms: item.detected_rooms }),
    ...(item.detected_surface != null && item.detected_surface !== "" && { detected_surface: Number(item.detected_surface) }),
  };
  if (SB_READY) {
    try {
      if (item.id) return await sb.update("competitor_catalog", `id=eq.${item.id}`, { ...payload, updated_at:new Date().toISOString() });
      return await sb.insert("competitor_catalog", payload);
    } catch (e) {
      // Si direct_url / preferred_channel manquent encore en base, on enregistre sans.
      if (isMissingColumnError(e)) {
        if (item.id) return await sb.update("competitor_catalog", `id=eq.${item.id}`, { ...basePayload, updated_at:new Date().toISOString() });
        return await sb.insert("competitor_catalog", basePayload);
      }
      throw e;
    }
  }
  const all = ls.get(CATALOG_LS);
  if (item.id) {
    const idx = all.findIndex(r=>r.id===item.id);
    if (idx>=0) { all[idx] = { ...all[idx], ...payload, updated_at:new Date().toISOString() }; ls.set(CATALOG_LS, all); return all[idx]; }
  }
  const created = { ...payload, id:"cc_"+Date.now(), created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
  all.push(created); ls.set(CATALOG_LS, all); return created;
}

export async function deleteCompetitorCatalogItem(id) {
  if (SB_READY) return sb.delete("competitor_catalog", `id=eq.${id}`);
  ls.set(CATALOG_LS, ls.get(CATALOG_LS).filter(r=>r.id!==id));
  return true;
}

export async function getCompetitorSources() {
  if (SB_READY) {
    try { return await sb.select("competitor_sources", "is_active=eq.true&order=source_type.asc&select=*"); }
    catch { return []; }
  }
  return ls.get(SOURCES_LS).filter(r=>r.is_active!==false);
}

export async function saveCompetitorSource(source) {
  if (!source.competitor_id) throw new Error("Concurrent requis.");
  if (!source.source_url) throw new Error("URL de la source requise.");
  // Nettoyage spécifique La France du Nord au Sud : on stocke une URL vierge (sans dates)
  const isLfdnas = String(source.source_name||"").toLowerCase().includes("france du nord") || String(source.source_url||"").toLowerCase().includes("lafrancedunordausud.fr");
  const cleanedUrl = isLfdnas ? normalizeLfdnasBaseUrl(source.source_url) : source.source_url;
  const payload = {
    competitor_id: source.competitor_id,
    source_name:   source.source_name || "Autre",
    source_type:   source.source_type || "other",
    source_url:    cleanedUrl,
    notes:         source.notes || null,
    is_active:     source.is_active !== false,
  };
  if (SB_READY) {
    if (source.id) return await sb.update("competitor_sources", `id=eq.${source.id}`, { ...payload, updated_at:new Date().toISOString() });
    // Anti-doublon : même concurrent + type + URL → mise à jour
    try {
      const existing = await sb.select("competitor_sources", `competitor_id=eq.${source.competitor_id}&source_type=eq.${encodeURIComponent(source.source_type||"other")}&source_url=eq.${encodeURIComponent(cleanedUrl)}&select=id`);
      if (existing && existing.length) return await sb.update("competitor_sources", `id=eq.${existing[0].id}`, { ...payload, updated_at:new Date().toISOString() });
    } catch { /* si la requête échoue on insère */ }
    return await sb.insert("competitor_sources", payload);
  }
  const all = ls.get(SOURCES_LS);
  if (source.id) {
    const idx = all.findIndex(r=>r.id===source.id);
    if (idx>=0) { all[idx] = { ...all[idx], ...payload, updated_at:new Date().toISOString() }; ls.set(SOURCES_LS, all); return all[idx]; }
  }
  const dupIdx = all.findIndex(r=>r.competitor_id===source.competitor_id && r.source_type===payload.source_type && r.source_url===payload.source_url);
  if (dupIdx>=0) { all[dupIdx] = { ...all[dupIdx], ...payload, updated_at:new Date().toISOString() }; ls.set(SOURCES_LS, all); return all[dupIdx]; }
  const created = { ...payload, id:"cs_"+Date.now(), created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
  all.push(created); ls.set(SOURCES_LS, all); return created;
}

export async function deleteCompetitorSource(id) {
  if (SB_READY) return sb.delete("competitor_sources", `id=eq.${id}`);
  ls.set(SOURCES_LS, ls.get(SOURCES_LS).filter(r=>r.id!==id));
  return true;
}

export async function getAllCompetitorRatesHistory() {
  if (SB_READY) {
    try { return await sb.select("competitor_rates", "order=collected_at.desc&limit=1000&select=*"); }
    catch { return []; }
  }
  const keys = Object.keys(localStorage).filter(k=>k.startsWith("rates_"));
  const all = keys.flatMap(k=>ls.get(k));
  return all.sort((a,b)=>String(b.collected_at).localeCompare(String(a.collected_at))).slice(0,1000);
}

export async function correctCompetitorRate(rate, newPriceTotal, reason) {
  const newTotal = Number(newPriceTotal) || 0;
  if (!newTotal) throw new Error("Prix corrigé invalide.");
  const stayNights = Number(rate.stay_nights || 7) || 7;
  const newNight = Math.round(newTotal / stayNights);
  const oldTotal = Number(rate.price_total || rate.price_week || rate.price || 0);
  const oldNight = Number(rate.price_night || (oldTotal ? Math.round(oldTotal / stayNights) : 0));
  const editRow = {
    competitor_rate_id: rate.id,
    old_price_total: oldTotal, new_price_total: newTotal,
    old_price_night: oldNight, new_price_night: newNight,
    edit_reason: reason || null,
  };
  const ratePatch = {
    price_total: newTotal, price: newTotal, price_week: newTotal,
    price_night: newNight, price_week_equiv: Math.round(newNight * 7),
    edited_at: new Date().toISOString(), edit_reason: reason || null,
  };
  if (SB_READY) {
    try { await sb.insert("competitor_rate_edits", editRow); } catch { /* table peut manquer */ }
    try { return await sb.update("competitor_rates", `id=eq.${rate.id}`, ratePatch); }
    catch (e) {
      if (isMissingColumnError(e)) {
        const { edited_at, edit_reason, price_week_equiv, ...safe } = ratePatch;
        return await sb.update("competitor_rates", `id=eq.${rate.id}`, safe);
      }
      throw e;
    }
  }
  // localStorage : retrouver la ligne dans son bucket rates_*
  const keys = Object.keys(localStorage).filter(k=>k.startsWith("rates_"));
  for (const k of keys) {
    const arr = ls.get(k); const i = arr.findIndex(r=>r.id===rate.id);
    if (i>=0) { arr[i] = { ...arr[i], ...ratePatch }; ls.set(k, arr); break; }
  }
  const edits = ls.get("competitor_rate_edits");
  edits.push({ ...editRow, id:"cre_"+Date.now(), edited_at:new Date().toISOString() });
  ls.set("competitor_rate_edits", edits);
  return true;
}


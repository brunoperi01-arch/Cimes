// api/scrape-promotions.js
// Vercel serverless — collecte des promotions marché montagne (stations concurrentes).
// Variables requises : ANTHROPIC_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// NE JAMAIS exposer ANTHROPIC_API_KEY côté client.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SB_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const MAX_STATIONS = 3;            // stations traitées par lancement (coût)
const MAX_WEB_SEARCH_USES = 2;     // recherches web Claude par station
const MAX_PROMOS_PER_STATION = 5;
const MAX_TOKENS = 2200;
const CACHE_TTL_DAYS = 2;          // les promos évoluent plus vite que les prix
const MODEL = "claude-sonnet-4-6";

const PROMO_TYPES = [
  "remise_pourcentage", "prix_barre", "prix_appel", "derniere_minute",
  "reservation_anticipee", "deuxieme_semaine_offerte", "semaine_achetee_semaine_offerte",
  "frais_dossier_offerts", "paiement_plusieurs_fois", "offre_famille", "offre_canicule",
  "activite_incluse", "court_sejour", "code_promo", "offre_membres", "autre",
];

// ── Supabase REST helpers (cache) ──────────────────────────────────
const sbH = () => ({
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
});

async function cacheGet(cacheKey) {
  if (!SB_URL || !SB_KEY) return null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/scrape_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=listings,updated_at&limit=1`,
      { headers: sbH() }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows?.length) return null;
    const ageDays = (Date.now() - new Date(rows[0].updated_at).getTime()) / 864e5;
    if (ageDays > CACHE_TTL_DAYS) return null;
    return rows[0].listings;
  } catch {
    return null;
  }
}

async function cacheSet(payload) {
  if (!SB_URL || !SB_KEY) return;
  try {
    await fetch(`${SB_URL}/rest/v1/scrape_cache?on_conflict=cache_key`, {
      method: "POST",
      headers: { ...sbH(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
    });
  } catch {
    // échec cache non bloquant
  }
}

function buildCacheKey(station, operators, stayStart, stayEnd) {
  return ["promo", station, [...operators].sort().join(","), stayStart || "", stayEnd || ""].join("|");
}

// ── Normalisation ────────────────────────────────────────────────────
function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/\s/g, "").replace("€", "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizePromotionType(value) {
  return PROMO_TYPES.includes(value) ? value : "autre";
}

function normalizePromotions(raw, station, allowedOperators) {
  return (Array.isArray(raw) ? raw : [])
    .map(item => ({
      operator_name: String(item.operatorName || item.operator_name || "").trim(),
      station_name: station,
      property_name: item.propertyName ? String(item.propertyName).trim() : null,
      offer_title: item.offerTitle ? String(item.offerTitle).trim() : null,
      promotion_type: normalizePromotionType(item.promotionType || item.promotion_type),
      original_promotion_text: item.originalPromotionText ? String(item.originalPromotionText).trim() : null,
      discount_percent: parseNumber(item.discountPercent),
      original_price: parseNumber(item.originalPrice),
      discounted_price: parseNumber(item.discountedPrice),
      starting_price: parseNumber(item.startingPrice),
      capacity: item.capacity != null ? Math.round(parseNumber(item.capacity) || 0) || null : null,
      booking_start: parseDate(item.bookingStart),
      booking_end: parseDate(item.bookingEnd),
      stay_start: parseDate(item.stayStart),
      stay_end: parseDate(item.stayEnd),
      conditions: item.conditions ? String(item.conditions).trim() : null,
      source_url: item.sourceUrl ? String(item.sourceUrl).trim() : null,
      reliability_status: item.reliabilityStatus === "vérifié" ? "vérifié" : "à vérifier",
      raw_data: item,
    }))
    .filter(p => p.operator_name && (!allowedOperators?.length || allowedOperators.some(o => o.toLowerCase() === p.operator_name.toLowerCase())))
    .slice(0, MAX_PROMOS_PER_STATION);
}

// ── Extraction JSON robuste (tableau) ─────────────────────────────────
function extractFirstJsonArray(text) {
  if (!text || typeof text !== "string") return null;
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
  let start = -1, depth = 0, inString = false, escape = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") { if (depth === 0) start = i; depth++; continue; }
    if (ch === "]") { depth--; if (depth === 0 && start !== -1) return cleaned.slice(start, i + 1); }
  }
  return null;
}

// ── Récupération d'un tableau JSON tronqué ─────────────────────────────
// Si la réponse a été coupée en cours de génération (fin de budget de tokens),
// le tableau ne se referme jamais. On garde les objets top-level déjà complets
// et on ignore l'objet en cours de troncature plutôt que de tout rejeter.
function salvageTruncatedJsonArray(text) {
  if (!text || typeof text !== "string") return null;
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
  const start = cleaned.indexOf("[");
  if (start === -1) return null;

  let depth = 0, inString = false, escape = false, lastCompleteEnd = -1;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[" || ch === "{") { depth++; continue; }
    if (ch === "]" || ch === "}") {
      const wasObjectClose = ch === "}" && depth === 2; // objet top-level dans le tableau
      depth--;
      if (wasObjectClose && depth === 1) lastCompleteEnd = i + 1; // juste après le "}"
    }
  }
  if (lastCompleteEnd === -1) return null; // aucun objet complet récupérable
  return cleaned.slice(start, lastCompleteEnd) + "]";
}

function safeJsonParseArray(text) {
  const jsonText = extractFirstJsonArray(text);
  if (!jsonText) {
    const salvaged = salvageTruncatedJsonArray(text);
    if (salvaged) {
      try {
        const parsed = JSON.parse(salvaged);
        if (Array.isArray(parsed) && parsed.length) return { ok: true, data: parsed, salvaged: true };
      } catch {
        // tombe dans l'erreur finale ci-dessous
      }
    }
    return { ok: false, error: "Aucun tableau JSON trouvé.", raw: String(text || "").slice(0, 1000) };
  }
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return { ok: false, error: "Le JSON trouvé n'est pas un tableau.", raw: jsonText.slice(0, 1000) };
    return { ok: true, data: parsed };
  } catch (firstError) {
    try {
      const repaired = jsonText.replace(/,\s*]/g, "]").replace(/,\s*}/g, "}").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
      const parsed = JSON.parse(repaired);
      if (!Array.isArray(parsed)) return { ok: false, error: "Le JSON réparé n'est pas un tableau.", raw: repaired.slice(0, 1000) };
      return { ok: true, data: parsed };
    } catch (secondError) {
      const salvaged = salvageTruncatedJsonArray(jsonText);
      if (salvaged) {
        try {
          const parsed = JSON.parse(salvaged);
          if (Array.isArray(parsed) && parsed.length) return { ok: true, data: parsed, salvaged: true };
        } catch {
          // échec définitif, on retombe sur l'erreur ci-dessous
        }
      }
      return { ok: false, error: secondError.message || firstError.message, raw: jsonText.slice(0, 1000) };
    }
  }
}

// ── Prompt Claude ────────────────────────────────────────────────────
function buildPrompt(station, operators, stayStart, stayEnd) {
  const period = stayStart && stayEnd ? `Période de séjour ciblée : ${stayStart} au ${stayEnd}.` : "Aucune période précise imposée : cherche les promotions actuellement affichées.";
  return (
    `Find CURRENT promotional offers for mountain vacation rentals in ${station}, France, ` +
    `from these operators ONLY: ${operators.join(", ")}.\n` +
    `${period}\n` +
    `Look for real, currently displayed promotions (percentage discounts, crossed-out prices, ` +
    `last-minute deals, early-booking deals, "buy one week get one free", free booking fees, etc.).\n` +
    `Return maximum ${MAX_PROMOS_PER_STATION} offers, only for the operators listed above. ` +
    `If you find more, return only the ${MAX_PROMOS_PER_STATION} most relevant ones — ` +
    `always prefer fewer COMPLETE offers over more TRUNCATED ones.\n\n` +
    `STRICT RULES — read carefully:\n` +
    `- Return ONLY offers you actually found in the sources you consulted. Do not return anything if you found nothing.\n` +
    `- Never invent a promotion, a price, a discount, a date, or a URL. Any unknown value must be null, never guessed.\n` +
    `- A general/nationwide campaign from an operator may only be recorded if the source explicitly states it applies ` +
    `to mountain destinations or to ${station} specifically. If the source is a generic homepage banner with no such ` +
    `mention, do not record it.\n` +
    `- Do not turn a plain pricing/booking page into a promotion. A promotion requires an explicit discount, deadline, ` +
    `or special condition — not just a price being displayed.\n` +
    `- percentage and price fields must be plain numbers (e.g. 30, 349) — never include a % sign or a currency symbol.\n\n` +
    `Return ONLY valid JSON, and no text of any kind outside that JSON structure. No markdown. No comments. ` +
    `No explanations before or after. No trailing commas. The response must start with [ and end with ]. ` +
    `Use double quotes for all keys and string values.\n\n` +
    `The field "promotionType" must be exactly one of: ${PROMO_TYPES.join(", ")}.\n\n` +
    `JSON schema:\n` +
    `[{"operatorName":"Vacancéole","stationName":"${station}","propertyName":"Nom du bien ou null",` +
    `"offerTitle":"Titre de l'offre","promotionType":"derniere_minute","originalPromotionText":"texte exact vu sur le site",` +
    `"discountPercent":30,"originalPrice":null,"discountedPrice":null,"startingPrice":349,"capacity":null,` +
    `"bookingStart":null,"bookingEnd":"2026-08-10","stayStart":"2026-07-25","stayEnd":"2026-08-31",` +
    `"conditions":"Selon disponibilités","sourceUrl":"https://...","reliabilityStatus":"à vérifier"}]`
  );
}

// ── Handler principal ──────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante sur Vercel." });

  const { stations = [], operators = [], stayStart = null, stayEnd = null } = req.body || {};

  if (!Array.isArray(stations) || !stations.length) return res.status(400).json({ error: "stations requis (au moins une)." });
  if (!Array.isArray(operators) || !operators.length) return res.status(400).json({ error: "operators requis (au moins un)." });

  const targetStations = stations.slice(0, MAX_STATIONS);
  if (stations.length > MAX_STATIONS) {
    return res.status(400).json({
      error: `Trop de stations : ${stations.length}. Maximum ${MAX_STATIONS} par lancement. Relance en plusieurs fois.`,
    });
  }

  const allPromotions = [];
  const errors = [];

  for (const station of targetStations) {
    const cacheKey = buildCacheKey(station, operators, stayStart, stayEnd);
    const cached = await cacheGet(cacheKey);
    if (cached && cached.length) {
      allPromotions.push(...cached);
      continue;
    }

    const prompt = buildPrompt(station, operators, stayStart, stayEnd);

    try {
      const aRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "web-search-2025-03-05",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: "You are a mountain resort promotions analyst. Use web search when needed. Return only a valid JSON array. No markdown. No explanation. Never invent missing data.",
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_SEARCH_USES }],
        }),
      });

      if (aRes.status === 429) {
        const retry = aRes.headers.get("retry-after");
        errors.push({ station, error: `Rate limit Anthropic.${retry ? ` Retry-After: ${retry}s.` : " Réessayez dans quelques secondes."}` });
        continue;
      }

      const data = await aRes.json();
      if (!aRes.ok || data.error) throw new Error(data?.error?.message || `Erreur Anthropic HTTP ${aRes.status}`);

      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      const parsed = safeJsonParseArray(text);

      if (!parsed.ok) {
        errors.push({ station, error: "JSON malformé dans la réponse Claude.", parse_error: parsed.error, raw_excerpt: parsed.raw });
        continue;
      }
      if (parsed.salvaged) {
        errors.push({ station, error: "Réponse tronquée par Claude — offres complètes récupérées, la dernière offre incomplète a été ignorée.", warning: true });
      }

      const normalized = normalizePromotions(parsed.data, station, operators);
      allPromotions.push(...normalized);
      await cacheSet({ cache_key: cacheKey, listings: normalized });
    } catch (e) {
      errors.push({ station, error: e.message || "Erreur inconnue." });
    }
  }

  return res.status(200).json({ success: true, promotions: allPromotions, errors });
}

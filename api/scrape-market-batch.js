// api/scrape-market-batch.js
// Vercel serverless — NE PAS modifier VITE_* côté serveur
// Variables requises : ANTHROPIC_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SB_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const MAX_COMBOS = 1;              // 1 période × 1 capacité
const MAX_WEB_SEARCH_USES = 1;     // 1 recherche web Claude
const MAX_LISTINGS = 5;            // 5 logements max
const MAX_TOKENS = 900;
const CACHE_TTL_DAYS = 7;
const MODEL = "claude-sonnet-4-6";

// ── Supabase REST helpers ──────────────────────────────────────
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
      `${SB_URL}/rest/v1/scrape_cache?cache_key=eq.${encodeURIComponent(
        cacheKey
      )}&select=listings,updated_at&limit=1`,
      { headers: sbH() }
    );

    if (!r.ok) return null;

    const rows = await r.json();
    if (!rows?.length) return null;

    const ageDays =
      (Date.now() - new Date(rows[0].updated_at).getTime()) / 864e5;

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
      headers: {
        ...sbH(),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        ...payload,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Échec cache non bloquant
  }
}

// ── Helpers dates / cache ──────────────────────────────────────
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildCacheKey(
  season,
  periodStart,
  periodEnd,
  stayNights,
  capacity,
  propertyTypes,
  platforms
) {
  return [
    season,
    periodStart,
    periodEnd,
    stayNights,
    capacity,
    [...propertyTypes].sort().join(","),
    [...platforms].sort().join(","),
  ].join("|");
}

// ── Normalisation ──────────────────────────────────────────────
function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value)
    .replace(/\s/g, "")
    .replace("€", "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizePropertyType(value) {
  const v = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (v.includes("residence") || v.includes("vacanceole") || v.includes("goelia")) {
    return "résidence";
  }

  if (v.includes("hotel") || v.includes("hôtel") || v.includes("apart-hotel")) {
    return "hôtel";
  }

  return "particulier";
}

function normalizePlatform(value, allowedPlatforms = ["Booking.com"]) {
  const v = String(value || "").toLowerCase();

  if (v.includes("booking")) return "Booking.com";
  if (v.includes("airbnb")) return "Airbnb";
  if (v.includes("abritel") || v.includes("vrbo")) return "Abritel";

  return allowedPlatforms[0] || "Booking.com";
}

function normalizeListings(raw, stayNights, allowedPlatforms, propertyTypes) {
  return (Array.isArray(raw) ? raw : [])
    .map(item => {
      const platform = normalizePlatform(item.platform || item.source, allowedPlatforms);
      const propertyType = normalizePropertyType(item.property_type || item.type);

      let total = parseNumber(item.price_total ?? item.price_week ?? item.price);
      let night = parseNumber(item.price_night ?? item.night_price);

      if (!total && night) {
        total = Math.round(night * stayNights);
      }

      if (!night && total) {
        night = Math.round(total / stayNights);
      }

      const equiv = night ? Math.round(night * 7) : null;

      return {
        name: String(item.name || item.title || "Inconnu").trim(),
        property_type: propertyType,
        platform,
        price_total: total,
        price: total,
        price_week: total,
        price_night: night,
        price_week_equiv: equiv,
        stay_nights: stayNights,
        capacity: parseNumber(item.capacity) || null,
        rating: parseNumber(item.rating),
        url: String(item.url || "").trim(),
      };
    })
    .filter(item => item.name && item.price_total)
    .filter(item => {
      return !propertyTypes?.length || propertyTypes.includes(item.property_type);
    })
    .filter(item => {
      return !allowedPlatforms?.length || allowedPlatforms.includes(item.platform);
    });
}

// ── Extraction JSON robuste ────────────────────────────────────
function extractFirstJsonArray(text) {
  if (!text || typeof text !== "string") return null;

  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "[") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === "]") {
      depth--;
      if (depth === 0 && start !== -1) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  return null;
}

function safeJsonParseArray(text) {
  const jsonText = extractFirstJsonArray(text);

  if (!jsonText) {
    return {
      ok: false,
      error: "Aucun tableau JSON trouvé.",
      raw: String(text || "").slice(0, 1000),
    };
  }

  try {
    const parsed = JSON.parse(jsonText);

    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        error: "Le JSON trouvé n'est pas un tableau.",
        raw: jsonText.slice(0, 1000),
      };
    }

    return { ok: true, data: parsed };
  } catch (firstError) {
    try {
      const repaired = jsonText
        .replace(/,\s*]/g, "]")
        .replace(/,\s*}/g, "}")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'");

      const parsed = JSON.parse(repaired);

      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          error: "Le JSON réparé n'est pas un tableau.",
          raw: repaired.slice(0, 1000),
        };
      }

      return { ok: true, data: parsed };
    } catch (secondError) {
      return {
        ok: false,
        error: secondError.message || firstError.message,
        raw: jsonText.slice(0, 1000),
      };
    }
  }
}

// ── Prompt Claude ──────────────────────────────────────────────
function buildPrompt(
  week,
  capacity,
  propertyTypes,
  season,
  stayNights,
  periodStart,
  periodEnd,
  maxListings,
  platforms
) {
  const seasonLabel = season === "hiver" ? "hiver ski" : "été";
  const types = propertyTypes.join(", ");
  const plats = platforms && platforms.length ? platforms : ["Booking.com"];

  const platformLine =
    plats.length === 1
      ? `Search ONLY ${plats[0]}. Do not use any other website.`
      : `Search ONLY these platforms: ${plats.join(", ")}. Do not use any other website.`;

  return (
    `Find real accommodation prices in La Foux d'Allos / Val d'Allos, France.\n` +
    `Season: ${seasonLabel}.\n` +
    `${platformLine}\n` +
    `Check-in: ${periodStart}. Check-out: ${periodEnd}. Nights: ${stayNights}. Guests: ${capacity}.\n` +
    `Types: ${types}. Return maximum ${maxListings} listings.\n\n` +
    `Return ONLY valid JSON.\n` +
    `No markdown. No comments. No citations. No explanations. No trailing commas.\n` +
    `Use double quotes for all keys and string values.\n` +
    `The response must start with [ and end with ].\n` +
    `The field "platform" must be exactly one of: ${plats.join(", ")}.\n\n` +
    `JSON schema:\n` +
    `[{"name":"Nom du logement","property_type":"résidence","platform":"${plats[0]}","price_total":595,"price_night":85,"stay_nights":${stayNights},"capacity":${capacity},"rating":8.2,"url":"https://..."}]`
  );
}

// ── Handler principal ──────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!ANTHROPIC_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY manquante sur Vercel.",
    });
  }

  const {
    season = "ete",
    stayNights = 7,
    weeks = [],
    capacities = [6],
    propertyTypes = ["résidence", "particulier"],
    platforms = ["Booking.com"],
    maxListingsPerSearch = 5,
    forceRefresh = false,
  } = req.body || {};

  const plats =
    Array.isArray(platforms) && platforms.length
      ? platforms
      : ["Booking.com"];

  const maxListings = Math.min(
    Number(maxListingsPerSearch) || MAX_LISTINGS,
    MAX_LISTINGS
  );

  if (!weeks.length || !capacities.length) {
    return res.status(400).json({
      error: "weeks et capacities requis.",
    });
  }

  const requestedCombos = weeks.length * capacities.length;

  if (requestedCombos > MAX_COMBOS) {
    return res.status(400).json({
      error:
        `Trop large : ${requestedCombos} combinaison(s). ` +
        `Maximum ${MAX_COMBOS} par lancement. ` +
        `Lance 1 période × 1 capacité.`,
    });
  }

  const nights = parseInt(stayNights, 10) || 7;

  const combos = [];

  for (const week of weeks) {
    for (const cap of capacities) {
      combos.push({
        week,
        capacity: parseInt(cap, 10),
      });
    }
  }

  const results = [];
  let anthropicCalls = 0;

  for (const { week, capacity } of combos) {
    const periodStart = week.week_start;

    if (!periodStart) {
      results.push({
        week_id: week.id,
        week_label: week.label,
        listings: [],
        error: "week_start manquant pour cette période.",
        warning: null,
      });
      continue;
    }

    const periodEnd = addDays(periodStart, nights);

    const cacheKey = buildCacheKey(
      season,
      periodStart,
      periodEnd,
      nights,
      capacity,
      propertyTypes,
      plats
    );

    const base = {
      week_id: week.id,
      week_label: week.label,
      period_start: periodStart,
      period_end: periodEnd,
      season,
      stay_nights: nights,
      capacity,
      property_types: propertyTypes,
      platforms: plats,
      listings: [],
      from_cache: false,
      error: null,
      warning: null,
    };

    if (!forceRefresh) {
      const cached = await cacheGet(cacheKey);

      if (cached && cached.length > 0) {
        results.push({
          ...base,
          listings: cached,
          from_cache: true,
        });
        continue;
      }
    }

    if (anthropicCalls >= MAX_COMBOS) {
      results.push({
        ...base,
        error:
          `Limite ${MAX_COMBOS} appel Anthropic atteinte pour ce lancement. ` +
          `Relance plus tard ou utilise le cache.`,
      });
      continue;
    }

    const prompt = buildPrompt(
      week,
      capacity,
      propertyTypes,
      season,
      nights,
      periodStart,
      periodEnd,
      maxListings,
      plats
    );

    try {
      anthropicCalls++;

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
          system:
            "You are a vacation rental price analyst. Use web search when needed. Return only a valid JSON array. No markdown. No explanation.",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: MAX_WEB_SEARCH_USES,
            },
          ],
        }),
      });

      if (aRes.status === 429) {
        const retry = aRes.headers.get("retry-after");

        results.push({
          ...base,
          error: `Rate limit Anthropic.${
            retry ? ` Retry-After: ${retry}s.` : " Réessayez dans quelques secondes."
          }`,
        });

        continue;
      }

      const data = await aRes.json();

      if (!aRes.ok || data.error) {
        throw new Error(data?.error?.message || `Erreur Anthropic HTTP ${aRes.status}`);
      }

      const text = (data.content || [])
        .filter(block => block.type === "text")
        .map(block => block.text)
        .join("\n");

      const parsed = safeJsonParseArray(text);

      if (!parsed.ok) {
        results.push({
          ...base,
          warning: "JSON malformé dans la réponse Claude.",
          parse_error: parsed.error,
          raw_response: parsed.raw,
        });

        continue;
      }

      const listings = normalizeListings(
        parsed.data,
        nights,
        plats,
        propertyTypes
      ).slice(0, maxListings);

      await cacheSet({
        cache_key: cacheKey,
        season,
        period_label: week.label,
        period_start: periodStart,
        period_end: periodEnd,
        stay_nights: nights,
        capacity,
        property_types: propertyTypes,
        listings,
        source: "anthropic_web_search:" + plats.join(","),
        created_at: new Date().toISOString(),
      });

      results.push({
        ...base,
        listings,
        warning:
          listings.length === 0
            ? "Aucun logement exploitable trouvé dans la réponse Claude."
            : null,
      });
    } catch (err) {
      results.push({
        ...base,
        error: err.message,
      });
    }
  }

  return res.status(200).json({
    results,
    usage: {
      anthropic_calls: anthropicCalls,
      combinations_processed: combos.length,
      combinations_total: requestedCombos,
      from_cache_count: results.filter(r => r.from_cache).length,
    },
    limits: {
      max_combinations: MAX_COMBOS,
      max_listings_per_search: MAX_LISTINGS,
      max_web_search_uses: MAX_WEB_SEARCH_USES,
      cache_ttl_days: CACHE_TTL_DAYS,
    },
  });
}

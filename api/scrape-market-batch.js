// api/scrape-market-batch.js
// Vercel serverless — NE PAS modifier VITE_* côté serveur
// Variables requises : ANTHROPIC_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const SB_URL         = process.env.VITE_SUPABASE_URL  || process.env.SUPABASE_URL  || "";
const SB_KEY         = process.env.SUPABASE_SERVICE_ROLE_KEY
                    || process.env.VITE_SUPABASE_ANON_KEY || "";

const MAX_COMBOS          = 1;     // max combinaisons par appel pour éviter les rate limits
const MAX_WEB_SEARCH_USES = 1;     // max web_search à l'intérieur d'un appel Claude
const MAX_LISTINGS        = 5;     // max logements retournés par recherche
const MAX_TOKENS          = 900;
const CACHE_TTL_DAYS      = 7;
const MODEL               = "claude-sonnet-4-6";

// ── Supabase REST helpers ──────────────────────────────────────
const sbH = () => ({
  "apikey":        SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Content-Type":  "application/json",
  "Prefer":        "return=representation",
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
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        ...payload,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    // cache failure non bloquante
  }
}

// ── Helpers ───────────────────────────────────────────────────
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

function normalizeListings(raw, stayNights) {
  return (Array.isArray(raw) ? raw : []).map(item => {
    let total = item.price_total ?? item.price_week ?? null;
    let night = item.price_night ?? null;

    if (!total && night) {
      total = Math.round(night * stayNights);
    }

    if (!night && total) {
      night = Math.round(total / stayNights);
    }

    const equiv = night ? Math.round(night * 7) : null;

    return {
      name: String(item.name || "Inconnu"),
      property_type: item.property_type || "particulier",
      platform: item.platform || "",
      price_total: total,
      price: total,
      price_week: total,
      price_night: night,
      price_week_equiv: equiv,
      stay_nights: stayNights,
      capacity: item.capacity ?? null,
      rating: item.rating ?? null,
      url: item.url || "",
    };
  });
}

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
  const seasonLabel = season === "hiver" ? "hiver (ski)" : "été";
  const types = propertyTypes.join(", ");
  const plats = platforms && platforms.length ? platforms : ["Booking.com"];

  const platLine =
    plats.length === 1
      ? `Search ONLY ${plats[0]} for real vacation rental prices.`
      : `Search ONLY these platforms: ${plats.join(", ")}. Do not use any other site.`;

  return (
    `La Foux d'Allos (Val d'Allos), Alpes-de-Haute-Provence, France. Saison ${seasonLabel}.\n` +
    `${platLine}\n` +
    `Check-in ${periodStart}, check-out ${periodEnd}, ${stayNights} nuit(s), ${capacity} pers.\n` +
    `Types: ${types}. Max ${maxListings} logements.\n` +
    `Le champ "platform" doit contenir uniquement une des plateformes demandées : ${plats.join(", ")}.\n` +
    `JSON uniquement, sans backticks, sans texte autour :\n` +
    `[{"name":"...","property_type":"résidence","platform":"${plats[0]}",` +
    `"price_total":595,"price_night":85,"stay_nights":${stayNights},"capacity":${capacity},"rating":8.2,"url":"https://..."}]`
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
    maxListingsPerSearch = 6,
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
        `Maximum ${MAX_COMBOS} par lancement pour éviter les rate limits Anthropic. ` +
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

    // ── Cache lookup ───────────────────────────────────────────
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

    // ── Limite appels Anthropic ────────────────────────────────
    if (anthropicCalls >= MAX_COMBOS) {
      results.push({
        ...base,
        error:
          `Limite ${MAX_COMBOS} appel Anthropic atteinte pour ce lancement. ` +
          `Relancez plus tard ou utilisez le cache.`,
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
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system:
            "Tu es un analyste prix locations vacances. Utilise web search pour trouver des prix réels. Réponds UNIQUEMENT avec un tableau JSON valide, sans backticks, sans aucun texte avant ou après.",
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

      if (data.error) {
        throw new Error(data.error.message);
      }

      const text = (data.content || [])
        .filter(block => block.type === "text")
        .map(block => block.text)
        .join("\n");

      const match = text.match(/\[[\s\S]*\]/);

      if (!match) {
        results.push({
          ...base,
          warning: "Aucun JSON trouvé dans la réponse Claude. Réessayez.",
        });

        continue;
      }

      let rawListings;

      try {
        rawListings = JSON.parse(match[0]);
      } catch {
        results.push({
          ...base,
          warning: "JSON malformé dans la réponse Claude.",
        });

        continue;
      }

      const listings = normalizeListings(rawListings, nights)
        .filter(item => {
          return !propertyTypes?.length || propertyTypes.includes(item.property_type);
        })
        .filter(item => {
          return !plats?.length || plats.includes(item.platform);
        })
        .slice(0, maxListings);

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

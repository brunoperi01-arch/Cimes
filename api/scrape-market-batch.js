// api/scrape-market-batch.js
// Vercel serverless — NE PAS modifier VITE_* côté serveur
// Variables requises : ANTHROPIC_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const SB_URL         = process.env.VITE_SUPABASE_URL  || process.env.SUPABASE_URL  || "";
const SB_KEY         = process.env.SUPABASE_SERVICE_ROLE_KEY
                    || process.env.VITE_SUPABASE_ANON_KEY || "";

const MAX_COMBOS     = 2;     // max combinaisons par appel
const MAX_WEB_SEARCH = 2;     // max tool calls Claude
const CACHE_TTL_DAYS = 7;
const MODEL          = "claude-sonnet-4-6";

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
    await fetch(`${SB_URL}/rest/v1/scrape_cache`, {
      method:  "POST",
      headers: { ...sbH(), "Prefer": "resolution=merge-duplicates,return=minimal" },
      body:    JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
    });
  } catch { /* cache failure non bloquante */ }
}

// ── Helpers ───────────────────────────────────────────────────
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildCacheKey(season, periodStart, periodEnd, stayNights, capacity, propertyTypes) {
  return [season, periodStart, periodEnd, stayNights, capacity, [...propertyTypes].sort().join(",")].join("|");
}

function normalizeListings(raw, stayNights) {
  return (Array.isArray(raw) ? raw : []).map(item => {
    let total  = item.price_total ?? item.price_week ?? null;
    let night  = item.price_night ?? null;

    if (!total && night)  total = Math.round(night * stayNights);
    if (!night && total)  night = Math.round(total / stayNights);
    const equiv = night ? Math.round(night * 7) : null;

    return {
      name:            String(item.name || "Inconnu"),
      property_type:   item.property_type || "particulier",
      platform:        item.platform || "",
      price_total:     total,
      price:           total,          // compat competitor_rates.price
      price_week:      total,          // compat
      price_night:     night,
      price_week_equiv: equiv,         // indicatif uniquement
      stay_nights:     stayNights,
      capacity:        item.capacity   ?? null,
      rating:          item.rating     ?? null,
      url:             item.url        || "",
    };
  });
}

function buildPrompt(week, capacity, propertyTypes, season, stayNights, periodStart, periodEnd, maxListings) {
  const seasonLabel = season === "hiver" ? "hiver (ski)" : "été";
  const types       = propertyTypes.join(", ");
  return (
    `La Foux d'Allos (Val d'Allos), Alpes-de-Haute-Provence. Saison ${seasonLabel}.\n` +
    `Check-in ${periodStart}, check-out ${periodEnd}, ${stayNights} nuit(s), ${capacity} pers.\n` +
    `Types: ${types}. Max ${maxListings} logements.\n` +
    `JSON uniquement, sans backticks, sans texte autour :\n` +
    `[{"name":"...","property_type":"résidence","platform":"Booking.com",` +
    `"price_total":595,"price_night":85,"stay_nights":${stayNights},"capacity":${capacity},"rating":8.2,"url":"https://..."}]`
  );
}

// ── Handler principal ──────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante sur Vercel." });

  const {
    season              = "ete",
    stayNights          = 7,
    weeks               = [],
    capacities          = [6],
    propertyTypes       = ["résidence", "particulier"],
    maxListingsPerSearch = 6,
    forceRefresh        = false,
  } = req.body || {};

  if (!weeks.length || !capacities.length) {
    return res.status(400).json({ error: "weeks et capacities requis." });
  }

  // Règle métier : ne jamais mélanger 7n/2n ni été/hiver dans un même appel
  // (la validation est faite côté client ; ici on fait confiance au payload)
  const nights = parseInt(stayNights, 10) || 7;

  // Construire les combinaisons (max MAX_COMBOS)
  const combos = [];
  outer: for (const week of weeks) {
    for (const cap of capacities) {
      combos.push({ week, capacity: parseInt(cap, 10) });
      if (combos.length >= MAX_COMBOS) break outer;
    }
  }

  const results       = [];
  let   anthropicCalls = 0;

  for (const { week, capacity } of combos) {
    const periodStart = week.week_start;
    const periodEnd   = addDays(periodStart, nights);
    const cacheKey    = buildCacheKey(season, periodStart, periodEnd, nights, capacity, propertyTypes);

    const base = {
      week_id:        week.id,
      week_label:     week.label,
      period_start:   periodStart,
      period_end:     periodEnd,
      season,
      stay_nights:    nights,
      capacity,
      property_types: propertyTypes,
      listings:       [],
      from_cache:     false,
      error:          null,
      warning:        null,
    };

    // ── Cache lookup ───────────────────────────────────────────
    if (!forceRefresh) {
      const cached = await cacheGet(cacheKey);
      if (cached && cached.length > 0) {
        results.push({ ...base, listings: cached, from_cache: true });
        continue;
      }
    }

    // ── Limite appels Anthropic ────────────────────────────────
    if (anthropicCalls >= MAX_WEB_SEARCH) {
      results.push({ ...base, error: `Limite ${MAX_WEB_SEARCH} appels Anthropic atteinte pour cet appel. Relancez pour la suite.` });
      continue;
    }

    // ── Appel Claude ───────────────────────────────────────────
    const prompt = buildPrompt(week, capacity, propertyTypes, season, nights, periodStart, periodEnd, maxListingsPerSearch);

    try {
      anthropicCalls++;

      const aRes = await fetch("https://api.anthropic.com/v1/messages", {
        method:  "POST",
        headers: {
          "Content-Type":    "application/json",
          "x-api-key":       ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta":  "web-search-2025-03-05",
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: 1100,
          system:     "Tu es un analyste prix locations vacances. Utilise web search pour trouver des prix réels. Réponds UNIQUEMENT avec un tableau JSON valide, sans backticks, sans aucun texte avant ou après.",
          messages:   [{ role: "user", content: prompt }],
          tools:      [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });

      // Rate limit
      if (aRes.status === 429) {
        const retry = aRes.headers.get("retry-after");
        results.push({ ...base, error: `Rate limit Anthropic.${retry ? ` Retry-After: ${retry}s.` : " Réessayez dans quelques secondes."}` });
        continue;
      }

      const data = await aRes.json();
      if (data.error) throw new Error(data.error.message);

      // Extraire le JSON depuis le texte
      const text  = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      const match = text.match(/\[[\s\S]*\]/);

      if (!match) {
        results.push({ ...base, warning: "Aucun JSON trouvé dans la réponse Claude. Réessayez." });
        continue;
      }

      let rawListings;
      try {
        rawListings = JSON.parse(match[0]);
      } catch {
        results.push({ ...base, warning: "JSON malformé dans la réponse Claude." });
        continue;
      }

      const listings = normalizeListings(rawListings, nights);

      // ── Stocker en cache ────────────────────────────────────
      await cacheSet({
        cache_key:      cacheKey,
        season,
        period_label:   week.label,
        period_start:   periodStart,
        period_end:     periodEnd,
        stay_nights:    nights,
        capacity,
        property_types: propertyTypes,
        listings,
        source:         "anthropic_web_search",
        created_at:     new Date().toISOString(),
      });

      results.push({ ...base, listings });

    } catch (err) {
      results.push({ ...base, error: err.message });
    }
  }

  return res.status(200).json({
    results,
    usage: {
      anthropic_calls:       anthropicCalls,
      combinations_processed: combos.length,
      combinations_total:     weeks.length * capacities.length,
      from_cache_count:       results.filter(r => r.from_cache).length,
    },
    limits: {
      max_combinations:         MAX_COMBOS,
      max_listings_per_search:  maxListingsPerSearch,
      max_web_search_calls:     MAX_WEB_SEARCH,
      cache_ttl_days:           CACHE_TTL_DAYS,
    },
  });
}

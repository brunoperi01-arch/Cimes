// api/scrape-market-batch.js
// Endpoint batch pour scraper plusieurs semaines × capacités en séquentiel
// À placer dans /api/scrape-market-batch.js à la racine du projet Vercel
// Variable d'environnement requise : ANTHROPIC_API_KEY côté serveur uniquement
//
// Version optimisée pour éviter l'erreur Anthropic :
// "rate limit of 30,000 input tokens per minute"
// Conseils d'usage : 1 ou 2 combinaisons par lancement.

const MAX_COMBINATIONS = 2;
const MAX_LISTINGS_PER_SEARCH = 6;
const MAX_WEB_SEARCH_USES = 2;
const MAX_TOKENS = 1100;

function extractJsonArray(text) {
  if (!text || typeof text !== "string") return null;

  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");

  if (first === -1 || last === -1 || last <= first) {
    return null;
  }

  return text.slice(first, last + 1);
}

function normalizePropertyType(value) {
  const type = String(value || "").toLowerCase().trim();

  if (type.includes("résidence") || type.includes("residence")) {
    return "résidence";
  }

  if (type.includes("hotel") || type.includes("hôtel") || type.includes("apart")) {
    return "hôtel";
  }

  if (type.includes("particulier") || type.includes("airbnb") || type.includes("host")) {
    return "particulier";
  }

  return "particulier";
}

function normalizePlatform(value) {
  const platform = String(value || "").trim();

  if (/airbnb/i.test(platform)) return "Airbnb";
  if (/booking/i.test(platform)) return "Booking.com";
  if (/abritel|vrbo/i.test(platform)) return "Abritel";

  return platform || "Web";
}

function normalizeListing(listing, capacity) {
  const priceWeek = Number(listing?.price_week || listing?.week_price || listing?.price || 0);
  const priceNight = Number(listing?.price_night || listing?.night_price || 0);

  const finalPriceWeek =
    priceWeek > 0
      ? Math.round(priceWeek)
      : priceNight > 0
        ? Math.round(priceNight * 7)
        : 0;

  const finalPriceNight =
    priceNight > 0
      ? Math.round(priceNight)
      : finalPriceWeek > 0
        ? Math.round(finalPriceWeek / 7)
        : 0;

  return {
    name: String(listing?.name || listing?.title || "").trim(),
    property_type: normalizePropertyType(listing?.property_type || listing?.type),
    platform: normalizePlatform(listing?.platform || listing?.source),
    price_week: finalPriceWeek,
    price_night: finalPriceNight,
    capacity: Number(listing?.capacity || capacity),
    rating: listing?.rating ? Number(listing.rating) : null,
    url: listing?.url || "",
  };
}

function buildShortPrompt({
  week,
  capacity,
  propertyTypes,
  maxListings,
}) {
  const checkout = week.week_start
    ? new Date(new Date(week.week_start).getTime() + 7 * 86400000)
        .toISOString()
        .slice(0, 10)
    : null;

  const dates =
    week.week_start && checkout
      ? `${week.week_start} to ${checkout}, 7 nights`
      : `${week.label || "summer 2026"}, 7 nights`;

  return [
    "Find real vacation rental prices in La Foux d'Allos / Val d'Allos, France.",
    `Dates: ${dates}. Guests: ${capacity}.`,
    `Platforms: Booking.com and Airbnb.`,
    `Types only: ${propertyTypes.join(", ")}.`,
    `Return max ${maxListings} listings.`,
    "Return ONLY compact valid JSON array, no markdown:",
    `[{"name":"...","property_type":"résidence|particulier|hôtel","platform":"Booking.com|Airbnb","price_week":595,"price_night":85,"capacity":${capacity},"rating":8.2,"url":"https://..."}]`,
    "Use EUR. price_week is total for 7 nights."
  ].join("\n");
}

function isRateLimitError(message = "") {
  return /rate limit|tokens per minute|too many requests|429/i.test(message);
}

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

  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY manquante sur Vercel.",
    });
  }

  const {
    weeks = [],
    capacities = [],
    propertyTypes = ["résidence", "particulier"],
    maxListingsPerSearch = MAX_LISTINGS_PER_SEARCH,
  } = req.body || {};

  const cleanWeeks = Array.isArray(weeks)
    ? weeks.filter(week => week?.id)
    : [];

  const cleanCapacities = Array.isArray(capacities)
    ? capacities.map(Number).filter(capacity => capacity > 0)
    : [];

  const cleanPropertyTypes =
    Array.isArray(propertyTypes) && propertyTypes.length
      ? propertyTypes.map(normalizePropertyType)
      : ["résidence", "particulier"];

  const maxListings = Math.min(
    Number(maxListingsPerSearch) || MAX_LISTINGS_PER_SEARCH,
    MAX_LISTINGS_PER_SEARCH
  );

  const combos = [];

  for (const week of cleanWeeks) {
    for (const capacity of cleanCapacities) {
      combos.push({ week, capacity });
    }
  }

  if (combos.length === 0) {
    return res.status(400).json({
      error: "Aucune combinaison semaine × capacité fournie.",
    });
  }

  if (combos.length > MAX_COMBINATIONS) {
    return res.status(400).json({
      error:
        `Trop de combinaisons (${combos.length}). ` +
        `Maximum ${MAX_COMBINATIONS} par appel pour éviter la limite Anthropic. ` +
        `Lance plutôt 1 semaine × 1 capacité ou 2 semaines × 1 capacité.`,
    });
  }

  const results = [];

  const totalUsage = {
    input_tokens: 0,
    output_tokens: 0,
    web_search_requests: 0,
  };

  for (const { week, capacity } of combos) {
    const prompt = buildShortPrompt({
      week,
      capacity,
      propertyTypes: cleanPropertyTypes,
      maxListings,
    });

    try {
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: MAX_TOKENS,
          system:
            "Use web search. Return only a valid raw JSON array. No markdown, no commentary.",
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

      const data = await anthropicRes.json().catch(() => ({}));

      if (data?.usage) {
        totalUsage.input_tokens += data.usage.input_tokens || 0;
        totalUsage.output_tokens += data.usage.output_tokens || 0;
        totalUsage.web_search_requests +=
          data.usage.server_tool_use?.web_search_requests || 0;
      }

      if (!anthropicRes.ok || data?.error) {
        const rawError =
          data?.error?.message ||
          `Erreur Anthropic HTTP ${anthropicRes.status}`;

        const friendlyError = isRateLimitError(rawError)
          ? "Limite Anthropic atteinte : relance plus tard ou réduis à 1 seule combinaison."
          : rawError;

        results.push({
          week_id: week.id,
          week_label: week.label,
          week_start: week.week_start,
          capacity,
          property_types: cleanPropertyTypes,
          listings: [],
          error: friendlyError,
          raw_error: rawError,
          rate_limited: isRateLimitError(rawError),
          warning: null,
        });

        if (isRateLimitError(rawError)) {
          break;
        }

        continue;
      }

      const text = (data.content || [])
        .filter(block => block.type === "text")
        .map(block => block.text)
        .join("\n");

      const jsonText = extractJsonArray(text);

      if (!jsonText) {
        results.push({
          week_id: week.id,
          week_label: week.label,
          week_start: week.week_start,
          capacity,
          property_types: cleanPropertyTypes,
          listings: [],
          error: null,
          warning: "Aucune donnée JSON dans la réponse Claude.",
          raw: text,
        });

        continue;
      }

      let listings = [];

      try {
        listings = JSON.parse(jsonText);
      } catch (parseError) {
        results.push({
          week_id: week.id,
          week_label: week.label,
          week_start: week.week_start,
          capacity,
          property_types: cleanPropertyTypes,
          listings: [],
          error: null,
          warning: "JSON invalide dans la réponse Claude.",
          raw: text,
          parseError: parseError.message,
        });

        continue;
      }

      const filtered = Array.isArray(listings)
        ? listings
            .map(listing => normalizeListing(listing, capacity))
            .filter(listing => {
              if (!listing.name || !listing.price_week) return false;
              return cleanPropertyTypes.includes(listing.property_type);
            })
            .slice(0, maxListings)
        : [];

      results.push({
        week_id: week.id,
        week_label: week.label,
        week_start: week.week_start,
        capacity,
        property_types: cleanPropertyTypes,
        listings: filtered,
        error: null,
        warning:
          filtered.length === 0
            ? "Aucun logement trouvé pour cette combinaison."
            : null,
      });
    } catch (err) {
      const rawError = err?.message || "Erreur serveur inconnue";

      results.push({
        week_id: week.id,
        week_label: week.label,
        week_start: week.week_start,
        capacity,
        property_types: cleanPropertyTypes,
        listings: [],
        error: isRateLimitError(rawError)
          ? "Limite Anthropic atteinte : relance plus tard ou réduis à 1 seule combinaison."
          : rawError,
        raw_error: rawError,
        rate_limited: isRateLimitError(rawError),
        warning: null,
      });

      if (isRateLimitError(rawError)) {
        break;
      }
    }
  }

  return res.status(200).json({
    results,
    usage: totalUsage,
    limits: {
      max_combinations: MAX_COMBINATIONS,
      max_listings_per_search: MAX_LISTINGS_PER_SEARCH,
      max_web_search_uses: MAX_WEB_SEARCH_USES,
      max_tokens: MAX_TOKENS,
    },
  });
}

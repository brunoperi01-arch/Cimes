// api/scrape-market-batch.js
// Endpoint batch pour scraper plusieurs semaines × capacités en séquentiel
// À placer dans /api/scrape-market-batch.js à la racine du projet Vercel
// Variable d'environnement requise : ANTHROPIC_API_KEY côté serveur uniquement

function extractJsonArray(text) {
  if (!text || typeof text !== "string") return null;

  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");

  if (first === -1 || last === -1 || last <= first) {
    return null;
  }

  return text.slice(first, last + 1);
}

function normalizeListing(listing, capacity) {
  const priceWeek = Number(listing?.price_week || 0);
  const priceNight = Number(listing?.price_night || 0);

  const finalPriceWeek = priceWeek > 0
    ? Math.round(priceWeek)
    : priceNight > 0
      ? Math.round(priceNight * 7)
      : 0;

  const finalPriceNight = priceNight > 0
    ? Math.round(priceNight)
    : finalPriceWeek > 0
      ? Math.round(finalPriceWeek / 7)
      : 0;

  return {
    name: String(listing?.name || "").trim(),
    property_type: listing?.property_type || "particulier",
    platform: listing?.platform || "Web",
    price_week: finalPriceWeek,
    price_night: finalPriceNight,
    capacity: Number(listing?.capacity || capacity),
    rating: listing?.rating ? Number(listing.rating) : null,
    url: listing?.url || "",
  };
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
    maxListingsPerSearch = 8,
  } = req.body || {};

  const cleanWeeks = Array.isArray(weeks) ? weeks.filter(w => w?.id) : [];

  const cleanCapacities = Array.isArray(capacities)
    ? capacities.map(Number).filter(c => c > 0)
    : [];

  const cleanPropertyTypes =
    Array.isArray(propertyTypes) && propertyTypes.length
      ? propertyTypes
      : ["résidence", "particulier"];

  const combos = [];

  for (const week of cleanWeeks) {
    for (const capacity of cleanCapacities) {
      combos.push({ week, capacity });
    }
  }

  if (combos.length === 0) {
    return res.status(400).json({
      error: "Aucune combinaison semaine×capacité fournie.",
    });
  }

  if (combos.length > 6) {
    return res.status(400).json({
      error: `Trop de combinaisons (${combos.length}). Maximum 6 par appel, par exemple 3 semaines × 2 capacités.`,
    });
  }

  const results = [];

  const totalUsage = {
    input_tokens: 0,
    output_tokens: 0,
    web_search_requests: 0,
  };

  for (const { week, capacity } of combos) {
    const checkout = week.week_start
      ? new Date(new Date(week.week_start).getTime() + 7 * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;

    const dateStr =
      week.week_start && checkout
        ? `check-in ${week.week_start}, check-out ${checkout}, 7 nights`
        : `week ${week.label || "summer 2026"}, 7 nights`;

    const typeLines = cleanPropertyTypes
      .map(type => {
        if (type === "résidence") {
          return '"résidence" = managed residence, e.g. Vacancéole, Goélia, Pierre & Vacances, MMV, Labellemontagne';
        }

        if (type === "particulier") {
          return '"particulier" = individual host on Airbnb or Booking.com';
        }

        if (type === "hôtel") {
          return '"hôtel" = hotel or aparthotel';
        }

        return `"${type}"`;
      })
      .join("; ");

    const prompt = `Search Booking.com and Airbnb for real vacation rental listings in La Foux d'Allos / Val d'Allos, Alpes-de-Haute-Provence, France.
Period: ${dateStr}.
Guests: ${capacity}.
Wanted property types: ${cleanPropertyTypes.join(", ")}.
Definitions: ${typeLines}.
Find up to ${Math.min(Number(maxListingsPerSearch) || 8, 10)} listings.
Return ONLY a valid raw JSON array. No markdown. No backticks. No explanation.
Format:
[{"name":"...","property_type":"résidence","platform":"Booking.com","price_week":595,"price_night":85,"capacity":${capacity},"rating":8.2,"url":"https://..."}]
Use EUR. price_week is total for 7 nights.`;

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
          max_tokens: 1800,
          system:
            "You are a vacation rental price analyst for La Foux d'Allos, France. Use web search to find current real prices on Booking.com and Airbnb. Return only valid raw JSON arrays and no other text.",
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
              max_uses: 5,
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
        results.push({
          week_id: week.id,
          week_label: week.label,
          week_start: week.week_start,
          capacity,
          property_types: cleanPropertyTypes,
          listings: [],
          error:
            data?.error?.message ||
            `Erreur Anthropic HTTP ${anthropicRes.status}`,
          warning: null,
        });
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
              return (
                !listing.property_type ||
                cleanPropertyTypes.includes(listing.property_type)
              );
            })
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
      results.push({
        week_id: week.id,
        week_label: week.label,
        week_start: week.week_start,
        capacity,
        property_types: cleanPropertyTypes,
        listings: [],
        error: err?.message || "Erreur serveur inconnue",
        warning: null,
      });
    }
  }

  return res.status(200).json({
    results,
    usage: totalUsage,
  });
}

// api/scrape-market-batch.js
// Endpoint batch pour scraper plusieurs semaines × capacités en séquentiel
// Variable d'environnement requise : ANTHROPIC_API_KEY (côté serveur uniquement)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante sur Vercel." });
  }

  const {
    weeks = [],
    capacities = [],
    propertyTypes = ["résidence", "particulier"],
    maxListingsPerSearch = 8,
  } = req.body || {};

  // Construire les combinaisons semaine × capacité
  const combos = [];
  for (const week of weeks) {
    for (const capacity of capacities) {
      combos.push({ week, capacity });
    }
  }

  if (combos.length === 0) {
    return res.status(400).json({ error: "Aucune combinaison semaine×capacité fournie." });
  }

  // Sécurité : maximum 6 combinaisons par appel
  if (combos.length > 6) {
    return res.status(400).json({
      error: `Trop de combinaisons (${combos.length}). Maximum 6 par appel (ex. 3 semaines × 2 capacités).`,
    });
  }

  const results = [];
  const totalUsage = { input_tokens: 0, output_tokens: 0 };

  // Traitement séquentiel pour éviter timeouts et coûts incontrôlés
  for (const { week, capacity } of combos) {
    const checkout = week.week_start
      ? new Date(new Date(week.week_start).getTime() + 7 * 86400000).toISOString().slice(0, 10)
      : null;

    const dateStr =
      week.week_start && checkout
        ? `check-in ${week.week_start}, check-out ${checkout}`
        : `semaine ${week.label || "été 2026"}`;

    // Définitions courtes des types demandés uniquement
    const typeLines = propertyTypes
      .map((t) => {
        if (t === "résidence") return '"résidence": managed residence (Labellemontagne, Goélia, Pierre & Vacances, Vacancéole, MMV)';
        if (t === "particulier") return '"particulier": individual host on Airbnb/Booking';
        if (t === "hôtel") return '"hôtel": hotel or apart-hotel';
        return `"${t}"`;
      })
      .join("; ");

    // Prompt court et orienté JSON uniquement — pas d'analyse, pas d'explication
    const prompt = `Search Booking.com and Airbnb for vacation rentals in La Foux d'Allos (Val d'Allos), Alpes-de-Haute-Provence, France.
${dateStr}, ${capacity} guests. Types wanted: ${propertyTypes.join(", ")}.
Definitions: ${typeLines}.
Find ${maxListingsPerSearch} listings. Return ONLY a raw JSON array, no markdown, no backticks, no other text:
[{"name":"...","property_type":"résidence","platform":"Booking.com","price_week":595,"price_night":85,"capacity":${capacity},"rating":8.2,"url":"https://..."}]
EUR. price_week = total 7 nights.`;

    try {
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "web-search-2025-03-05",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          system:
            "You are a vacation rental price analyst for La Foux d'Allos, France. Use web search to find current real prices on Booking.com and Airbnb. Return ONLY valid raw JSON arrays, absolutely no other text, no backticks.",
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        }),
      });

      const data = await anthropicRes.json();

      // Comptabiliser l'usage pour info
      if (data.usage) {
        totalUsage.input_tokens += data.usage.input_tokens || 0;
        totalUsage.output_tokens += data.usage.output_tokens || 0;
      }

      if (data.error) {
        results.push({
          week_id: week.id,
          week_label: week.label,
          week_start: week.week_start,
          capacity,
          property_types: propertyTypes,
          listings: [],
          error: data.error.message,
          warning: null,
        });
        continue;
      }

      const text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      const match = text.match(/\[[\s\S]*?\]/);
      if (!match) {
        results.push({
          week_id: week.id,
          week_label: week.label,
          week_start: week.week_start,
          capacity,
          property_types: propertyTypes,
          listings: [],
          error: null,
          warning: "Aucune donnée JSON dans la réponse Claude.",
        });
        continue;
      }

      let listings = [];
      try {
        listings = JSON.parse(match[0]);
      } catch {
        results.push({
          week_id: week.id,
          week_label: week.label,
          week_start: week.week_start,
          capacity,
          property_types: propertyTypes,
          listings: [],
          error: null,
          warning: "JSON invalide dans la réponse.",
        });
        continue;
      }

      // Filtrer selon les types demandés
      const filtered = Array.isArray(listings)
        ? listings.filter(
            (l) => !l.property_type || propertyTypes.includes(l.property_type)
          )
        : [];

      results.push({
        week_id: week.id,
        week_label: week.label,
        week_start: week.week_start,
        capacity,
        property_types: propertyTypes,
        listings: filtered,
        error: null,
        warning: filtered.length === 0 ? "Aucun logement trouvé pour cette combinaison." : null,
      });
    } catch (err) {
      // Erreur réseau ou timeout — ne pas bloquer le reste du batch
      results.push({
        week_id: week.id,
        week_label: week.label,
        week_start: week.week_start,
        capacity,
        property_types: propertyTypes,
        listings: [],
        error: err.message,
        warning: null,
      });
    }
  }

  return res.status(200).json({ results, usage: totalUsage });
}

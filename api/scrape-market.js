// api/scrape-market.js
// Déployer dans /api/ à la racine du projet Vercel
// Variable d'environnement requise : ANTHROPIC_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { weekLabel, weekStart, capacity = 6 } = req.body || {};

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante sur Vercel." });
  }

  const checkout = weekStart
    ? new Date(new Date(weekStart).getTime() + 7 * 86400000).toISOString().slice(0, 10)
    : null;

  const dateStr = weekStart && checkout
    ? `check-in ${weekStart}, check-out ${checkout} (7 nuits)`
    : `semaine ${weekLabel || "été 2026"}`;

  const prompt = `Search Booking.com and Airbnb for vacation rental listings in La Foux d'Allos (Val d'Allos), Alpes-de-Haute-Provence, France.
${dateStr}, ${capacity} guests.

Find 8-12 real listings. Categorize each as:
- "résidence" → managed residence (Labellemontagne, Goélia, Pierre & Vacances, Vacancéole, MMV, etc.)
- "particulier" → individual host on Airbnb or Booking
- "hôtel" → hotel or apart-hotel

Return ONLY a raw JSON array, no markdown, no backticks, no other text:
[{"name":"...","property_type":"résidence","platform":"Booking.com","price_week":595,"price_night":85,"capacity":6,"rating":8.2,"url":"https://..."}]

Use EUR. price_week = total for 7 nights. Estimate if exact price unavailable.`;

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
        max_tokens: 2000,
        system: "You are a vacation rental price analyst for La Foux d'Allos, France. Use web search to find current real prices on Booking.com and Airbnb. Return ONLY valid raw JSON arrays, absolutely no other text, no backticks.",
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    const data = await anthropicRes.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return res.status(200).json({ listings: [], warning: "Aucune donnée JSON dans la réponse." });
    }

    const listings = JSON.parse(match[0]);
    return res.status(200).json({ listings });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

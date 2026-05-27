// api/scrape-market.js
// Déployer dans /api/ à la racine du projet Vercel
// Variable d'environnement requise : ANTHROPIC_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") {
    return res.status(200).end()
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (!anthropicKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY manquante sur Vercel."
    })
  }

  const { weekLabel, weekStart, capacity = 6 } = req.body || {}

  const checkout = weekStart
    ? new Date(new Date(weekStart).getTime() + 7 * 86400000)
        .toISOString()
        .slice(0, 10)
    : null

  const dateStr =
    weekStart && checkout
      ? `check-in ${weekStart}, check-out ${checkout} (7 nuits)`
      : `semaine ${weekLabel || "été 2026"}`

  const prompt = `
Search Booking.com and Airbnb for vacation rental listings in La Foux d'Allos / Val d'Allos, Alpes-de-Haute-Provence, France.

Period: ${dateStr}
Guests: ${capacity}

Find 8 to 12 real listings.

Categorize each listing as:
- "résidence" → managed residence such as Vacancéole, Goélia, Pierre & Vacances, MMV, Labellemontagne, etc.
- "particulier" → individual host on Airbnb or Booking
- "hôtel" → hotel or apart-hotel

Return ONLY a raw valid JSON array.
No markdown.
No backticks.
No explanation.

Expected format:
[
  {
    "name": "Nom de l'hébergement",
    "property_type": "résidence",
    "platform": "Booking.com",
    "price_week": 595,
    "price_night": 85,
    "capacity": 6,
    "rating": 8.2,
    "url": "https://..."
  }
]

Use EUR.
price_week = total for 7 nights.
If exact price is unavailable, estimate from visible nightly or weekly price.
`.trim()

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        system:
          "You are a vacation rental price analyst for La Foux d'Allos, France. Use web search to find current real prices on Booking.com and Airbnb. Return ONLY valid raw JSON arrays, absolutely no other text.",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5
          }
        ]
      })
    })

    const data = await anthropicRes.json()

    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({
        error:
          data?.error?.message ||
          `Erreur Anthropic HTTP ${anthropicRes.status}`,
        details: data
      })
    }

    if (data?.error) {
      return res.status(400).json({
        error: data.error.message,
        details: data.error
      })
    }

    const text = (data.content || [])
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n")

    const match = text.match(/\[[\s\S]*\]/)

    if (!match) {
      return res.status(200).json({
        listings: [],
        warning: "Aucune donnée JSON dans la réponse.",
        raw: text
      })
    }

    let listings = []

    try {
      listings = JSON.parse(match[0])
    } catch (parseError) {
      return res.status(200).json({
        listings: [],
        warning: "Réponse reçue mais JSON invalide.",
        raw: text,
        parseError: parseError.message
      })
    }

    return res.status(200).json({
      listings,
      usage: data.usage || null
    })
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Erreur serveur inconnue"
    })
  }
}

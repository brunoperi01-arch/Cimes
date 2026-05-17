// api/analyse-reco.js — Vercel Serverless Function
// La clé Anthropic reste UNIQUEMENT côté serveur.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY manquante — configurer dans Vercel → Environment Variables' })

  const { weekLabel, weekYear, seasonType, eventLabel, cap, ourPrice, ourNight, rates, reco, settings } = req.body
  if (!weekLabel || !cap) return res.status(400).json({ error: 'Paramètres manquants' })

  const fmt = n => typeof n === 'number' ? n.toLocaleString('fr-FR') : '—'
  const ratesSummary = (rates || []).slice(0, 8).map(r =>
    `- ${r.competitor_name || r.source}${r.promo_label ? ` [${r.promo_label}]` : ''}: ${r.price_week}€/sem · score ${r.comparability_score || '?'}/100 · ${r.reliability_status} · il y a ${r.days_ago || '?'}j`
  ).join('\n') || 'Aucun relevé disponible.'

  const prompt = `Expert revenue management résidence Les Cimes du Val d'Allos 3*** (piscine, sauna, ski aux pieds, La Foux d'Allos 04260).

SEMAINE : ${weekLabel} ${weekYear} — ${seasonType}${eventLabel ? ` — ${eventLabel}` : ''}
NOS TARIFS : ${ourPrice}€/sem (${ourNight}€/nuit) — ${cap}

RELEVÉS CONCURRENTS (${(rates || []).length}) :
${ratesSummary}

Médianes (vraie médiane statistique) :
- Résidences   : ${fmt(reco?.medRes)}€/sem
- Particuliers : ${fmt(reco?.medPart)}€/sem
- Hôtels       : ${fmt(reco?.medHot)}€/sem
- Globale      : ${fmt(reco?.medAll)}€/sem

Moteur : ${reco?.action} · confiance ${reco?.confidence} (${reco?.confScore}/100)
Qualifiés (score≥${settings?.minScore || 70}) : ${reco?.ratesCount} · Exclus : ${reco?.excludedCount} · Récents : ${reco?.recentCount}
${reco?.hasOld ? '⚠ Certains relevés dépassent le seuil d\'obsolescence.' : ''}

ANALYSE EN 4 BLOCS séparés par "---" (2 phrases max par bloc) :
1. POSITIONNEMENT : tarif vs résidences comparables (score≥70). Écarts précis en €.
2. RISQUES : menace principale (données insuffisantes, promo agressive, sur/sous-tarification).
3. RECOMMANDATION : prix cible €/sem + €/nuit, fourchette basse/cible/haute.
4. ACTION : une seule action immédiate et concrète.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
    })
    const data = await response.json()
    if (!response.ok) return res.status(500).json({ error: data.error?.message || `Anthropic error ${response.status}` })
    const text  = data.content?.map(b => b.text || '').join('') || ''
    const parts = text.split('---').map(s => s.replace(/^\s*\d\.\s*(POSITIONNEMENT|RISQUES|RECOMMANDATION|ACTION.*?)\s*:?\s*/i, '').trim()).filter(Boolean)
    return res.status(200).json({ parts })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
import { useState } from 'react'

export function WeekDetailPage({
  onNavigate,
  selWeek,
  cap,
  rates,
  reco,
  onRateDeleted,
  onSaveRate       // ← NOUVEAU : à passer depuis App.jsx (même fonction que CollectPage)
}) {
  const [scraping, setScraping]     = useState(false)
  const [scraped, setScraped]       = useState([])
  const [scrapeError, setScrapeError] = useState('')
  const [savedIdx, setSavedIdx]     = useState({})

  // ─── Extraction des dates depuis selWeek (multi-format Supabase) ───────────
  function getWeekDates() {
    const w = selWeek || {}
    const checkin  = w.start_date  || w.checkin   || w.check_in  || w.date_debut || w.startDate || ''
    const checkout = w.end_date    || w.checkout  || w.check_out || w.date_fin   || w.endDate   || ''
    const label    = w.label || w.name || w.id || ''
    return { checkin, checkout, label }
  }

  // ─── Appel API Anthropic + web_search ─────────────────────────────────────
  async function scrapeMarket() {
    setScraping(true)
    setScrapeError('')
    setScraped([])
    setSavedIdx({})

    const { checkin, checkout, label } = getWeekDates()
    const capacity = parseInt(cap) || 6

    const dateStr = checkin && checkout
      ? `check-in ${checkin}, check-out ${checkout}`
      : `semaine ${label}`

    const prompt = `Search Booking.com and Airbnb for vacation rental listings in La Foux d'Allos (Val d'Allos), Alpes-de-Haute-Provence, France.
${dateStr}, ${capacity} guests.

Find 8-12 listings. For each, determine the category:
- "Résidence" → managed residence (Labellemontagne, Goélia, Pierre & Vacances, Vacancéole, MMV, etc.)
- "Particulier" → individual host / private listing on Airbnb
- "Hôtel" → hotel or apart-hotel

Return ONLY a raw JSON array, no markdown, no backticks, no other text:
[{"name":"...","category":"Résidence","platform":"Booking.com","price_per_night":85,"price_per_week":595,"capacity":6,"rating":8.2,"url":"https://..."}]

Use EUR. Estimate if exact price unavailable.`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: "You are a vacation rental price analyst for La Foux d'Allos, France. Use web search to find current real prices on Booking.com and Airbnb. Return ONLY valid raw JSON arrays, absolutely no other text, no backticks.",
          messages: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search_20250305', name: 'web_search' }]
        })
      })

      const data = await res.json()
      if (data.error) throw new Error(data.error.message)

      const text = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')

      const match = text.match(/\[[\s\S]*\]/)
      if (!match) throw new Error('Aucune donnée JSON dans la réponse. Réessayez.')

      const listings = JSON.parse(match[0])
      if (!listings.length) throw new Error('Aucun logement trouvé.')
      setScraped(listings)

    } catch (e) {
      setScrapeError('Erreur : ' + e.message)
    }

    setScraping(false)
  }

  // ─── Enregistrer un relevé scrapé ─────────────────────────────────────────
  async function saveScraped(item, idx) {
    if (!onSaveRate) return
    const weekPrice = item.price_per_week
      ? Math.round(item.price_per_week)
      : item.price_per_night
        ? Math.round(item.price_per_night * 7)
        : 0

    await onSaveRate({
      week_id:    selWeek?.id,
      capacity:   parseInt(cap, 10),
      competitor: item.name,
      price:      weekPrice,
      category:   item.category,
      platform:   item.platform,
      rating:     item.rating,
      url:        item.url
    })
    setSavedIdx(prev => ({ ...prev, [idx]: true }))
  }

  // ─── Groupement par catégorie ──────────────────────────────────────────────
  const CATS = ['Résidence', 'Particulier', 'Hôtel']
  const grouped = CATS.reduce((acc, cat) => {
    acc[cat] = scraped.filter(i => i.category === cat)
    return acc
  }, {})

  // ─── Stats marché ──────────────────────────────────────────────────────────
  const allPrices = scraped
    .map(i => i.price_per_week || (i.price_per_night * 7))
    .filter(p => p > 0)
    .sort((a, b) => a - b)
  const median = allPrices.length
    ? allPrices[Math.floor(allPrices.length / 2)]
    : null

  return (
    <div style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>

      {/* Navigation */}
      <button onClick={() => onNavigate('weeks')} style={backStyle}>
        ← Semaines
      </button>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6B7280', marginBottom: 2 }}>
          {selWeek?.period || ''} · {cap}P
        </p>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>
          {selWeek?.label || selWeek?.id}
        </h1>
      </div>

      {/* Recommandation */}
      <div style={cardStyle}>
        <h2 style={h2}>Recommandation</h2>
        <p style={{ fontSize: 28, fontWeight: 700, margin: '4px 0' }}>
          {reco?.recommendedPrice ?? reco?.price ?? '—'} €
          <span style={{ fontSize: 14, fontWeight: 400, color: '#6B7280' }}>/sem</span>
        </p>
      </div>

      {/* Tarifs manuels existants */}
      <div style={cardStyle}>
        <h2 style={h2}>Tarifs enregistrés</h2>
        {!rates?.length
          ? <p style={{ color: '#9CA3AF', fontSize: 14 }}>Aucun tarif enregistré pour cette semaine.</p>
          : rates.map((rate, i) => (
            <div key={rate.id || i} style={rateRow}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{rate.competitor || rate.name}</div>
                {rate.category && <div style={{ fontSize: 11, color: '#9CA3AF' }}>{rate.category}</div>}
              </div>
              <span style={{ fontWeight: 700 }}>{rate.price || rate.amount || '—'} €</span>
            </div>
          ))
        }
        <button onClick={onRateDeleted} style={{ ...btnSecondary, marginTop: 12 }}>
          Actualiser
        </button>
      </div>

      {/* ── SCRAPING ── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ ...h2, margin: 0 }}>Recherche automatique</h2>
          {median && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#6B7280' }}>Médiane marché</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{Math.round(median)} €</div>
            </div>
          )}
        </div>

        <button
          onClick={scrapeMarket}
          disabled={scraping}
          style={{ ...btnPrimary, background: scraping ? '#93C5FD' : '#1D4ED8', marginBottom: 14 }}
        >
          {scraping
            ? '⏳ Recherche en cours (20–40s)…'
            : '🔍 Rechercher sur Booking & Airbnb'}
        </button>

        {scrapeError && (
          <p style={{ color: '#EF4444', fontSize: 13, marginBottom: 8 }}>{scrapeError}</p>
        )}

        {scraped.length > 0 && (
          <>
            <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
              {scraped.length} logements trouvés · Appuyez sur{' '}
              <strong style={{ color: '#2563EB' }}>+</strong> pour enregistrer
            </p>

            {CATS.map(cat =>
              grouped[cat].length > 0 ? (
                <div key={cat} style={{ marginBottom: 18 }}>
                  {/* Catégorie label */}
                  <div style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '.07em', color: '#374151',
                    borderBottom: '1px solid #E5E7EB', paddingBottom: 6, marginBottom: 8
                  }}>
                    {cat}s ({grouped[cat].length})
                  </div>

                  {grouped[cat].map((item, i) => {
                    const globalIdx = scraped.indexOf(item)
                    const weekPrice = item.price_per_week
                      ? Math.round(item.price_per_week)
                      : item.price_per_night ? Math.round(item.price_per_night * 7) : '—'
                    const nightPrice = item.price_per_night ? Math.round(item.price_per_night) : null
                    const isSaved = savedIdx[globalIdx]

                    return (
                      <div key={i} style={{ ...rateRow, alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.name}
                          </div>
                          <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                            {item.platform}{item.rating ? ` · ${item.rating}★` : ''}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{weekPrice} €<span style={{ fontSize: 10, fontWeight: 400, color: '#6B7280' }}>/sem</span></div>
                          {nightPrice && <div style={{ fontSize: 10, color: '#9CA3AF' }}>{nightPrice} €/n</div>}
                        </div>
                        {onSaveRate && (
                          <button
                            onClick={() => saveScraped(item, globalIdx)}
                            disabled={isSaved}
                            style={{
                              width: 30, height: 30, borderRadius: 8, border: 'none',
                              background: isSaved ? '#D1FAE5' : '#EFF6FF',
                              color: isSaved ? '#059669' : '#2563EB',
                              fontWeight: 700, fontSize: 18, cursor: isSaved ? 'default' : 'pointer',
                              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}
                          >
                            {isSaved ? '✓' : '+'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : null
            )}
          </>
        )}
      </div>

    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const backStyle = {
  border: 'none', background: 'transparent',
  color: '#2563EB', marginBottom: 12,
  cursor: 'pointer', fontSize: 14, padding: 0
}
const cardStyle = {
  background: 'white', padding: 16, borderRadius: 16,
  marginBottom: 16, border: '1px solid #E5E7EB'
}
const h2 = {
  fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '.04em', color: '#374151', marginBottom: 12
}
const rateRow = {
  display: 'flex', justifyContent: 'space-between',
  padding: '9px 0', borderBottom: '1px solid #F3F4F6'
}
const btnPrimary = {
  width: '100%', padding: 13, borderRadius: 12,
  border: 'none', color: 'white', fontWeight: 700,
  cursor: 'pointer', fontSize: 14
}
const btnSecondary = {
  width: '100%', padding: 11, borderRadius: 10,
  border: '1px solid #E5E7EB', background: 'white',
  color: '#374151', fontWeight: 600, cursor: 'pointer', fontSize: 13
}

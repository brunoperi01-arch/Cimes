import { COMPETITORS } from '../constants/competitors'
import { WEEKS_ALL }   from '../constants/weeks'

// Matching competitor_id :
// 1. competitor_id exact  2. property_name exact  3. null
// Pas de matching sur source seul (Booking peut désigner plusieurs concurrents)
export function matchCompetitorId({ competitor_id, property_name }) {
  if (competitor_id) { const f=COMPETITORS.find(c=>c.id===competitor_id); if(f) return f.id }
  if (property_name) { const f=COMPETITORS.find(c=>c.name===property_name); if(f) return f.id }
  return null
}

// Doublon v2 :
// competitor_id renseigné → (week_id + competitor_id + capacity + collected_at + source)
// competitor_id null      → (week_id + property_name + source + capacity + collected_at)
export function isDuplicate(existing, rate) {
  if (rate.competitor_id) {
    return existing.some(r =>
      r.week_id===rate.week_id && r.competitor_id===rate.competitor_id &&
      r.capacity===rate.capacity && r.collected_at===rate.collected_at && r.source===rate.source
    )
  }
  return existing.some(r =>
    !r.competitor_id && r.week_id===rate.week_id && r.property_name===rate.property_name &&
    r.source===rate.source && r.capacity===rate.capacity && r.collected_at===rate.collected_at
  )
}

// Parseur copier-coller (Booking, Airbnb, Abritel…)
export function parsePastedPageText(text, source, weekId, capacity) {
  const full = text.toLowerCase()
  const priceRe = /(\d[\d\s]{1,5})\s*€|€\s*(\d[\d\s]{1,5})|\b(\d{2,4})\b(?=\s*(?:€|eur|\s*\/\s*(?:nuit|sem|semaine)))/gi
  const pricesSet = new Set()
  let m
  while ((m = priceRe.exec(text)) !== null) {
    const v = parseFloat((m[1]||m[2]||m[3]).replace(/\s/g,''))
    if (v>=30 && v<=8000) pricesSet.add(v)
  }
  const prices = [...pricesSet].sort((a,b)=>a-b)
  let originalPrice=null
  const barreM = text.match(/(?:de|était|barré|avant|au lieu de)\s*:?\s*([\d\s]{3,6})\s*€/i)
  if (barreM) { const v=parseFloat(barreM[1].replace(/\s/g,'')); if(v>0) originalPrice=v }
  let promoLabel=null, promoPercent=0
  if      (/genius/i.test(full))               { promoLabel='Genius -10%';       promoPercent=10 }
  else if (/last[\s-]?minute/i.test(full))     { promoLabel='Last minute';       promoPercent=15 }
  else if (/early[\s-]?booking/i.test(full))   { promoLabel='Early booking';     promoPercent=10 }
  else if (/petit[\s-]?d[eé]j/i.test(full))   { promoLabel='PDJ inclus' }
  else if (/annulation\s*gratuite/i.test(full)){ promoLabel='Annulation gratuite' }
  else { const pm=full.match(/-(\d{1,2})\s*%/); if(pm){ promoPercent=parseInt(pm[1]); promoLabel=`-${promoPercent}%` } }
  const ratingM = text.match(/(\d[,.]?\d?)\s*\/\s*10|note\s*[^:]*:\s*(\d[,.]?\d?)/i)
  const rating  = ratingM ? parseFloat((ratingM[1]||ratingM[2]).replace(',','.')) : null
  const feeM    = text.match(/(?:frais\s*(?:de\s*)?m[eé]nage|cleaning fee)\s*:?\s*([\d\s]+)\s*€/i)
  const cleaningFee = feeM ? parseFloat(feeM[1].replace(/\s/g,'')) : 0
  const capM   = text.match(/(\d)\s*(?:personnes?|pers\.|voyageurs?|guests?)/i)
  const detectedCap = capM ? parseInt(capM[1]) : capacity
  const isNight    = /par nuit|\/nuit|per night|nightly/i.test(text)
  const nightPrices = prices.filter(p=>p<500)
  const weekPrices  = prices.filter(p=>p>=200&&p<=5000)
  let priceWeek=0, priceNight=0
  if (isNight && nightPrices.length) { priceNight=nightPrices[Math.floor(nightPrices.length/2)]; priceWeek=Math.round(priceNight*7) }
  else if (weekPrices.length) { priceWeek=weekPrices[Math.floor(weekPrices.length/2)]; priceNight=Math.round(priceWeek/7) }
  else if (prices.length) { priceWeek=prices[0]; priceNight=Math.round(priceWeek/7) }
  return { allPrices:prices, warning:!priceWeek?'Aucun prix détecté. Vérifiez le texte collé.':null, priceWeek, priceNight, originalPrice, promoLabel, promoPercent, cleaningFee, rating, detectedCap }
}

// Parseur CSV
export function parseCsvText(text, defaultCapacity=6) {
  const lines = text.trim().split('\n').filter(l=>l.trim())
  if (lines.length < 2) throw new Error('Fichier vide ou une seule ligne')
  const sep     = lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(sep).map(h=>h.trim().toLowerCase().replace(/[^a-z_]/g,''))
  return lines.slice(1).map(line => {
    const vals=line.split(sep).map(v=>v.trim().replace(/^"|"$/g,''))
    const o={}; headers.forEach((h,i)=>{ o[h]=vals[i]||'' })
    const week=WEEKS_ALL.find(w=>w.week_start===o.week_start||w.id===o.week_id)
    const pw=parseFloat(o.price_week)||0
    const compId=matchCompetitorId({ competitor_id:o.competitor_id, property_name:o.property_name })
    return {
      week_id:o.week_id||week?.id||'', source:o.source,
      competitor_id:compId, property_name:o.property_name||'', property_type:o.property_type||'particulier',
      capacity:parseInt(o.capacity)||defaultCapacity,
      price_week:pw, price_night:parseFloat(o.price_night)||Math.round(pw/7),
      original_price:parseFloat(o.original_price)||null,
      promo_label:o.promo_label||null, promo_percent:parseFloat(o.promo_percent)||0,
      cleaning_fee:parseFloat(o.cleaning_fee)||0, url:o.url||'',
      collected_at:o.collected_at||new Date().toISOString().slice(0,10),
      reliability_status:o.reliability_status||'importé CSV',
      collection_type:'csv', is_example:false,
    }
  }).filter(r=>r.week_id&&r.price_week&&r.source)
}
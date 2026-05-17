// ─── src/utils/colors.js ────────────────────────────────────────
export const C = {
  blue:"#1B3A6B", blueL:"#2E5FAC", bluePale:"#EEF4FF",
  green:"#1A7A5E", greenL:"#E6F4EF",
  orange:"#D45400", orangeL:"#FFF0E6",
  red:"#B91C1C", redL:"#FEE2E2",
  purple:"#6D28D9", purpleL:"#EDE9FE",
  gold:"#92400E", goldL:"#FEF3C7",
  gray:"#6B7280", grayL:"#F3F4F6", grayM:"#E5E7EB",
  white:"#FFFFFF", text:"#111827", textS:"#6B7280",
}

export const CAT_COLORS = { haute:"#D45400", moyenne:"#2E5FAC", basse:"#1A7A5E" }
export const CAT_LABELS = { haute:"Haute saison", moyenne:"Moy. saison", basse:"Basse saison" }


// ─── src/utils/formatters.js ─────────────────────────────────────
export const fmt       = n  => typeof n === "number" ? n.toLocaleString("fr-FR") : "—"
export const fmtPct    = n  => (n >= 0 ? "+" : "") + Math.round(n) + "%"
export const daysSince = d  => d ? Math.floor((Date.now() - new Date(d)) / 864e5) : 999


// ─── src/utils/styles.js ─────────────────────────────────────────
import { C } from "./colors"

export const styles = {
  cnt:    { padding:"0 14px 80px" },
  sbar:   { height:46, display:"flex", alignItems:"flex-end", justifyContent:"space-between", padding:"0 20px 6px", background:C.grayL },
  sml:    { fontSize:10, fontWeight:700, color:C.gray, margin:"12px 2px 5px", letterSpacing:"0.06em", textTransform:"uppercase" },
  card:   (r=14, mb=8)   => ({ background:C.white, borderRadius:r, overflow:"hidden", marginBottom:mb }),
  row:    (last=false)   => ({ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 13px", borderBottom:last?"none":`0.5px solid ${C.grayL}` }),
  btn:    (dis, bg=C.blue, fg=C.white) => ({ width:"100%", padding:"12px", fontSize:14, fontWeight:600, background:dis?"#C7C7CC":bg, color:fg, border:"none", borderRadius:11, cursor:dis?"not-allowed":"pointer", marginBottom:6 }),
  inp:    (extra={})     => ({ width:"100%", padding:"8px 10px", fontSize:13, border:`1px solid ${C.grayM}`, borderRadius:9, background:C.white, color:C.text, boxSizing:"border-box", ...extra }),
  tabBtn: (active)       => ({ flex:1, padding:"8px 2px", fontSize:11, fontWeight:active?700:400, background:active?C.white:"transparent", color:active?C.blue:C.gray, border:"none", borderRadius:8, cursor:"pointer" }),
}


// ─── src/utils/parsers.js ────────────────────────────────────────
import { COMPETITORS } from "../constants/competitors"
import { WEEKS_ALL }   from "../constants/weeks"

// Matching competitor_id :
// 1. competitor_id exact  2. property_name exact  3. null
export function matchCompetitorId({ competitor_id, property_name }) {
  if (competitor_id) {
    const f = COMPETITORS.find(c => c.id === competitor_id)
    if (f) return f.id
  }
  if (property_name) {
    const f = COMPETITORS.find(c => c.name === property_name)
    if (f) return f.id
  }
  return null
}

// Doublon v2 :
// competitor_id renseigné → (week_id + competitor_id + capacity + collected_at + source)
// competitor_id null      → (week_id + property_name + source + capacity + collected_at)
export function isDuplicate(existing, rate) {
  if (rate.competitor_id) {
    return existing.some(r =>
      r.week_id === rate.week_id && r.competitor_id === rate.competitor_id &&
      r.capacity === rate.capacity && r.collected_at === rate.collected_at && r.source === rate.source
    )
  }
  return existing.some(r =>
    !r.competitor_id && r.week_id === rate.week_id &&
    r.property_name === rate.property_name && r.source === rate.source &&
    r.capacity === rate.capacity && r.collected_at === rate.collected_at
  )
}

// Parseur copier-coller (Booking, Airbnb, Abritel…)
export function parsePastedPageText(text, source, weekId, capacity) {
  const full = text.toLowerCase()
  const priceRe = /(\d[\d\s]{1,5})\s*€|€\s*(\d[\d\s]{1,5})|\b(\d{2,4})\b(?=\s*(?:€|eur|\s*\/\s*(?:nuit|sem|semaine)))/gi
  const pricesSet = new Set()
  let m
  while ((m = priceRe.exec(text)) !== null) {
    const v = parseFloat((m[1]||m[2]||m[3]).replace(/\s/g,""))
    if (v >= 30 && v <= 8000) pricesSet.add(v)
  }
  const prices = [...pricesSet].sort((a,b)=>a-b)

  let originalPrice = null
  const barreM = text.match(/(?:de|était|barré|avant|au lieu de)\s*:?\s*([\d\s]{3,6})\s*€/i)
  if (barreM) { const v=parseFloat(barreM[1].replace(/\s/g,"")); if(v>0) originalPrice=v }

  let promoLabel=null, promoPercent=0
  if      (/genius/i.test(full))              { promoLabel="Genius -10%";       promoPercent=10 }
  else if (/last[\s-]?minute/i.test(full))    { promoLabel="Last minute";       promoPercent=15 }
  else if (/early[\s-]?booking/i.test(full))  { promoLabel="Early booking";     promoPercent=10 }
  else if (/petit[\s-]?d[eé]j/i.test(full))  { promoLabel="PDJ inclus" }
  else if (/annulation\s*gratuite/i.test(full)){ promoLabel="Annulation gratuite" }
  else { const pm=full.match(/-(\d{1,2})\s*%/); if(pm){ promoPercent=parseInt(pm[1]); promoLabel=`-${promoPercent}%` } }

  const ratingM = text.match(/(\d[,.]?\d?)\s*\/\s*10|note\s*[^:]*:\s*(\d[,.]?\d?)/i)
  const rating  = ratingM ? parseFloat((ratingM[1]||ratingM[2]).replace(",",".")) : null

  const feeM       = text.match(/(?:frais\s*(?:de\s*)?m[eé]nage|cleaning fee)\s*:?\s*([\d\s]+)\s*€/i)
  const cleaningFee = feeM ? parseFloat(feeM[1].replace(/\s/g,"")) : 0

  const capM       = text.match(/(\d)\s*(?:personnes?|pers\.|voyageurs?|guests?)/i)
  const detectedCap = capM ? parseInt(capM[1]) : capacity

  const isNight    = /par nuit|\/nuit|per night|nightly/i.test(text)
  const nightPrices = prices.filter(p=>p<500)
  const weekPrices  = prices.filter(p=>p>=200&&p<=5000)
  let priceWeek=0, priceNight=0

  if (isNight && nightPrices.length) {
    priceNight = nightPrices[Math.floor(nightPrices.length/2)]
    priceWeek  = Math.round(priceNight*7)
  } else if (weekPrices.length) {
    priceWeek  = weekPrices[Math.floor(weekPrices.length/2)]
    priceNight = Math.round(priceWeek/7)
  } else if (prices.length) {
    priceWeek  = prices[0]
    priceNight = Math.round(priceWeek/7)
  }

  return { allPrices:prices, warning:!priceWeek?"Aucun prix détecté. Vérifiez le texte collé.":null, priceWeek, priceNight, originalPrice, promoLabel, promoPercent, cleaningFee, rating, detectedCap }
}

// Parseur CSV
export function parseCsvText(text, defaultCapacity=6) {
  const lines = text.trim().split("\n").filter(l=>l.trim())
  if (lines.length < 2) throw new Error("Fichier vide ou une seule ligne")
  const sep     = lines[0].includes(";") ? ";" : ","
  const headers = lines[0].split(sep).map(h=>h.trim().toLowerCase().replace(/[^a-z_]/g,""))

  return lines.slice(1).map(line => {
    const vals = line.split(sep).map(v=>v.trim().replace(/^"|"$/g,""))
    const o    = {}
    headers.forEach((h,i) => { o[h]=vals[i]||"" })
    const week   = WEEKS_ALL.find(w=>w.week_start===o.week_start||w.id===o.week_id)
    const pw     = parseFloat(o.price_week)||0
    const compId = matchCompetitorId({ competitor_id:o.competitor_id, property_name:o.property_name })
    return {
      week_id:           week?.id||"",
      source:            o.source,
      competitor_id:     compId,
      property_name:     o.property_name||"",
      property_type:     o.property_type||"particulier",
      capacity:          parseInt(o.capacity)||defaultCapacity,
      price_week:        pw,
      price_night:       parseFloat(o.price_night)||Math.round(pw/7),
      original_price:    parseFloat(o.original_price)||null,
      promo_label:       o.promo_label||null,
      promo_percent:     parseFloat(o.promo_percent)||0,
      cleaning_fee:      parseFloat(o.cleaning_fee)||0,
      url:               o.url||"",
      collected_at:      o.collected_at||new Date().toISOString().slice(0,10),
      reliability_status:o.reliability_status||"importé CSV",
      collection_type:   "csv",
      is_example:        false,
    }
  }).filter(r=>r.week_id&&r.price_week&&r.source)
}


// ─── src/constants/competitors.js ───────────────────────────────
export const COMPETITORS = [
  { id:"cv",        name:"Les Chalets du Verdon",        property_type:"résidence",  source:"Vacancéole",     comparability_score:88, has_pool:true,  has_ski_access:true,  standing:4, url:"https://www.vacanceole.com/sejour/les-chalets-du-verdon",                                           active:true },
  { id:"cp",        name:"Central Park",                 property_type:"résidence",  source:"Labellemontagne",comparability_score:82, has_pool:false, has_ski_access:false, standing:3, url:"https://www.labellemontagne.com/location/val-dallos-la-foux",                                       active:true },
  { id:"goe",       name:"Goélia La Foux",               property_type:"résidence",  source:"Goélia",         comparability_score:85, has_pool:true,  has_ski_access:true,  standing:3, url:"https://www.goelia.com/fr/residence-vacances/foux-d-allos/les-cimes-du-val-d-allos.296.2.php",    active:true },
  { id:"ham",       name:"Hôtel du Hameau",              property_type:"hôtel",      source:"Booking",        comparability_score:55, has_pool:false, has_ski_access:true,  standing:3, url:"https://www.booking.com/hotel/fr/les-cimes-du-val-d-allos.fr.html",                                 active:true },
  { id:"airbnb_lf", name:"Particuliers Airbnb La Foux", property_type:"particulier", source:"Airbnb",         comparability_score:60, has_pool:false, has_ski_access:false, standing:0, url:"https://www.airbnb.fr/s/La-Foux-d-Allos/homes",                                                    active:true },
  { id:"bk_lf",    name:"Particuliers Booking La Foux", property_type:"particulier", source:"Booking",        comparability_score:58, has_pool:false, has_ski_access:false, standing:0, url:"https://www.booking.com/searchresults/fr.html?ss=La+Foux+d%27Allos",                                active:true },
  { id:"abr_lf",   name:"Particuliers Abritel La Foux", property_type:"particulier", source:"Abritel",        comparability_score:56, has_pool:false, has_ski_access:false, standing:0, url:"https://www.abritel.fr/location-vacances/france/alpes/la-foux-d-allos",                             active:true },
  { id:"pap_lf",   name:"PAP Vacances La Foux",         property_type:"particulier", source:"PAP",            comparability_score:48, has_pool:false, has_ski_access:false, standing:0, url:"https://www.papvacances.fr",                                                                         active:true },
]


// ─── src/constants/weeks.js ──────────────────────────────────────
function buildWeeks(year) {
  const mns  = ["jan","fév","mar","avr","mai","juin","juil","août","sept","oct","nov","déc"]
  const evts = {
    [`${year}-07-11`]:"Vac. zone A", [`${year}-07-14`]:"Fête Nationale",
    [`${year}-07-18`]:"Vac. B/C",   [`${year}-08-15`]:"Assomption",
    [`${year}-09-05`]:"Rentrée",
  }
  let d = new Date(year, 5, 20)
  while (d.getDay() !== 6) d = new Date(d.getTime()+864e5)
  const res=[]; let wn=1
  while (d < new Date(year, 8, 13)) {
    const e   = new Date(d.getTime()+6*864e5)
    const m   = d.getMonth()
    const fmt = dt => `${dt.getDate()} ${mns[dt.getMonth()]}`
    const key = `${year}-${String(m+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
    let cat = "basse"
    if      (m===7)                   cat = "haute"
    else if (m===6&&d.getDate()>=11)  cat = "haute"
    else if (m===6)                   cat = "moyenne"
    else if (m===5&&d.getDate()>=27)  cat = "moyenne"
    res.push({
      id:`${year}_w${wn}`, year, week_number:wn,
      week_start:d.toISOString().slice(0,10),
      week_end:  e.toISOString().slice(0,10),
      label:`${fmt(d)} → ${fmt(e)}`,
      month_label:["Juin","Juillet","Août","Septembre"][m-5]||"",
      season_type:cat,
      event_label:evts[key]||null,
    })
    d=new Date(d.getTime()+7*864e5); wn++
  }
  return res
}

export const WEEKS_2026 = buildWeeks(2026)
export const WEEKS_2027 = buildWeeks(2027)
export const WEEKS_ALL  = [...WEEKS_2026, ...WEEKS_2027]


// ─── src/constants/ourTarifs.js ──────────────────────────────────
// Source : Goélia après promo -19% · vérifié location-vacances-express.com avr. 2026
// À mettre à jour chaque saison depuis cdva.resalys.com ou Goélia
export const OUR_TARIFS = {
  "2p": { haute:245, moyenne:195, basse:145 },
  "4p": { haute:359, moyenne:280, basse:210 },
  "6p": { haute:428, moyenne:340, basse:259 },
  "8p": { haute:489, moyenne:390, basse:290 },
}

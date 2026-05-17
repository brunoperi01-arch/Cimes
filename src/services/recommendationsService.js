import { supabase } from '../lib/supabaseClient'

function median(arr) {
  if (!arr.length) return null
  const s=arr.slice().sort((a,b)=>a-b), mid=Math.floor(s.length/2)
  return s.length%2 ? s[mid] : Math.round((s[mid-1]+s[mid])/2)
}

export function calculateRecommendation(ourPrice, rates, settings={}) {
  const { thresholdLow=15, thresholdHigh=20, obsoleteDays=7, minScore=70 } = settings
  const now=new Date(), age=d=>d?Math.floor((now-new Date(d))/864e5):999
  const qualified = rates.filter(r=>!r.is_example&&(r.comparability_score??50)>=minScore)
  const excluded  = rates.filter(r=>!r.is_example&&(r.comparability_score??50)<minScore)
  const recent    = qualified.filter(r=>age(r.collected_at)<=obsoleteDays)
  const hasOld    = qualified.some(r=>age(r.collected_at)>obsoleteDays)
  const maxAge    = qualified.length?Math.max(...qualified.map(r=>age(r.collected_at))):null
  const byType=t=>qualified.filter(r=>r.property_type===t)
  const prices=arr=>arr.map(r=>Number(r.price_week)).filter(Boolean)
  const medAll=median(prices(qualified)), medRes=median(prices(byType('résidence')))
  const medPart=median(prices(byType('particulier'))), medHot=median(prices(byType('hôtel')))
  const ref=medRes??medAll
  const hasEnough=qualified.length>=3, promoCount=rates.filter(r=>r.promo_label).length
  const confidence=!hasEnough?'faible':(qualified.length>=5&&recent.length>=3)?'fort':'moyen'
  const confScore={faible:20,moyen:55,fort:85}[confidence]
  let action='Maintenir', urgency='normal', explanation=''
  const low=ref?Math.round(ref*0.95):(ourPrice||0)
  const target=ref?Math.round(ref*1.02):(ourPrice||0)
  const high=ref?Math.round(ref*1.18):(ourPrice||0)
  if (!ref) {
    action='Relevé insuffisant'; urgency='haut'
    explanation=`${qualified.length} concurrent(s) qualifié(s) (score≥${minScore}). Minimum 3 requis.`
  } else if (ourPrice) {
    const pct=(ourPrice-ref)/ref*100
    if      (pct<-thresholdLow)  { action='Augmenter le tarif';       urgency='haut';  explanation=`Tarif ${Math.abs(Math.round(pct))}% sous la médiane résidences (${ref.toLocaleString('fr-FR')}€). Potentiel +${(ref-ourPrice).toLocaleString('fr-FR')}€/sem.` }
    else if (pct>thresholdHigh)  { action='Baisser ou créer une promo';urgency='moyen'; explanation=`Tarif ${Math.round(pct)}% au-dessus de la médiane (${ref.toLocaleString('fr-FR')}€).` }
    else if (promoCount>=3)      { action='Surveiller les promotions'; urgency='moyen'; explanation=`${promoCount} concurrents en promotion active.` }
    else                         { action='Maintenir';                 urgency='normal';explanation=`Bien positionné (${pct>=0?'+':''}${Math.round(pct)}% vs médiane ${ref.toLocaleString('fr-FR')}€).` }
  }
  if (hasOld) explanation += ' ⚠ Certains relevés sont obsolètes.'
  return { medAll, medRes, medPart, medHot, ref, low, target, high, action, urgency, confidence, confScore, explanation, hasEnough, promoCount, ratesCount:qualified.length, excludedCount:excluded.length, recentCount:recent.length, dataAgeDays:maxAge, hasOld }
}

export async function saveRecommendation(weekId, capacity, reco, ourPrice) {
  const { data, error } = await supabase.from('recommendations').insert({
    week_id:weekId, capacity, our_price:ourPrice,
    market_median:reco.medAll, residence_median:reco.medRes, private_median:reco.medPart, hotel_median:reco.medHot,
    recommended_low:reco.low, recommended_target:reco.target, recommended_high:reco.high,
    recommended_action:reco.action, urgency_level:reco.urgency,
    confidence_level:reco.confidence, confidence_score:reco.confScore,
    competitors_count:reco.ratesCount, data_age_days:reco.dataAgeDays, explanation:reco.explanation,
  }).select().single()
  if (error) throw error
  return data
}
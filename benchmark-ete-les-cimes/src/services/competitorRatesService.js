import { supabase }    from '../lib/supabaseClient'
import { COMPETITORS }  from '../constants/competitors'

function enrichRates(rawRates) {
  return rawRates.map(r => {
    const comp = r.competitors || COMPETITORS.find(c=>c.id===r.competitor_id||c.source===r.source)
    return { ...r,
      comparability_score: comp?.comparability_score ?? 50,
      property_type:       comp?.property_type       ?? r.property_type ?? 'particulier',
      competitor_name:     comp?.name                ?? r.property_name ?? r.source,
    }
  })
}

export async function getCompetitorRates({ weekId, capacity, showExamples=false }) {
  let q = supabase.from('competitor_rates')
    .select('*, competitors(id,name,property_type,comparability_score)')
    .eq('week_id', weekId).eq('capacity', capacity)
    .order('collected_at', { ascending:false })
  if (!showExamples) q = q.eq('is_example', false)
  const { data, error } = await q
  if (error) throw error
  return enrichRates(data || [])
}

export async function getHistoricalRates({ weekId, competitorId, capacity }) {
  const { data, error } = await supabase.from('competitor_rates')
    .select('*, competitors(name)')
    .eq('week_id', weekId).eq('competitor_id', competitorId).eq('capacity', capacity)
    .order('collected_at', { ascending:true })
  if (error) throw error
  return data || []
}

async function checkDuplicate(rate) {
  if (rate.competitor_id) {
    const { data } = await supabase.from('competitor_rates').select('id')
      .eq('week_id',rate.week_id).eq('competitor_id',rate.competitor_id)
      .eq('capacity',rate.capacity).eq('collected_at',rate.collected_at)
      .eq('source',rate.source).maybeSingle()
    return !!data
  }
  if (rate.property_name) {
    const { data } = await supabase.from('competitor_rates').select('id')
      .eq('week_id',rate.week_id).eq('property_name',rate.property_name)
      .eq('source',rate.source).eq('capacity',rate.capacity)
      .eq('collected_at',rate.collected_at).is('competitor_id',null).maybeSingle()
    return !!data
  }
  return false
}

// user_id omis : DEFAULT auth.uid() côté Supabase
export async function saveCompetitorRate(rate) {
  const { user_id, ...clean } = rate
  if (await checkDuplicate(clean)) throw new Error('DUPLICATE')
  const { data, error } = await supabase.from('competitor_rates').insert(clean).select().single()
  if (error) throw error
  return data
}

export async function deleteCompetitorRate(id) {
  const { error } = await supabase.from('competitor_rates').delete().eq('id', id)
  if (error) throw error
}
import { supabase }           from '../lib/supabaseClient'
import { saveCompetitorRate } from './competitorRatesService'
import { parseCsvText }       from '../utils/parsers'

export { parseCsvText }

export async function importCsvRows(rows) {
  const res = { imported:0, duplicates:0, skipped:0, errors:[], noCompId:0, noName:0 }
  for (const row of rows) {
    if (!row.price_week || !row.source) { res.skipped++; continue }
    if (!row.competitor_id) res.noCompId++
    if (!row.property_name) res.noName++
    try   { await saveCompetitorRate(row); res.imported++ }
    catch (e) { e.message?.includes('DUPLICATE') ? res.duplicates++ : res.errors.push(e.message) }
  }
  await supabase.from('imports').insert({
    import_source:'CSV', rows_total:rows.length, rows_imported:res.imported,
    rows_skipped:res.skipped, rows_duplicate:res.duplicates, rows_error:res.errors.length,
    status:res.errors.length===0?'ok':res.imported>0?'partiel':'erreur',
    error_details:res.errors.length?res.errors.slice(0,10):null,
  })
  return res
}

export async function getImports(limit=10) {
  const { data, error } = await supabase.from('imports')
    .select('*').order('imported_at', { ascending:false }).limit(limit)
  if (error) throw error
  return data || []
}
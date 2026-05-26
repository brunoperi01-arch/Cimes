import { useEffect, useState, useCallback } from 'react'
import { supabase, supabaseReady } from '../lib/supabaseClient'

export function useCompetitorRates({ weekId, capacity, showExamples }) {
  const [rates, setRates] = useState([])
  const [loading, setLoading] = useState(false)

  const loadRates = useCallback(async () => {
    if (!supabaseReady || !supabase) {
      setRates([])
      setLoading(false)
      return
    }

    if (!weekId || !capacity) {
      setRates([])
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      let query = supabase
        .from('competitor_rates')
        .select('*')
        .eq('week_id', weekId)
        .eq('capacity', capacity)
        .order('price', { ascending: true })

      if (!showExamples) {
        query = query.neq('source', 'example')
      }

      const { data, error } = await query

      if (error) {
        throw error
      }

      setRates(data || [])
    } catch (error) {
      console.error('Erreur chargement tarifs concurrents:', error)
      setRates([])
    } finally {
      setLoading(false)
    }
  }, [weekId, capacity, showExamples])

  useEffect(() => {
    loadRates()
  }, [loadRates])

  return {
    rates,
    loading,
    reload: loadRates
  }
}

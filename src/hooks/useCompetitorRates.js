import { useState, useEffect, useCallback } from 'react'
import { getCompetitorRates }               from '../services/competitorRatesService'

export function useCompetitorRates({ weekId, capacity, showExamples = false }) {
  const [rates,   setRates]   = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const load = useCallback(async () => {
    if (!weekId || !capacity) return
    setLoading(true); setError(null)
    try   { setRates(await getCompetitorRates({ weekId, capacity, showExamples })) }
    catch (e) { setError(e.message); setRates([]) }
    finally   { setLoading(false) }
  }, [weekId, capacity, showExamples])

  useEffect(() => { load() }, [load])
  return { rates, loading, error, reload: load }
}
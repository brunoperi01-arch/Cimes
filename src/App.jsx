import { useState, useCallback, useEffect } from 'react'

import { useAuth } from './hooks/useAuth'
import { useCompetitorRates } from './hooks/useCompetitorRates'

import { saveCompetitorRate } from './services/competitorRatesService'
import { parseCsvText, importCsvRows, getImports } from './services/importsService'
import { calculateRecommendation } from './services/recommendationsService'

import { WEEKS_ALL } from './constants/weeks'
import { OUR_TARIFS } from './constants/ourTarifs'

import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { WeeksPage } from './pages/WeeksPage'
import { WeekDetailPage } from './pages/WeekDetailPage'
import { CollectPage } from './pages/CollectPage'
import { ImportPage } from './pages/ImportPage'
import { DiagnosticPage } from './pages/DiagnosticPage'

const SHELL = {
  width: 390,
  margin: '0 auto',
  fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif",
  background: '#F3F4F6',
  minHeight: 760,
  borderRadius: 44,
  overflow: 'hidden',
  border: '0.5px solid #E5E7EB'
}

const SETTINGS = {
  thresholdLow: 15,
  thresholdHigh: 20,
  obsoleteDays: 7,
  minScore: 70
}

export default function App() {
  const { user, loading, signIn, signOut } = useAuth()

  const [screen, setScreen] = useState('dashboard')
  const [cap, setCap] = useState('6p')
  const [yr, setYr] = useState(2026)
  const [selWeekId, setSelWeekId] = useState('2026_w7')
  const [showExamples, setShowExamples] = useState(false)
  const [formSaved, setFormSaved] = useState(null)
  const [imports, setImports] = useState([])
  const [lastStats, setLastStats] = useState(null)
  const [sbErrors] = useState([])

  const selWeek = WEEKS_ALL.find(w => w.id === selWeekId) || WEEKS_ALL[6]
  const ourPrice = OUR_TARIFS[cap]?.[selWeek?.season_type] || 0
  const capNum = parseInt(cap, 10)

  const {
    rates = [],
    loading: ratesLoading = false,
    reload: reloadRates = () => {}
  } = useCompetitorRates({
    weekId: selWeekId,
    capacity: capNum,
    showExamples
  })

  const reco = calculateRecommendation(ourPrice, rates, SETTINGS)

  const loadImports = useCallback(() => {
    getImports()
      .then(data => {
        setImports(data || [])
      })
      .catch(() => {
        setImports([])
      })
  }, [])

  useEffect(() => {
    if (user) {
      loadImports()
    }
  }, [user, loadImports])

  async function handleLogin(email, password) {
    const { error } = await signIn(email, password)

    if (error) {
      throw error
    }

    setScreen('dashboard')
    loadImports()
  }

  async function handleSaveRate(rate) {
    try {
      await saveCompetitorRate(rate)

      setFormSaved('ok')
      reloadRates()
    } catch (e) {
      const message = e?.message || ''

      setFormSaved(message.includes('DUPLICATE') ? 'duplicate' : 'error')
    }

    setTimeout(() => {
      setFormSaved(null)
    }, 3000)
  }

  async function handleImportCsv(csvText) {
    const rows = parseCsvText(csvText, capNum)
    const stats = await importCsvRows(rows)

    setLastStats(stats)
    reloadRates()
    loadImports()

    return stats
  }

  function navigate(dest) {
    setScreen(dest)
  }

  function selectWeek(id) {
    setSelWeekId(id)
    setScreen('week')
  }

  const shared = {
    user,
    sbReady: true,
    onLogout: signOut,
    screen,
    onNavigate: navigate
  }

  const state = {
    cap,
    setCap,
    yr,
    setYr,
    selWeek,
    selWeekId,
    showExamples,
    setShowExamples,
    settings: SETTINGS,
    rates,
    ratesLoading,
    reco,
    imports,
    lastImportStats: lastStats,
    sbErrors
  }

  if (loading) {
    return (
      <div
        style={{
          ...SHELL,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 760
        }}
      >
        <p style={{ color: '#6B7280' }}>Chargement…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={SHELL}>
        <LoginPage onLogin={handleLogin} sbReady={true} />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '20px 0 40px'
      }}
    >
      <div style={SHELL}>
        {screen === 'dashboard' && (
          <DashboardPage
            {...shared}
            {...state}
            ratesMap={{}}
          />
        )}

        {screen === 'weeks' && (
          <WeeksPage
            {...shared}
            {...state}
            onSelectWeek={selectWeek}
            ratesMap={{}}
          />
        )}

        {screen === 'week' && (
          <WeekDetailPage
            {...shared}
            {...state}
            onSaveRate={handleSaveRate}
            onRateDeleted={reloadRates}
          />
        )}

        {(screen === 'collect' || screen === 'manual' || screen === 'paste') && (
          <CollectPage
            {...shared}
            {...state}
            onSaveRate={handleSaveRate}
            formSaved={formSaved}
          />
        )}

        {screen === 'import' && (
          <ImportPage
            {...shared}
            {...state}
            onImportCsv={handleImportCsv}
          />
        )}

        {screen === 'diag' && (
          <DiagnosticPage
            {...shared}
            {...state}
          />
        )}
      </div>
    </div>
  )
}

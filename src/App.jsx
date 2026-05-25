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
  const {
    user,
    loading,
    signIn,
    signOut,
    supabaseReady = false,
    authError = null
  } = useAuth()

  async function handleLogin(email, password) {
    if (!supabaseReady) {
      throw new Error(
        'Supabase n’est pas encore configuré. Crée la base puis ajoute VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans Vercel.'
      )
    }

    const { error } = await signIn(email, password)

    if (error) {
      throw error
    }
  }

  if (loading) {
    return (
      <CenteredShell>
        <p style={{ color: '#6B7280' }}>Chargement…</p>
      </CenteredShell>
    )
  }

  if (!supabaseReady) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0 40px' }}>
        <div style={SHELL}>
          <SupabaseNotReady authError={authError} />
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0 40px' }}>
        <div style={SHELL}>
          <LoginPage onLogin={handleLogin} sbReady={supabaseReady} />
        </div>
      </div>
    )
  }

  return (
    <AuthenticatedApp
      user={user}
      signOut={signOut}
      supabaseReady={supabaseReady}
    />
  )
}

function AuthenticatedApp({ user, signOut, supabaseReady }) {
  const [screen, setScreen] = useState('dashboard')
  const [cap, setCap] = useState('6p')
  const [yr, setYr] = useState(2026)
  const [selWeekId, setSelWeekId] = useState('2026_w7')
  const [showExamples, setShowExamples] = useState(false)
  const [formSaved, setFormSaved] = useState(null)
  const [imports, setImports] = useState([])
  const [lastStats, setLastStats] = useState(null)
  const [sbErrors, setSbErrors] = useState([])

  const selWeek = WEEKS_ALL.find(w => w.id === selWeekId) || WEEKS_ALL[0]
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
    if (!supabaseReady) {
      setImports([])
      return
    }

    getImports()
      .then(data => {
        setImports(data || [])
      })
      .catch(error => {
        console.error('Erreur chargement imports:', error)
        setImports([])
        setSbErrors(prev => [
          ...prev,
          error?.message || 'Erreur chargement imports'
        ])
      })
  }, [supabaseReady])

  useEffect(() => {
    loadImports()
  }, [loadImports])

  async function handleSaveRate(rate) {
    if (!supabaseReady) {
      setFormSaved('error')
      setSbErrors(prev => [
        ...prev,
        'Supabase non configuré : impossible d’enregistrer le tarif.'
      ])
      return
    }

    try {
      await saveCompetitorRate(rate)

      setFormSaved('ok')
      reloadRates()
    } catch (error) {
      const message = error?.message || ''

      console.error('Erreur sauvegarde tarif:', error)

      setFormSaved(message.includes('DUPLICATE') ? 'duplicate' : 'error')
      setSbErrors(prev => [
        ...prev,
        message || 'Erreur sauvegarde tarif'
      ])
    }

    setTimeout(() => {
      setFormSaved(null)
    }, 3000)
  }

  async function handleImportCsv(csvText) {
    if (!supabaseReady) {
      throw new Error(
        'Supabase non configuré : impossible d’importer le CSV.'
      )
    }

    try {
      const rows = parseCsvText(csvText, capNum)
      const stats = await importCsvRows(rows)

      setLastStats(stats)
      reloadRates()
      loadImports()

      return stats
    } catch (error) {
      console.error('Erreur import CSV:', error)

      setSbErrors(prev => [
        ...prev,
        error?.message || 'Erreur import CSV'
      ])

      throw error
    }
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
    sbReady: supabaseReady,
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

function CenteredShell({ children }) {
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
      {children}
    </div>
  )
}

function SupabaseNotReady({ authError }) {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 28, marginBottom: 8 }}>
        Les Cimes
      </h1>

      <p style={{ color: '#6B7280', lineHeight: 1.5 }}>
        L’application React fonctionne, mais Supabase n’est pas encore configuré.
      </p>

      <div
        style={{
          background: '#FEF3C7',
          color: '#92400E',
          padding: 14,
          borderRadius: 14,
          marginTop: 20,
          fontSize: 14,
          lineHeight: 1.5
        }}
      >
        <strong>Configuration manquante</strong>
        <br />
        Ajoute les variables suivantes dans Vercel :
        <br />
        <code>VITE_SUPABASE_URL</code>
        <br />
        <code>VITE_SUPABASE_ANON_KEY</code>
      </div>

      {authError && (
        <div
          style={{
            background: '#FEE2E2',
            color: '#991B1B',
            padding: 14,
            borderRadius: 14,
            marginTop: 16,
            fontSize: 14,
            lineHeight: 1.5
          }}
        >
          <strong>Erreur détectée :</strong>
          <br />
          {String(authError)}
        </div>
      )}

      <div
        style={{
          background: 'white',
          border: '1px solid #E5E7EB',
          padding: 14,
          borderRadius: 14,
          marginTop: 16,
          fontSize: 14,
          lineHeight: 1.5
        }}
      >
        <strong>À faire ensuite :</strong>
        <br />
        1. Créer le projet Supabase.
        <br />
        2. Copier l’URL du projet.
        <br />
        3. Copier la clé publique anon.
        <br />
        4. Les ajouter dans Vercel.
        <br />
        5. Redéployer le site.
      </div>
    </div>
  )
}

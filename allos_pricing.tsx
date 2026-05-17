// ─── src/lib/supabaseClient.js ───────────────────────────────────
import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key || url === "https://your-project.supabase.co") {
  throw new Error(
    "Variables manquantes : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY\n" +
    "Copiez .env.example → .env.local et remplissez vos clés Supabase."
  )
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession:   true,
    storageKey:       "benchmark-ete-session",
    autoRefreshToken: true,
  },
})


// ─── src/hooks/useAuth.js ────────────────────────────────────────
import { useState, useEffect } from "react"
import { supabase }            from "../lib/supabaseClient"

export function useAuth() {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Restaurer session existante (survie au refresh — géré par @supabase/supabase-js)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const signIn  = (email, password) => supabase.auth.signInWithPassword({ email, password })
  const signOut = ()                 => supabase.auth.signOut()

  return { user, loading, signIn, signOut }
}


// ─── src/hooks/useCompetitorRates.js ────────────────────────────
import { useState, useEffect, useCallback } from "react"
import { getCompetitorRates }               from "../services/competitorRatesService"

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


// ─── src/main.jsx ────────────────────────────────────────────────
import React    from "react"
import ReactDOM from "react-dom/client"
import App      from "./App.jsx"

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App/>
  </React.StrictMode>
)


// ─── src/App.jsx ─────────────────────────────────────────────────
import { useState, useCallback } from "react"
import { useAuth }               from "./hooks/useAuth"
import { useCompetitorRates }    from "./hooks/useCompetitorRates"
import { saveCompetitorRate }    from "./services/competitorRatesService"
import { parseCsvText, importCsvRows, getImports } from "./services/importsService"
import { calculateRecommendation } from "./services/recommendationsService"
import { WEEKS_ALL }             from "./constants/weeks"
import { OUR_TARIFS }            from "./constants/ourTarifs"

import { LoginPage }      from "./pages/LoginPage"
import { DashboardPage }  from "./pages/DashboardPage"
import { WeeksPage }      from "./pages/WeeksPage"
import { WeekDetailPage } from "./pages/WeekDetailPage"
import { CollectPage }    from "./pages/CollectPage"
import { ImportPage }     from "./pages/ImportPage"
import { DiagnosticPage } from "./pages/DiagnosticPage"

// ── Styles de la coque iPhone (utilisé une seule fois ici)
const PHONE_SHELL = {
  width:390, margin:"0 auto",
  fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif",
  background:"#F3F4F6", minHeight:760, borderRadius:44,
  overflow:"hidden", border:"0.5px solid #E5E7EB",
}

const DEFAULT_SETTINGS = {
  thresholdLow:  15,
  thresholdHigh: 20,
  obsoleteDays:  7,
  minScore:      70,
}

export default function App() {
  const { user, loading, signIn, signOut } = useAuth()

  const [screen,          setScreen]          = useState("dashboard")
  const [cap,             setCap]             = useState("6p")
  const [yr,              setYr]              = useState(2026)
  const [selWeekId,       setSelWeekId]       = useState("2026_w7")
  const [showExamples,    setShowExamples]    = useState(false)
  const [formSaved,       setFormSaved]       = useState(null)
  const [imports,         setImports]         = useState([])
  const [lastImportStats, setLastImportStats] = useState(null)
  const [sbErrors]                            = useState([])

  const capNum   = parseInt(cap)
  const selWeek  = WEEKS_ALL.find(w => w.id === selWeekId) || WEEKS_ALL[6]
  const ourPrice = OUR_TARIFS[cap]?.[selWeek?.season_type] || 0
  const settings = DEFAULT_SETTINGS

  // Relevés pour la semaine / capacité sélectionnées
  const { rates, loading: ratesLoading, reload: reloadRates } = useCompetitorRates({
    weekId:      selWeekId,
    capacity:    capNum,
    showExamples,
  })

  const reco = calculateRecommendation(ourPrice, rates, settings)

  // Charger l'historique des imports au login
  const loadImports = useCallback(() => {
    getImports().then(setImports).catch(() => {})
  }, [])

  // ── Auth handlers
  async function handleLogin(email, password) {
    const { error } = await signIn(email, password)
    if (error) throw error
    setScreen("dashboard")
    loadImports()
  }

  function handleLogout() {
    signOut()
    setScreen("login")
  }

  // ── Sauver un relevé concurrent
  async function handleSaveRate(rate) {
    try {
      await saveCompetitorRate(rate)
      setFormSaved("ok")
      reloadRates()
    } catch (e) {
      setFormSaved(e.message.includes("DUPLICATE") ? "duplicate" : "error")
    }
    setTimeout(() => setFormSaved(null), 3000)
  }

  // ── Import CSV
  async function handleImportCsv(csvText) {
    const rows  = parseCsvText(csvText, capNum)
    const stats = await importCsvRows(rows)
    setLastImportStats(stats)
    reloadRates()
    loadImports()
    return stats
  }

  // ── Navigation
  function navigate(dest) {
    setScreen(dest)
  }

  function selectWeek(wId) {
    setSelWeekId(wId)
    setScreen("week")
  }

  // ── Props communes à toutes les pages
  const shared = {
    user,
    sbReady:   true,  // import.meta.env vérifié dans supabaseClient.js
    onLogout:  handleLogout,
    screen,
    onNavigate:navigate,
  }

  const stateProps = {
    cap, setCap, yr, setYr,
    selWeek, selWeekId,
    showExamples, setShowExamples,
    settings, rates, ratesLoading, reco,
    imports, lastImportStats, sbErrors,
  }

  // ── Chargement initial
  if (loading) return (
    <div style={{ display:"flex", justifyContent:"center", padding:"20px 0 40px" }}>
      <div style={PHONE_SHELL}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", paddingTop:200 }}>
          <p style={{ color:"#6B7280", fontSize:14 }}>Chargement…</p>
        </div>
      </div>
    </div>
  )

  // ── Écran login
  if (!user) return (
    <div style={{ display:"flex", justifyContent:"center", padding:"20px 0 40px" }}>
      <div style={PHONE_SHELL}>
        <LoginPage onLogin={handleLogin} sbReady={true}/>
      </div>
    </div>
  )

  // ── App principale
  return (
    <div style={{ display:"flex", justifyContent:"center", padding:"20px 0 40px" }}>
      <div style={PHONE_SHELL}>
        {screen==="dashboard" && (
          <DashboardPage {...shared} {...stateProps} ratesMap={{}}/>
        )}
        {screen==="weeks" && (
          <WeeksPage {...shared} {...stateProps} onSelectWeek={selectWeek} ratesMap={{}}/>
        )}
        {screen==="week" && (
          <WeekDetailPage {...shared} {...stateProps}
            onSaveRate={handleSaveRate}
            onRateDeleted={reloadRates}
          />
        )}
        {(screen==="collect"||screen==="manual"||screen==="paste") && (
          <CollectPage {...shared} {...stateProps}
            onSaveRate={handleSaveRate}
            formSaved={formSaved}
          />
        )}
        {screen==="import" && (
          <ImportPage {...shared} {...stateProps}
            onImportCsv={handleImportCsv}
          />
        )}
        {screen==="diag" && (
          <DiagnosticPage {...shared} {...stateProps}/>
        )}
      </div>
    </div>
  )
}

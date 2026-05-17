// ─── src/pages/LoginPage.jsx ─────────────────────────────────────
import { useState }  from "react"
import { C }         from "../utils/colors"
import { styles }    from "../utils/styles"

export function LoginPage({ onLogin, sbReady }) {
  const [email,   setEmail]   = useState("")
  const [pwd,     setPwd]     = useState("")
  const [err,     setErr]     = useState("")
  const [loading, setLoading] = useState(false)

  async function handle() {
    setErr(""); setLoading(true)
    try   { await onLogin(email, pwd) }
    catch (e) { setErr(e.message) }
    setLoading(false)
  }

  return (
    <div style={{ padding:"60px 28px 0" }}>
      <div style={{ width:52, height:52, background:C.blue, borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:22 }}>
        <span style={{ fontSize:26 }}>⛰</span>
      </div>
      <h1 style={{ margin:"0 0 5px", fontSize:21, fontWeight:700, color:C.text }}>Benchmark Été</h1>
      <p style={{ margin:"0 0 30px", fontSize:12, color:C.textS }}>Les Cimes du Val d'Allos · Accès privé</p>
      {err && <div style={{ background:C.redL, borderRadius:9, padding:"9px 12px", marginBottom:10 }}><p style={{ margin:0, fontSize:12, color:C.red, fontWeight:600 }}>✗ {err}</p></div>}
      {!sbReady && <div style={{ background:C.goldL, borderRadius:9, padding:"9px 12px", marginBottom:10 }}><p style={{ margin:0, fontSize:10, color:C.gold }}>Mode démo — saisir n'importe quel email/mot de passe.</p></div>}
      <p style={styles.sml}>Email</p>
      <input type="email" style={{ ...styles.inp(), marginBottom:10 }} value={email} onChange={e=>setEmail(e.target.value)} placeholder="votre@email.com"/>
      <p style={styles.sml}>Mot de passe</p>
      <input type="password" style={{ ...styles.inp(), marginBottom:16 }} value={pwd} onChange={e=>setPwd(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handle()}/>
      <button style={styles.btn(loading)} onClick={handle} disabled={loading}>{loading?"Connexion…":"Se connecter →"}</button>
      <p style={{ fontSize:9, color:C.gray, textAlign:"center", marginTop:12, lineHeight:1.5 }}>
        Application privée · Données confidentielles<br/>
        Config : VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY dans .env.local
      </p>
    </div>
  )
}


// ─── src/pages/DashboardPage.jsx ─────────────────────────────────
import { SBar }      from "../components/layout/SBar"
import { BNav }      from "../components/layout/BNav"
import { WEEKS_ALL } from "../constants/weeks"
import { OUR_TARIFS }from "../constants/ourTarifs"
import { calculateRecommendation } from "../services/recommendationsService"

export function DashboardPage({ user, sbReady, onLogout, cap, setCap, yr, setYr, showExamples, setShowExamples, screen, onNavigate, ratesMap, settings }) {
  const allWeeksYr = WEEKS_ALL.filter(w=>w.year===yr)
  const capNum     = parseInt(cap)
  const stats = (() => {
    let low=0, noData=0, promos=0, missing=0
    allWeeksYr.forEach(w => {
      const rates = ratesMap?.[`${w.id}_${capNum}`]||[]
      const r     = calculateRecommendation(OUR_TARIFS[cap]?.[w.season_type]||0, rates, settings)
      if (!r.hasEnough) noData++
      if (r.action==="Augmenter le tarif") low++
      promos += r.promoCount
      if (!rates.length) missing++
    })
    return { low, noData, promos, missing }
  })()

  return (
    <div>
      <SBar title="Dashboard" user={user} sbReady={sbReady} onLogout={onLogout}/>
      <div style={{ background:`linear-gradient(135deg,${C.blue},${C.blueL})`, padding:"10px 16px 16px" }}>
        <p style={{ margin:0, fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.5)", textTransform:"uppercase" }}>Les Cimes du Val d'Allos</p>
        <h1 style={{ margin:"2px 0", fontSize:18, fontWeight:700, color:C.white }}>Benchmark Été {yr}</h1>
        <p style={{ margin:0, fontSize:11, color:"rgba(255,255,255,0.65)" }}>{user?.email} · {cap} · {allWeeksYr.length} semaines</p>
      </div>
      <div style={styles.cnt}>
        <div style={{ display:"flex", gap:6, marginTop:10 }}>
          <div style={{ flex:1 }}>
            <p style={styles.sml}>Capacité</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4 }}>
              {["2p","4p","6p","8p"].map(c=>(
                <button key={c} onClick={()=>setCap(c)} style={{ padding:"6px 0", background:cap===c?C.blue:C.white, border:"none", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:cap===c?700:400, color:cap===c?C.white:C.text }}>{c}</button>
              ))}
            </div>
          </div>
          <div>
            <p style={styles.sml}>Année</p>
            <div style={{ display:"flex", background:C.grayM, borderRadius:8, padding:2 }}>
              {[2026,2027].map(y=>(
                <button key={y} onClick={()=>setYr(y)} style={{ padding:"6px 9px", fontSize:11, fontWeight:yr===y?700:400, background:yr===y?C.white:"transparent", color:yr===y?C.blue:C.gray, border:"none", borderRadius:6, cursor:"pointer" }}>{y}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ ...styles.card(11), padding:"10px 13px", background:sbReady?C.greenL:C.goldL, marginTop:8 }}>
          <p style={{ margin:"0 0 1px", fontSize:11, fontWeight:700, color:sbReady?C.green:C.gold }}>
            {sbReady?"✓ Données persistées en Supabase":"⚠ Mode local — données non persistées"}
          </p>
        </div>

        <div style={{ ...styles.card(11), padding:"10px 13px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <p style={{ margin:0, fontSize:13, fontWeight:500, color:C.text }}>Données exemple</p>
            <p style={{ margin:0, fontSize:10, color:C.textS }}>Désactiver en production</p>
          </div>
          <button onClick={()=>setShowExamples(p=>!p)} style={{ width:44, height:26, borderRadius:13, background:showExamples?C.blue:C.grayM, border:"none", cursor:"pointer", position:"relative" }}>
            <div style={{ position:"absolute", top:3, left:showExamples?21:3, width:20, height:20, borderRadius:"50%", background:C.white, transition:"left 0.15s" }}/>
          </button>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginTop:0 }}>
          {[
            { v:stats.missing, l:"Sans relevés",          c:C.red,    bg:C.redL    },
            { v:stats.noData,  l:"Données insuffisantes", c:C.orange, bg:C.orangeL },
            { v:stats.low,     l:"Tarifs trop bas",       c:C.gold,   bg:C.goldL   },
            { v:stats.promos,  l:"Promos détectées",      c:C.purple, bg:C.purpleL },
          ].map((k,i)=>(
            <div key={i} style={{ ...styles.card(11,0), padding:"10px 11px", background:k.bg }}>
              <p style={{ margin:"0 0 1px", fontSize:20, fontWeight:700, color:k.c }}>{k.v}</p>
              <p style={{ margin:0, fontSize:9, color:k.c, fontWeight:600 }}>{k.l}</p>
            </div>
          ))}
        </div>

        <p style={styles.sml}>Accès rapides</p>
        <div style={styles.card()}>
          {[
            { icon:"✏️", l:"Saisir un relevé",           s:"collect" },
            { icon:"📋", l:"Copier-coller Booking/Airbnb", s:"paste"  },
            { icon:"📥", l:"Importer un CSV",             s:"import"  },
            { icon:"🔬", l:"Diagnostic système",          s:"diag"    },
          ].map((item,i,arr)=>(
            <div key={i} style={{ ...styles.row(i===arr.length-1), cursor:"pointer" }} onClick={()=>onNavigate(item.s)}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:16 }}>{item.icon}</span>
                <span style={{ fontSize:13, fontWeight:500, color:C.text }}>{item.l}</span>
              </div>
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={C.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          ))}
        </div>
      </div>
      <BNav screen={screen} onNavigate={onNavigate}/>
    </div>
  )
}


// ─── src/pages/WeeksPage.jsx ─────────────────────────────────────
import { SBar }          from "../components/layout/SBar"
import { BNav }          from "../components/layout/BNav"
import { Badge }         from "../components/ui/Badge"
import { CAT_COLORS, CAT_LABELS } from "../utils/colors"
import { WEEKS_ALL }     from "../constants/weeks"
import { OUR_TARIFS }    from "../constants/ourTarifs"
import { calculateRecommendation } from "../services/recommendationsService"
import { fmt }           from "../utils/formatters"

export function WeeksPage({ user, sbReady, onLogout, cap, yr, setYr, screen, onNavigate, onSelectWeek, ratesMap, settings }) {
  const capNum  = parseInt(cap)
  const ws      = WEEKS_ALL.filter(w=>w.year===yr)
  const grouped = {}
  ws.forEach(w => { if (!grouped[w.month_label]) grouped[w.month_label]=[]; grouped[w.month_label].push(w) })

  return (
    <div>
      <SBar title={`Semaines ${yr}`} user={user} sbReady={sbReady} onLogout={onLogout}/>
      <div style={{ padding:"4px 14px 0" }}>
        <div style={{ display:"flex", gap:5, marginBottom:6 }}>
          {[2026,2027].map(y=>(
            <button key={y} onClick={()=>setYr(y)} style={{ padding:"5px 10px", fontSize:11, fontWeight:yr===y?700:400, background:yr===y?C.blue:C.white, color:yr===y?C.white:C.text, border:"none", borderRadius:16, cursor:"pointer" }}>{y}</button>
          ))}
        </div>
      </div>
      <div style={{ ...styles.cnt, paddingTop:2 }}>
        {Object.entries(grouped).map(([ml,wks])=>(
          <div key={ml}>
            <p style={styles.sml}>{ml}</p>
            <div style={styles.card()}>
              {wks.map((w,i)=>{
                const rates    = ratesMap?.[`${w.id}_${capNum}`]||[]
                const op       = OUR_TARIFS[cap]?.[w.season_type]||0
                const r        = calculateRecommendation(op, rates, settings)
                const st       = !r.hasEnough?"manque":r.action==="Augmenter le tarif"?"trop bas":r.action.includes("Baisser")?"trop haut":"ok"
                const stColor  = { manque:C.gray, "trop bas":C.red, "trop haut":C.gold, ok:C.green }[st]
                const stBg     = { manque:C.grayL,"trop bas":C.redL,"trop haut":C.goldL, ok:C.greenL }[st]
                const hasPromo = rates.some(x=>x.promo_label)
                return (
                  <div key={w.id} onClick={()=>onSelectWeek(w.id)} style={{ ...styles.row(i===wks.length-1), cursor:"pointer" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
                        <div style={{ width:5, height:5, borderRadius:"50%", background:CAT_COLORS[w.season_type] }}/>
                        <span style={{ fontSize:12, fontWeight:500, color:C.text }}>{w.label}</span>
                        {w.event_label&&<span style={{ fontSize:8, background:C.purpleL, color:C.purple, padding:"1px 4px", borderRadius:3, fontWeight:600 }}>{w.event_label.slice(0,10)}</span>}
                      </div>
                      <div style={{ display:"flex", gap:4, marginLeft:10 }}>
                        <Badge label={st==="ok"?`✓ ${rates.length} relevé(s)`:st==="manque"?"MANQUANT":st.toUpperCase()} color={stColor} bg={stBg} size={9}/>
                        {hasPromo&&<Badge label="PROMO" color={C.orange} bg={C.orangeL} size={9}/>}
                        {r.ref&&op&&<span style={{ fontSize:9, fontWeight:700, color:(op-r.ref)>0?C.green:C.red }}>{(op-r.ref)>0?"+":""}{Math.round((op-r.ref)/r.ref*100)}%</span>}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      {op>0&&<><p style={{ margin:0, fontSize:12, fontWeight:600, color:C.blue }}>{fmt(Math.round(op/7))}€/n</p><p style={{ margin:0, fontSize:9, color:C.gray }}>{fmt(op)}€/sem</p></>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <BNav screen={screen} onNavigate={onNavigate}/>
    </div>
  )
}


// ─── src/pages/CollectPage.jsx ───────────────────────────────────
import { useState }        from "react"
import { SBar }            from "../components/layout/SBar"
import { BNav }            from "../components/layout/BNav"
import { SaveFeedback }    from "../components/layout/SaveFeedback"
import { parsePastedPageText } from "../utils/parsers"
import { COMPETITORS }     from "../constants/competitors"
import { WEEKS_ALL }       from "../constants/weeks"

const TODAY  = new Date().toISOString().slice(0,10)
const PROMOS = ["","Genius -10%","Remise 7 nuits -5%","Réduction semaine -8%","Last minute","Early booking","PDJ inclus","Annulation gratuite","Promo -19%","-10%","-15%","-20%"]
const emptyForm = weekId => ({ weekId, competitorId:"cv", source:"", type:"résidence", capacity:6, priceWeek:"", priceNight:"", originalPrice:"", promoLabel:"", promoPercent:"", cleaningFee:"", url:"", collectedAt:TODAY, notes:"" })

export function CollectPage({ user, sbReady, onLogout, screen, onNavigate, selWeekId, cap, onSaveRate, formSaved }) {
  const capNum = parseInt(cap)
  const [mode,       setMode]       = useState("menu")
  const [form,       setForm]       = useState(emptyForm(selWeekId))
  const [pasteSrc,   setPasteSrc]   = useState("Booking")
  const [pasteWk,    setPasteWk]    = useState(selWeekId)
  const [pasteCap,   setPasteCap]   = useState(capNum)
  const [pasteComp,  setPasteComp]  = useState("cv")
  const [pasteRaw,   setPasteRaw]   = useState("")
  const [pasteEdit,  setPasteEdit]  = useState(null)
  const [pasteSaving,setPasteSaving]= useState(false)

  async function handleSaveForm() {
    if (!form.priceWeek) return
    const comp = COMPETITORS.find(c=>c.id===form.competitorId)
    await onSaveRate({
      week_id:form.weekId, competitor_id:form.competitorId||null,
      source:form.source||comp?.source||"",
      property_name:comp?.name||form.source,
      property_type:comp?.property_type||form.type,
      capacity:parseInt(form.capacity)||capNum,
      price_week:parseFloat(form.priceWeek)||0,
      price_night:form.priceNight?parseFloat(form.priceNight):Math.round((parseFloat(form.priceWeek)||0)/7),
      original_price:form.originalPrice?parseFloat(form.originalPrice):null,
      promo_label:form.promoLabel||null, promo_percent:parseFloat(form.promoPercent)||0,
      cleaning_fee:parseFloat(form.cleaningFee)||0,
      url:form.url, collected_at:form.collectedAt, notes:form.notes,
      collection_type:"manuelle", reliability_status:"saisi manuellement", is_example:false,
    })
    setForm(emptyForm(form.weekId))
  }

  function handleParse() {
    if (!pasteRaw.trim()) return
    const ex = parsePastedPageText(pasteRaw, pasteSrc, pasteWk, pasteCap)
    setPasteEdit({ ...ex, competitorId:pasteComp, source:pasteSrc })
  }

  async function handleSavePaste() {
    if (!pasteEdit?.priceWeek) return
    setPasteSaving(true)
    const comp = COMPETITORS.find(c=>c.id===pasteEdit.competitorId)
    await onSaveRate({
      week_id:pasteWk, competitor_id:pasteEdit.competitorId||null,
      source:pasteEdit.source, property_name:comp?.name||pasteEdit.source,
      property_type:comp?.property_type||"particulier",
      capacity:parseInt(pasteEdit.detectedCap)||pasteCap,
      price_week:parseFloat(pasteEdit.priceWeek)||0,
      price_night:parseFloat(pasteEdit.priceNight)||Math.round((parseFloat(pasteEdit.priceWeek)||0)/7),
      original_price:pasteEdit.originalPrice?parseFloat(pasteEdit.originalPrice):null,
      promo_label:pasteEdit.promoLabel||null, promo_percent:parseFloat(pasteEdit.promoPercent)||0,
      cleaning_fee:parseFloat(pasteEdit.cleaningFee)||0,
      booking_rating:parseFloat(pasteEdit.rating)||null,
      collected_at:TODAY, collection_type:"copier-coller",
      reliability_status:"à vérifier", is_example:false,
      notes:`Extrait de ${pasteEdit.source} via copier-coller. Validé manuellement.`,
    })
    setPasteEdit(null); setPasteRaw(""); setPasteSaving(false)
  }

  if (mode==="menu") return (
    <div><SBar title="Saisie" user={user} sbReady={sbReady} onLogout={onLogout}/>
      <div style={styles.cnt}>
        <SaveFeedback status={formSaved} sbReady={sbReady}/>
        <p style={styles.sml}>Mode de saisie</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          {[
            { icon:"✏️", l:"Saisie manuelle", sub:"Formulaire complet",       m:"manual", border:C.blue   },
            { icon:"📋", l:"Copier-coller",   sub:"Depuis Booking / Airbnb",  m:"paste",  border:C.purple },
          ].map(item=>(
            <div key={item.m} style={{ ...styles.card(12,0), padding:"11px 13px", cursor:"pointer", border:`1.5px solid ${item.border}` }} onClick={()=>setMode(item.m)}>
              <p style={{ margin:"0 0 2px", fontSize:18 }}>{item.icon}</p>
              <p style={{ margin:"0 0 1px", fontSize:13, fontWeight:600, color:C.text }}>{item.l}</p>
              <p style={{ margin:0, fontSize:10, color:C.textS }}>{item.sub}</p>
            </div>
          ))}
        </div>
      </div>
      <BNav screen={screen} onNavigate={onNavigate}/>
    </div>
  )

  if (mode==="manual") return (
    <div><SBar title="Saisie manuelle" user={user} sbReady={sbReady} onLogout={onLogout}/>
      <div style={styles.cnt}>
        <button onClick={()=>setMode("menu")} style={{ background:"none", border:"none", cursor:"pointer", color:C.blue, fontSize:13, padding:"8px 0" }}>← Retour</button>
        <SaveFeedback status={formSaved} sbReady={sbReady}/>
        <p style={styles.sml}>Semaine</p>
        <select value={form.weekId} onChange={e=>setForm({...form,weekId:e.target.value})} style={{ ...styles.inp(), marginBottom:6 }}>
          {WEEKS_ALL.map(w=><option key={w.id} value={w.id}>{w.label} {w.year}</option>)}
        </select>
        <p style={styles.sml}>Concurrent *</p>
        <select value={form.competitorId} onChange={e=>{const c=COMPETITORS.find(x=>x.id===e.target.value);setForm({...form,competitorId:e.target.value,source:c?.source||"",type:c?.property_type||"résidence"})}} style={{ ...styles.inp(), marginBottom:6 }}>
          {COMPETITORS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
          <div><p style={styles.sml}>Source</p><input style={styles.inp()} placeholder="Booking…" value={form.source} onChange={e=>setForm({...form,source:e.target.value})}/></div>
          <div><p style={styles.sml}>Capacité</p><select value={form.capacity} onChange={e=>setForm({...form,capacity:parseInt(e.target.value)})} style={styles.inp()}>{[2,4,6,8].map(n=><option key={n} value={n}>{n} pers.</option>)}</select></div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
          <div><p style={styles.sml}>Prix / semaine € *</p><input type="number" style={styles.inp()} placeholder="650" value={form.priceWeek} onChange={e=>setForm({...form,priceWeek:e.target.value,priceNight:e.target.value?Math.round(parseFloat(e.target.value)/7):""})} /></div>
          <div><p style={styles.sml}>Prix barré €</p><input type="number" style={styles.inp()} placeholder="Optionnel" value={form.originalPrice} onChange={e=>setForm({...form,originalPrice:e.target.value})}/></div>
        </div>
        <p style={styles.sml}>Promotion</p>
        <select value={form.promoLabel} onChange={e=>setForm({...form,promoLabel:e.target.value})} style={{ ...styles.inp(), marginBottom:6 }}>
          {PROMOS.map(p=><option key={p} value={p}>{p||"Aucune"}</option>)}
        </select>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
          <div><p style={styles.sml}>Frais ménage €</p><input type="number" style={styles.inp()} placeholder="0" value={form.cleaningFee} onChange={e=>setForm({...form,cleaningFee:e.target.value})}/></div>
          <div><p style={styles.sml}>Date relevé *</p><input type="date" style={styles.inp()} value={form.collectedAt} onChange={e=>setForm({...form,collectedAt:e.target.value})}/></div>
        </div>
        <div><p style={styles.sml}>URL annonce</p><input style={{ ...styles.inp(), marginBottom:8 }} placeholder="https://…" value={form.url} onChange={e=>setForm({...form,url:e.target.value})}/></div>
        <button style={styles.btn(!form.priceWeek)} onClick={handleSaveForm} disabled={!form.priceWeek}>Enregistrer — saisie manuelle ✓</button>
        <p style={{ fontSize:9, color:C.gray, textAlign:"center" }}>Les anciens relevés ne sont jamais écrasés</p>
      </div>
      <BNav screen={screen} onNavigate={onNavigate}/>
    </div>
  )

  // mode === "paste"
  return (
    <div><SBar title="Copier-coller" user={user} sbReady={sbReady} onLogout={onLogout}/>
      <div style={styles.cnt}>
        <button onClick={()=>{setMode("menu");setPasteEdit(null);setPasteRaw("")}} style={{ background:"none", border:"none", cursor:"pointer", color:C.blue, fontSize:13, padding:"8px 0" }}>← Retour</button>
        <SaveFeedback status={formSaved} sbReady={sbReady}/>
        {!pasteEdit ? (
          <>
            <div style={{ ...styles.card(11), padding:"10px 13px", background:C.bluePale, marginBottom:8 }}>
              <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:C.blueL }}>Mode copier-coller</p>
              <p style={{ margin:0, fontSize:10, color:C.blueL, lineHeight:1.5 }}>1. Ouvre Booking/Airbnb dans ton navigateur<br/>2. Sélectionne tout le texte (Ctrl+A, Ctrl+C)<br/>3. Colle ici → extraction automatique<br/>4. Vérifie et valide avant enregistrement</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={styles.sml}>Source</p><select value={pasteSrc} onChange={e=>setPasteSrc(e.target.value)} style={styles.inp()}>{["Booking","Airbnb","Abritel","Vacancéole","Labellemontagne","Goélia","PAP"].map(s=><option key={s}>{s}</option>)}</select></div>
              <div><p style={styles.sml}>Semaine</p><select value={pasteWk} onChange={e=>setPasteWk(e.target.value)} style={styles.inp()}>{WEEKS_ALL.map(w=><option key={w.id} value={w.id}>{w.label?.slice(0,14)} {w.year}</option>)}</select></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={styles.sml}>Capacité</p><select value={pasteCap} onChange={e=>setPasteCap(parseInt(e.target.value))} style={styles.inp()}>{[2,4,6,8].map(n=><option key={n} value={n}>{n} pers.</option>)}</select></div>
              <div><p style={styles.sml}>Concurrent</p><select value={pasteComp} onChange={e=>setPasteComp(e.target.value)} style={styles.inp()}>{COMPETITORS.map(c=><option key={c.id} value={c.id}>{c.name.slice(0,22)}</option>)}</select></div>
            </div>
            <p style={styles.sml}>Texte collé</p>
            <textarea value={pasteRaw} onChange={e=>setPasteRaw(e.target.value)} placeholder="Colle ici le texte de la page Booking, Airbnb ou Abritel..." style={{ width:"100%", minHeight:110, padding:"9px", fontSize:11, border:`1px solid ${C.grayM}`, borderRadius:10, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
            <button style={styles.btn(!pasteRaw.trim(),C.purple)} onClick={handleParse} disabled={!pasteRaw.trim()}>🔍 Analyser le texte →</button>
          </>
        ) : (
          <>
            <div style={{ ...styles.card(11), padding:"10px 13px", background:pasteEdit.warning?C.orangeL:C.greenL, marginBottom:8 }}>
              <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:pasteEdit.warning?C.orange:C.green }}>{pasteEdit.warning?`⚠ ${pasteEdit.warning}`:"✓ Extraction réussie — vérifiez avant enregistrement"}</p>
              {pasteEdit.allPrices?.length>0&&<p style={{ margin:0, fontSize:10, color:C.textS }}>Prix détectés : {pasteEdit.allPrices.map(p=>`${p}€`).join(" · ")}</p>}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={styles.sml}>Prix / semaine € *</p><input type="number" style={styles.inp()} value={pasteEdit.priceWeek} onChange={e=>setPasteEdit({...pasteEdit,priceWeek:e.target.value,priceNight:Math.round(parseFloat(e.target.value||0)/7)})}/></div>
              <div><p style={styles.sml}>Prix / nuit €</p><input type="number" style={styles.inp()} value={pasteEdit.priceNight} onChange={e=>setPasteEdit({...pasteEdit,priceNight:e.target.value})}/></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={styles.sml}>Prix barré €</p><input type="number" style={styles.inp()} value={pasteEdit.originalPrice||""} onChange={e=>setPasteEdit({...pasteEdit,originalPrice:e.target.value})}/></div>
              <div><p style={styles.sml}>Frais ménage €</p><input type="number" style={styles.inp()} value={pasteEdit.cleaningFee||0} onChange={e=>setPasteEdit({...pasteEdit,cleaningFee:e.target.value})}/></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <div><p style={styles.sml}>Promotion</p><select value={pasteEdit.promoLabel||""} onChange={e=>setPasteEdit({...pasteEdit,promoLabel:e.target.value})} style={styles.inp()}><option value="">Aucune</option>{PROMOS.filter(Boolean).map(p=><option key={p} value={p}>{p}</option>)}</select></div>
              <div><p style={styles.sml}>Note (/10)</p><input type="number" step="0.1" min="0" max="10" style={styles.inp()} value={pasteEdit.rating||""} onChange={e=>setPasteEdit({...pasteEdit,rating:e.target.value})}/></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
              <div><p style={styles.sml}>Capacité</p><select value={pasteEdit.detectedCap||pasteCap} onChange={e=>setPasteEdit({...pasteEdit,detectedCap:parseInt(e.target.value)})} style={styles.inp()}>{[2,4,6,8].map(n=><option key={n} value={n}>{n} pers.</option>)}</select></div>
              <div><p style={styles.sml}>Concurrent</p><select value={pasteEdit.competitorId} onChange={e=>setPasteEdit({...pasteEdit,competitorId:e.target.value})} style={styles.inp()}>{COMPETITORS.map(c=><option key={c.id} value={c.id}>{c.name.slice(0,20)}</option>)}</select></div>
            </div>
            <button style={styles.btn(pasteSaving||!pasteEdit.priceWeek,C.blue)} onClick={handleSavePaste} disabled={pasteSaving||!pasteEdit.priceWeek}>{pasteSaving?"Enregistrement…":"Valider et enregistrer ✓"}</button>
            <button style={{ ...styles.btn(false,C.grayL,C.textS), marginTop:-2 }} onClick={()=>setPasteEdit(null)}>← Recommencer</button>
            <p style={{ fontSize:9, color:C.gray, textAlign:"center" }}>Statut : <strong>à vérifier</strong> · méthode : copier-coller</p>
          </>
        )}
      </div>
      <BNav screen={screen} onNavigate={onNavigate}/>
    </div>
  )
}


// ─── src/pages/ImportPage.jsx ────────────────────────────────────
import { useState, useRef } from "react"
import { SBar }   from "../components/layout/SBar"
import { BNav }   from "../components/layout/BNav"

const CSV_TPL = [
  "week_start;source;competitor_id;property_name;property_type;capacity;price_week;price_night;original_price;promo_label;promo_percent;cleaning_fee;url;collected_at;reliability_status",
  `2026-08-01;Booking;cv;Les Chalets du Verdon;résidence;6;620;89;680;Genius -10%;10;0;https://booking.com/xxx;${new Date().toISOString().slice(0,10)};réel`,
  `2026-08-01;Airbnb;;Appt La Foux;particulier;6;680;97;;;0;45;https://airbnb.fr/rooms/123;${new Date().toISOString().slice(0,10)};saisi manuellement`,
].join("\n")

export function ImportPage({ user, sbReady, onLogout, screen, onNavigate, imports, onImportCsv }) {
  const [csvText, setCsvText] = useState("")
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef()

  async function handle() {
    if (!csvText.trim()) return
    setLoading(true)
    const res = await onImportCsv(csvText)
    setResult(res)
    setLoading(false)
  }

  return (
    <div><SBar title="Import CSV" user={user} sbReady={sbReady} onLogout={onLogout}/>
      <div style={styles.cnt}>
        <div style={{ ...styles.card(11), padding:"10px 13px", background:C.bluePale, marginBottom:8 }}>
          <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:C.blueL }}>Colonnes attendues (séparateur ; ou ,)</p>
          <p style={{ margin:0, fontSize:9, color:C.blueL, fontFamily:"monospace", lineHeight:1.6 }}>week_start · source · competitor_id · property_name · property_type · capacity · price_week · price_night · original_price · promo_label · promo_percent · cleaning_fee · url · collected_at · reliability_status</p>
        </div>

        {result && (
          <div style={{ ...styles.card(10), padding:"10px 12px", background:result.errors?.length===0?C.greenL:C.goldL, marginBottom:8 }}>
            <p style={{ margin:"0 0 3px", fontSize:12, fontWeight:700, color:result.errors?.length===0?C.green:C.gold }}>Résultat de l'import</p>
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.green }}>✓ Importées : {result.imported}</p>
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.gold }}>⊘ Doublons ignorés : {result.duplicates}</p>
            <p style={{ margin:"0 0 1px", fontSize:11, color:C.gray }}>⊝ Ignorées : {result.skipped}</p>
            {result.noCompId>0&&<p style={{ margin:"0 0 1px", fontSize:11, color:C.orange }}>⚠ Sans competitor_id : {result.noCompId}</p>}
            {result.noName>0&&  <p style={{ margin:"0 0 1px", fontSize:11, color:C.orange }}>⚠ Sans property_name : {result.noName}</p>}
            {result.errors?.map((e,i)=><p key={i} style={{ margin:0, fontSize:10, color:C.red }}>✗ {e}</p>)}
          </div>
        )}

        <p style={styles.sml}>Coller le CSV</p>
        <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} placeholder={CSV_TPL}
          style={{ width:"100%", minHeight:100, padding:"8px", fontSize:10, fontFamily:"monospace", border:`1px solid ${C.grayM}`, borderRadius:9, background:C.grayL, color:C.text, resize:"vertical", boxSizing:"border-box", marginBottom:6 }}/>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setCsvText(ev.target.result);r.readAsText(f,"UTF-8")}} style={{ display:"none" }}/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
          <button onClick={()=>fileRef.current?.click()} style={{ ...styles.btn(false,C.grayL,C.text), margin:0 }}>📂 Fichier .CSV</button>
          <button onClick={()=>{const b=new Blob([CSV_TPL],{type:"text/csv;charset=utf-8"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download="template_benchmark_v2.csv";a.click()}} style={{ ...styles.btn(false,C.grayL,C.blueL), margin:0, border:`1px solid ${C.blueL}` }}>⬇ Modèle v2</button>
        </div>
        <button style={styles.btn(loading||!csvText.trim())} onClick={handle} disabled={loading||!csvText.trim()}>
          {loading?"Import en cours…":`Importer dans ${sbReady?"Supabase":"mémoire locale"} →`}
        </button>

        {imports?.length>0&&(<><p style={styles.sml}>Imports précédents</p>
          <div style={styles.card()}>{imports.slice(0,5).map((im,i)=>(
            <div key={im.id||i} style={styles.row(i===Math.min(imports.length,5)-1)}>
              <div>
                <p style={{ margin:0, fontSize:12, fontWeight:500, color:C.text }}>{im.import_source}</p>
                <p style={{ margin:0, fontSize:10, color:C.gray }}>{im.imported_at?.slice(0,10)} · {im.rows_imported} lignes</p>
              </div>
              <span style={{ fontSize:10, fontWeight:700, background:im.status==="ok"?C.greenL:C.orangeL, color:im.status==="ok"?C.green:C.orange, padding:"2px 7px", borderRadius:5 }}>{im.status?.toUpperCase()}</span>
            </div>
          ))}</div></>)}
        <p style={{ fontSize:9, color:C.gray, textAlign:"center", marginTop:6 }}>Historisation garantie — les relevés existants ne sont jamais écrasés.</p>
      </div>
      <BNav screen={screen} onNavigate={onNavigate}/>
    </div>
  )
}


// ─── src/pages/DiagnosticPage.jsx ───────────────────────────────
import { SBar }   from "../components/layout/SBar"
import { BNav }   from "../components/layout/BNav"
import { Badge }  from "../components/ui/Badge"
import { fmt, daysSince } from "../utils/formatters"

export function DiagnosticPage({ user, sbReady, onLogout, screen, onNavigate, rates, reco, selWeekId, cap, settings, showExamples, imports, lastImportStats, sbErrors }) {
  const qualified = rates.filter(r=>!r.is_example&&(r.comparability_score??50)>=settings.minScore)
  const excluded  = rates.filter(r=>!r.is_example&&(r.comparability_score??50)<settings.minScore)
  const oldRates  = rates.filter(r=>daysSince(r.collected_at)>settings.obsoleteDays)
  const noCompId  = rates.filter(r=>!r.is_example&&!r.competitor_id)
  const noName    = rates.filter(r=>!r.is_example&&!r.property_name)
  const lastImport= imports?.[0]
  const localTotal= Object.keys(localStorage).filter(k=>k.startsWith("rates_")).reduce((s,k)=>{try{return s+(JSON.parse(localStorage.getItem(k)||"[]").length)}catch{return s}},0)

  return (
    <div><SBar title="Diagnostic" user={user} sbReady={sbReady} onLogout={onLogout}/>
      <div style={styles.cnt}>
        <p style={{ margin:"8px 0 4px", fontSize:14, fontWeight:700, color:C.text }}>État du système</p>

        <p style={styles.sml}>Environnement</p>
        <div style={styles.card()}>
          {[
            { l:"Supabase configuré", v:sbReady?"Oui":"Non (mode démo)", c:sbReady?C.green:C.red },
            { l:"Mode stockage",      v:sbReady?"Supabase":"Local",       c:sbReady?C.green:C.gold },
            { l:"IA endpoint",        v:"/api/analyse-reco (Vercel)",     c:C.blue },
            { l:"RLS Supabase",       v:sbReady?"Actif":"N/A",            c:sbReady?C.green:C.gray },
            { l:"Session",            v:user?.email||"Non connecté",      c:user?C.green:C.red },
          ].map((r,i,arr)=>(
            <div key={r.l} style={styles.row(i===arr.length-1)}>
              <span style={{ fontSize:11, color:C.text }}>{r.l}</span>
              <span style={{ fontSize:10, fontWeight:600, color:r.c, maxWidth:200, textAlign:"right" }}>{r.v}</span>
            </div>
          ))}
        </div>

        <p style={styles.sml}>Relevés · {selWeekId} · {cap}</p>
        <div style={styles.card()}>
          {[
            { l:"Total chargés",                     v:rates.length,       c:rates.length>0?C.green:C.red },
            { l:`Qualifiés (score≥${settings.minScore})`, v:qualified.length, c:qualified.length>=3?C.green:qualified.length>0?C.orange:C.red },
            { l:`Exclus (score<${settings.minScore})`,    v:excluded.length,  c:excluded.length===0?C.green:C.orange },
            { l:"Sans competitor_id",                v:noCompId.length,    c:noCompId.length===0?C.green:C.orange },
            { l:"Sans property_name",                v:noName.length,      c:noName.length===0?C.green:C.orange },
            { l:`Obsolètes (>${settings.obsoleteDays}j)`, v:oldRates.length, c:oldRates.length===0?C.green:C.orange },
            { l:"Exemples actifs",                   v:rates.filter(r=>r.is_example).length, c:C.gold },
            { l:"Stockés localement (toutes sem.)",  v:localTotal,         c:localTotal>0?C.blue:C.gray },
          ].map((r,i,arr)=>(
            <div key={r.l} style={styles.row(i===arr.length-1)}>
              <span style={{ fontSize:11, color:C.text }}>{r.l}</span>
              <Badge label={String(r.v)} color={r.c} bg={r.c+"22"} size={11}/>
            </div>
          ))}
        </div>

        <p style={styles.sml}>Recommandation courante</p>
        <div style={styles.card()}>
          {[
            { l:"Action",       v:reco.action,  c:{normal:C.green,moyen:C.orange,haut:C.red,urgent:C.red}[reco.urgency]||C.gray },
            { l:"Confiance",    v:`${reco.confidence} (${reco.confScore}/100)`, c:{fort:C.green,moyen:C.orange,faible:C.red}[reco.confidence] },
            { l:"Médiane stat.",v:reco.ref?`${fmt(reco.ref)}€/sem`:"—", c:reco.ref?C.blue:C.gray },
            { l:"Données obso.",v:reco.hasOld?"Oui":"Non", c:reco.hasOld?C.orange:C.green },
          ].map((r,i,arr)=>(
            <div key={r.l} style={styles.row(i===arr.length-1)}>
              <span style={{ fontSize:11, color:C.text }}>{r.l}</span>
              <span style={{ fontSize:11, fontWeight:600, color:r.c }}>{r.v}</span>
            </div>
          ))}
        </div>

        {lastImport&&(<><p style={styles.sml}>Dernier import</p>
          <div style={{ ...styles.card(11), padding:"10px 13px" }}>
            <p style={{ margin:"0 0 2px", fontSize:12, fontWeight:500, color:C.text }}>{lastImport.import_source} · {lastImport.imported_at?.slice(0,10)}</p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              <Badge label={`✓ ${lastImport.rows_imported}`}    color={C.green}  bg={C.greenL}/>
              <Badge label={`⊘ ${lastImport.rows_duplicate||0} doublons`} color={C.gold} bg={C.goldL}/>
              <Badge label={`✗ ${lastImport.rows_error||0} erreurs`} color={lastImport.rows_error>0?C.red:C.gray} bg={lastImport.rows_error>0?C.redL:C.grayL}/>
            </div>
            {lastImportStats&&<div style={{ marginTop:6, display:"flex", gap:6, flexWrap:"wrap" }}>
              <Badge label={`Sans competitor_id : ${lastImportStats.noCompId}`} color={lastImportStats.noCompId>0?C.orange:C.green} bg={lastImportStats.noCompId>0?C.orangeL:C.greenL}/>
              <Badge label={`Sans property_name : ${lastImportStats.noName}`}   color={lastImportStats.noName>0?C.orange:C.green}   bg={lastImportStats.noName>0?C.orangeL:C.greenL}/>
            </div>}
          </div></>)}

        {sbErrors?.length>0&&(<><p style={styles.sml}>Erreurs Supabase</p>
          <div style={styles.card()}>{sbErrors.slice(-3).reverse().map((e,i,arr)=>(
            <div key={i} style={styles.row(i===arr.length-1)}>
              <div><p style={{ margin:0, fontSize:11, fontWeight:500, color:C.red }}>{e.path}</p><p style={{ margin:0, fontSize:10, color:C.textS }}>{e.ts?.slice(11,19)} — {e.msg?.slice(0,60)}</p></div>
            </div>
          ))}</div></>)}

        <p style={styles.sml}>Checklist production</p>
        <div style={styles.card()}>
          {[
            { l:"VITE_SUPABASE_URL configuré",        ok:sbReady },
            { l:"Mode Supabase actif",                 ok:sbReady },
            { l:"Données exemple désactivées",         ok:!showExamples },
            { l:"≥3 relevés qualifiés",                ok:qualified.length>=3 },
            { l:"Aucun relevé obsolète",               ok:oldRates.length===0 },
            { l:"Tous relevés ont property_name",      ok:noName.length===0 },
            { l:"Route /api/analyse-reco déployée",    ok:false, note:"Déployer api/analyse-reco.js sur Vercel" },
          ].map((c,i,arr)=>(
            <div key={c.l} style={styles.row(i===arr.length-1)}>
              <div><span style={{ fontSize:11, color:C.text }}>{c.l}</span>{c.note&&<p style={{ margin:"1px 0 0", fontSize:9, color:C.gray }}>{c.note}</p>}</div>
              <Badge label={c.ok?"✓ OK":"✗ NON"} color={c.ok?C.green:C.red} bg={c.ok?C.greenL:C.redL}/>
            </div>
          ))}
        </div>
      </div>
      <BNav screen={screen} onNavigate={onNavigate}/>
    </div>
  )
}

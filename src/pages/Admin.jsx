// ══════════════════════════════════════════════════════════════════
// src/pages/Admin.jsx
// Page Admin / Debug (Diagnostic système). Lecture seule.
// Reçoit l'état système + helpers en props.
// ══════════════════════════════════════════════════════════════════
import { C } from "../components/theme.js";
import Badge from "../components/Badge.jsx";

export default function Admin({
  rates, settings, imports, reco, user, selWeekId, cap,
  ourRates, currentOurRate, ourRateSource, showExamples, sbErrors, SB_READY,
  fmt, daysSince, styles, SBar, BNav,
}) {
  const { cnt, cd, sml, rw } = styles;
    const qualified=rates.filter(r=>!r.is_example&&(r.comparability_score??50)>=settings.minScore);
    const excluded=rates.filter(r=>!r.is_example&&(r.comparability_score??50)<settings.minScore);
    const oldRates=rates.filter(r=>daysSince(r.collected_at)>settings.obsoleteDays);
    const noCompId=rates.filter(r=>!r.is_example&&!r.competitor_id);
    const lastImport=imports[0];
    const localKeys=Object.keys(localStorage).filter(k=>k.startsWith("rates_"));
    const totalLocal=localKeys.reduce((s,k)=>s+(ls.get(k).length),0);
    return (
      <div><SBar title="Diagnostic"/>
        <div style={cnt}>
          <p style={{ margin:"8px 0 4px", fontSize:14, fontWeight:700, color:C.text }}>État du système</p>
          <p style={sml}>Environnement</p>
          <div style={cd()}>
            {[{ l:"Supabase URL", v:SB_READY?"Oui":"Non (démo)", c:SB_READY?C.green:C.red },{ l:"Mode stockage", v:SB_READY?"Supabase":"Local", c:SB_READY?C.green:C.gold },{ l:"Session", v:user?.email||"Non connecté", c:user?C.green:C.red },{ l:"Token persistant", v:sessionStorage.getItem("sb_token")?"Oui":"Non", c:sessionStorage.getItem("sb_token")?C.green:C.gray }].map((r,i,arr)=>(
              <div key={r.l} style={rw(i===arr.length-1)}><span style={{ fontSize:11, color:C.text }}>{r.l}</span><span style={{ fontSize:10, fontWeight:600, color:r.c }}>{r.v}</span></div>
            ))}
          </div>
          <p style={sml}>Relevés · {selWeekId} · {cap}</p>
          <div style={cd()}>
            {[{ l:"Total chargés", v:rates.length, c:rates.length>0?C.green:C.red },{ l:`Qualifiés (≥${settings.minScore})`, v:qualified.length, c:qualified.length>=3?C.green:qualified.length>0?C.orange:C.red },{ l:"Exclus", v:excluded.length, c:excluded.length===0?C.green:C.orange },{ l:"Sans competitor_id", v:noCompId.length, c:noCompId.length===0?C.green:C.orange },{ l:`Obsolètes (>${settings.obsoleteDays}j)`, v:oldRates.length, c:oldRates.length===0?C.green:C.orange },{ l:"Stockés localement", v:totalLocal, c:totalLocal>0?C.blue:C.gray }].map((r,i,arr)=>(
              <div key={r.l} style={rw(i===arr.length-1)}><span style={{ fontSize:11, color:C.text }}>{r.l}</span><Badge label={String(r.v)} color={r.c} bg={r.c+"22"} size={11}/></div>
            ))}
          </div>
          <p style={sml}>Recommandation courante</p>
          <div style={cd()}>
            {[{ l:"Action", v:reco.action, c:reco.urgency==="normal"?C.green:reco.urgency==="haut"?C.red:C.orange },{ l:"Confiance", v:`${reco.confidence} (${reco.confScore}/100)`, c:{fort:C.green,moyen:C.orange,faible:C.red}[reco.confidence] },{ l:"Médiane", v:reco.ref?`${fmt(reco.ref)}€/sem`:"—", c:reco.ref?C.blue:C.gray },{ l:"Données obsolètes", v:reco.hasOld?"Oui":"Non", c:reco.hasOld?C.orange:C.green }].map((r,i,arr)=>(
              <div key={r.l} style={rw(i===arr.length-1)}><span style={{ fontSize:11, color:C.text }}>{r.l}</span><span style={{ fontSize:11, fontWeight:600, color:r.c }}>{r.v}</span></div>
            ))}
          </div>
          {lastImport&&(<><p style={sml}>Dernier import</p><div style={{ ...cd(11), padding:"10px 13px" }}><p style={{ margin:"0 0 2px", fontSize:12, fontWeight:500, color:C.text }}>{lastImport.import_source} · {lastImport.imported_at?.slice(0,10)}</p><div style={{ display:"flex", gap:8 }}><Badge label={`✓ ${lastImport.rows_imported}`} color={C.green} bg={C.greenL}/><Badge label={`⊘ ${lastImport.rows_duplicate||0}`} color={C.gold} bg={C.goldL}/></div></div></>)}
          {sbErrors.length>0&&(<><p style={sml}>Erreurs Supabase</p><div style={cd()}>{sbErrors.slice(-3).reverse().map((e,i,arr)=><div key={i} style={rw(i===arr.length-1)}><div style={{ minWidth:0 }}><p style={{ margin:0, fontSize:11, color:C.red }}>{e.path}</p><p style={{ margin:0, fontSize:10, color:C.textS, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{e.ts?.slice(11,19)} — {e.msg?.slice(0,300)}</p></div></div>)}</div></>)}
          <p style={sml}>Tarifs Les Cimes</p>
          <div style={cd()}>
            {[
              { l:"Tarifs Supabase (total)", v:String(ourRates.length), c:ourRates.length>0?C.green:C.gray },
              { l:"Tarif courant trouvé", v:currentOurRate?"Oui":"Non", c:currentOurRate?C.green:C.orange },
              { l:"Source tarif courant", v:ourRateSource, c:currentOurRate?C.green:C.gold },
              { l:"Dernière maj courante", v:currentOurRate?.updated_at?currentOurRate.updated_at.slice(0,10):"—", c:C.gray },
            ].map((r,i,arr)=>(
              <div key={r.l} style={rw(i===arr.length-1)}><span style={{ fontSize:11, color:C.text }}>{r.l}</span><span style={{ fontSize:11, fontWeight:600, color:r.c }}>{r.v}</span></div>
            ))}
          </div>
          <p style={sml}>Checklist production</p>
          <div style={cd()}>
            {[{ l:"VITE_SUPABASE_URL configuré", ok:SB_READY },{ l:"Mode Supabase actif", ok:SB_READY },{ l:"Session persistante", ok:!!sessionStorage.getItem("sb_token") },{ l:"Données exemple désactivées", ok:!showExamples },{ l:"≥3 relevés qualifiés", ok:qualified.length>=3 },{ l:"/api/analyse-reco déployée", ok:false, note:"Déployer avec ANTHROPIC_API_KEY." },{ l:"/api/scrape-market déployée", ok:false, note:"Voir api/scrape-market.js" },{ l:"/api/scrape-market-batch déployée", ok:false, note:"Voir api/scrape-market-batch.js" }].map((c,i,arr)=>(
              <div key={c.l} style={rw(i===arr.length-1)}><div><span style={{ fontSize:11, color:C.text }}>{c.l}</span>{c.note&&<p style={{ margin:"1px 0 0", fontSize:12, color:C.gray }}>{c.note}</p>}</div><Badge label={c.ok?"✓ OK":"✗ NON"} color={c.ok?C.green:C.red} bg={c.ok?C.greenL:C.redL}/></div>
            ))}
          </div>
        </div><BNav/>
      </div>
    );

}

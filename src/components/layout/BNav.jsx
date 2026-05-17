import { C } from '../../utils/colors'
const ITEMS = [{id:'dashboard',icon:'▣',l:'Dashboard'},{id:'weeks',icon:'📅',l:'Semaines'},{id:'collect',icon:'✏️',l:'Saisie'},{id:'import',icon:'📥',l:'Import'},{id:'diag',icon:'🔬',l:'Diagnostic'}]
export function BNav({ screen, onNavigate }) {
  return (
    <div style={{ position:'sticky', bottom:0, background:'#FFF', borderTop:'0.5px solid #E5E7EB', display:'flex', padding:'6px 0 16px', zIndex:10 }}>
      {ITEMS.map(n=>(
        <button key={n.id} onClick={()=>onNavigate(n.id)} style={{ flex:1, background:'none', border:'none', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
          <span style={{ fontSize:16 }}>{n.icon}</span>
          <span style={{ fontSize:9, fontWeight:screen===n.id?700:400, color:screen===n.id?C.blue:C.gray }}>{n.l}</span>
        </button>
      ))}
    </div>
  )
}
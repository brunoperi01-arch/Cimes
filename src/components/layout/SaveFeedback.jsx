import { C }     from '../../utils/colors'
import { styles } from '../../utils/styles'
const FB = {
  ok:        {bg:C.greenL, c:C.green,  msg:s=>`✓ Enregistré dans ${s?'Supabase':'mémoire locale'}`},
  duplicate: {bg:C.goldL,  c:C.gold,   msg:()=>'⚠ Doublon — relevé déjà existant pour cette date et ce concurrent'},
  error:     {bg:C.redL,   c:C.red,    msg:()=>'✗ Erreur d\'enregistrement'},
}
export function SaveFeedback({ status, sbReady }) {
  if (!status) return null
  const f=FB[status]
  return <div style={{ ...styles.card(9), padding:'9px 12px', background:f.bg, marginBottom:6 }}><p style={{ margin:0, fontSize:12, fontWeight:700, color:f.c }}>{f.msg(sbReady)}</p></div>
}
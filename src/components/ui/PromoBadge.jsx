import { C } from '../../utils/colors'
const MAP   = { 'Genius -10%':{bg:'#DBEAFE',c:'#1D40AE'},'Last minute':{bg:C.redL,c:C.red},'Early booking':{bg:C.greenL,c:C.green},'PDJ inclus':{bg:C.purpleL,c:C.purple},'Annulation gratuite':{bg:C.greenL,c:C.green} }
const SHORT = { 'Genius -10%':'GENIUS','Last minute':'LAST MIN','Early booking':'EARLY','PDJ inclus':'PDJ','Annulation gratuite':'ANNUL.' }
export function PromoBadge({ label }) {
  if (!label) return null
  const m=MAP[label]||{bg:C.orangeL,c:C.orange}
  return <span style={{ fontSize:9, fontWeight:700, background:m.bg, color:m.c, padding:'2px 5px', borderRadius:4 }}>{SHORT[label]||label.slice(0,12)}</span>
}
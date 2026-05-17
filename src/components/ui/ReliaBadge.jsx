import { C } from '../../utils/colors'
const MAP = {
  'réel':              {bg:C.greenL,   c:C.green},
  'saisi manuellement':{bg:C.bluePale, c:C.blue},
  'importé CSV':       {bg:C.purpleL,  c:C.purple},
  'copier-coller':     {bg:'#F3E8FF',  c:C.purple},
  'à vérifier':        {bg:C.goldL,    c:C.orange},
  'estimé':            {bg:C.goldL,    c:C.gold},
}
export function ReliaBadge({ status }) {
  const m = MAP[status] || {bg:C.grayL, c:C.gray}
  return <span style={{ fontSize:9, fontWeight:600, background:m.bg, color:m.c, padding:'1px 5px', borderRadius:4 }}>{status}</span>
}
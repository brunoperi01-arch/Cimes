import { C }     from '../../utils/colors'
import { styles } from '../../utils/styles'
import { Badge }  from '../ui/Badge'
export function SBar({ title, user, sbReady, onLogout }) {
  return (
    <div style={styles.sbar}>
      <span style={{ fontSize:13, fontWeight:600, color:C.text }}>{title||'Benchmark Été'}</span>
      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
        {user && <button onClick={onLogout} style={{ fontSize:10, color:C.gray, background:'none', border:'none', cursor:'pointer' }}>Déco.</button>}
        <Badge label={sbReady?'SUPABASE ✓':'LOCAL'} color={sbReady?C.green:C.gold} bg={sbReady?C.greenL:C.goldL} size={9}/>
      </div>
    </div>
  )
}
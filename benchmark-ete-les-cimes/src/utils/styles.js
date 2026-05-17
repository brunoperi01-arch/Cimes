import { C } from './colors'

export const styles = {
  cnt:    { padding: '0 14px 80px' },
  sbar:   { height: 46, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 20px 6px', background: C.grayL },
  sml:    { fontSize: 10, fontWeight: 700, color: C.gray, margin: '12px 2px 5px', letterSpacing: '.06em', textTransform: 'uppercase' },
  card:   (r=14, mb=8)  => ({ background: C.white, borderRadius: r, overflow: 'hidden', marginBottom: mb }),
  row:    (last=false)  => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 13px', borderBottom: last ? 'none' : `0.5px solid ${C.grayL}` }),
  btn:    (dis, bg=C.blue, fg=C.white) => ({ width: '100%', padding: '12px', fontSize: 14, fontWeight: 600, background: dis ? '#C7C7CC' : bg, color: fg, border: 'none', borderRadius: 11, cursor: dis ? 'not-allowed' : 'pointer', marginBottom: 6 }),
  inp:    (extra={})    => ({ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${C.grayM}`, borderRadius: 9, background: C.white, color: C.text, boxSizing: 'border-box', ...extra }),
  tabBtn: (active)      => ({ flex: 1, padding: '8px 2px', fontSize: 11, fontWeight: active ? 700 : 400, background: active ? C.white : 'transparent', color: active ? C.blue : C.gray, border: 'none', borderRadius: 8, cursor: 'pointer' }),
}
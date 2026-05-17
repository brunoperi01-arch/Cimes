export function Badge({ label, color, bg, size=10 }) {
  return <span style={{ fontSize:size, fontWeight:700, background:bg, color, padding:'2px 6px', borderRadius:4, whiteSpace:'nowrap' }}>{label}</span>
}
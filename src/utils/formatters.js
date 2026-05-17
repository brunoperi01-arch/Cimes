export const fmt       = n  => typeof n === 'number' ? n.toLocaleString('fr-FR') : '—'
export const fmtPct    = n  => (n >= 0 ? '+' : '') + Math.round(n) + '%'
export const daysSince = d  => d ? Math.floor((Date.now() - new Date(d)) / 864e5) : 999
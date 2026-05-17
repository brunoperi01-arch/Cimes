function buildWeeks(year) {
  const mns  = ['jan','fév','mar','avr','mai','juin','juil','août','sept','oct','nov','déc']
  const evts = {
    [`${year}-07-11`]:'Vac. zone A', [`${year}-07-14`]:'Fête Nationale',
    [`${year}-07-18`]:'Vac. B/C',   [`${year}-08-15`]:'Assomption',
    [`${year}-09-05`]:'Rentrée',
  }
  let d = new Date(year, 5, 20)
  while (d.getDay() !== 6) d = new Date(d.getTime()+864e5)
  const res=[]; let wn=1
  while (d < new Date(year, 8, 13)) {
    const e=new Date(d.getTime()+6*864e5), m=d.getMonth()
    const fmt = dt => `${dt.getDate()} ${mns[dt.getMonth()]}`
    const key = `${year}-${String(m+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    let cat='basse'
    if      (m===7)                  cat='haute'
    else if (m===6&&d.getDate()>=11) cat='haute'
    else if (m===6)                  cat='moyenne'
    else if (m===5&&d.getDate()>=27) cat='moyenne'
    res.push({
      id:`${year}_w${wn}`, year, week_number:wn,
      week_start:d.toISOString().slice(0,10), week_end:e.toISOString().slice(0,10),
      label:`${fmt(d)} → ${fmt(e)}`,
      month_label:['Juin','Juillet','Août','Septembre'][m-5]||'',
      season_type:cat, event_label:evts[key]||null,
    })
    d=new Date(d.getTime()+7*864e5); wn++
  }
  return res
}
export const WEEKS_2026 = buildWeeks(2026)
export const WEEKS_2027 = buildWeeks(2027)
export const WEEKS_ALL  = [...WEEKS_2026, ...WEEKS_2027]
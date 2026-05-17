// La clé Anthropic reste UNIQUEMENT côté serveur (api/analyse-reco.js)
export async function fetchIaAnalysis(payload) {
  const res = await fetch('/api/analyse-reco', {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload),
  })
  if (!res.ok) { const err=await res.json().catch(()=>({})); throw new Error(err.error||`Erreur serveur ${res.status}`) }
  return res.json() // { parts: string[] }
}
# Benchmark Été — Les Cimes du Val d'Allos

Application de veille tarifaire pour la résidence Les Cimes du Val d'Allos, La Foux d'Allos.

## Installation

```bash
npm install
cp .env.example .env.local
# Remplir VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
npm run dev
```

## Supabase

Exécuter `supabase/schema.sql` dans Supabase SQL Editor.

## Déploiement Vercel

```bash
vercel deploy
```

Ajouter les variables d'environnement dans Vercel :
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `ANTHROPIC_API_KEY` (côté serveur uniquement)

## Pages manquantes à compléter

Les fichiers `src/pages/` (LoginPage, DashboardPage, WeeksPage, WeekDetailPage, CollectPage, ImportPage, DiagnosticPage)
sont disponibles dans l'artifact "src/pages/" de la session Claude.

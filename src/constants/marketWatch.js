// ══════════════════════════════════════════════════════════════════
// src/constants/marketWatch.js
// Source unique des stations et opérateurs surveillés pour la veille
// des promotions marché montagne (module "Tendance promos").
// Ajouter / désactiver une station ou un opérateur se fait UNIQUEMENT ici.
// ══════════════════════════════════════════════════════════════════

export const STATIONS = [
  { id: "la_foux_dallos",     name: "La Foux d'Allos",    active: true },
  { id: "pra_loup",           name: "Pra Loup",            active: true },
  { id: "les_orres",          name: "Les Orres",           active: true },
  { id: "orcieres_merlette",  name: "Orcières-Merlette",   active: true },
  { id: "vars",               name: "Vars",                active: true },
  { id: "risoul",             name: "Risoul",              active: true },
  { id: "serre_chevalier",    name: "Serre Chevalier",     active: true },
];

export const OPERATORS = [
  { id: "maeva",             name: "Maeva",                    category: "operateur", active: true },
  { id: "vacanceole",        name: "Vacancéole",               category: "operateur", active: true },
  { id: "odalys",            name: "Odalys",                   category: "operateur", active: true },
  { id: "goelia",            name: "Goélia",                   category: "operateur", active: true },
  { id: "mmv",               name: "MMV",                      category: "operateur", active: true },
  { id: "belambra",          name: "Belambra",                 category: "operateur", active: true },
  { id: "montagne_vacances", name: "Montagne-Vacances",        category: "operateur", active: true },
  { id: "ski_planet",        name: "Ski-Planet",               category: "operateur", active: true },
  { id: "site_officiel",     name: "Site officiel de la station", category: "officiel", active: true },
  { id: "labellemontagne",   name: "Labellemontagne",          category: "operateur", active: true },
];

export const activeStations  = () => STATIONS.filter(s => s.active).map(s => s.name);
export const activeOperators = () => OPERATORS.filter(o => o.active).map(o => o.name);

export const stationByName  = name => STATIONS.find(s => s.name === name);
export const operatorByName = name => OPERATORS.find(o => o.name === name);

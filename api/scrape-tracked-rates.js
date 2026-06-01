// api/scrape-tracked-rates.js
// Scraping ciblé et PRUDENT des concurrents suivis.
// Ne valide jamais automatiquement : renvoie des prix "à vérifier" pour prévalidation côté UI.
// Chaque résultat porte un objet debug pour diagnostic.

const MAX_COMPETITORS = 5;
const FETCH_TIMEOUT_MS = 12000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function isOwnProperty(name) {
  const n = String(name || "").toLowerCase();
  return (
    n.includes("les cimes du val d'allos") ||
    n.includes("résidence les cimes") ||
    n.includes("residence les cimes")
  );
}

// ── Helpers URL ─────────────────────────────────────────────────
function normalizeBookingBaseUrl(rawUrl) {
  if (!rawUrl) return "https://www.booking.com/searchresults.html";
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("booking.com")) return rawUrl;
    return `${url.origin}${url.pathname}`;
  } catch {
    return "https://www.booking.com/searchresults.html";
  }
}
function buildBookingUrl(baseUrl, ctx) {
  const url = new URL(normalizeBookingBaseUrl(baseUrl));
  url.searchParams.set("checkin", ctx.checkin);
  url.searchParams.set("checkout", ctx.checkout);
  url.searchParams.set("group_adults", String(ctx.capacity));
  url.searchParams.set("req_adults", String(ctx.capacity));
  url.searchParams.set("group_children", "0");
  url.searchParams.set("req_children", "0");
  url.searchParams.set("no_rooms", "1");
  url.searchParams.set("sb_price_type", "total");
  return url.toString();
}
// La France du Nord au Sud : injecte les dates et la capacité
function buildLfdnasUrl(baseUrl, ctx) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("date_debut", ctx.checkin);
    url.searchParams.set("date_fin", ctx.checkout);
    url.searchParams.set("nbPax", String(ctx.capacity));
    url.searchParams.set("adultePax", String(ctx.capacity));
    url.searchParams.set("enfantPax", "0");
    url.searchParams.set("babiePax", "0");
    if (!url.searchParams.get("ordreSeo")) url.searchParams.set("ordreSeo", "prixAsc");
    return url.toString();
  } catch {
    return baseUrl;
  }
}

// ── Détection du type de source ─────────────────────────────────
function detectSourceKind(source, finalUrl = "") {
  const name = String(source?.source_name || "").toLowerCase();
  const type = String(source?.source_type || "").toLowerCase();
  const rawUrl = String(source?.source_url || "").toLowerCase();
  const url = String(finalUrl || "").toLowerCase();
  if (type === "booking" || name.includes("booking") || rawUrl.includes("booking.com") || url.includes("booking.com")) return "booking";
  if (name.includes("france du nord") || rawUrl.includes("lafrancedunordausud.fr") || url.includes("lafrancedunordausud.fr")) return "lfdnas";
  if (name.includes("maeva") || rawUrl.includes("maeva.com") || url.includes("maeva.com")) return "maeva";
  if (type === "direct") return "direct";
  return "generic";
}

// ── Récupération du HTML (Browserless optionnel) ────────────────
async function fetchHtml(url) {
  const key = process.env.BROWSERLESS_API_KEY;
  let mode = "fetch_simple";
  if (key) {
    mode = "browserless";
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS + 8000);
      const r = await fetch(`https://chrome.browserless.io/content?token=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, gotoOptions: { waitUntil: "networkidle2", timeout: 15000 } }),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (r.ok) return { html: await r.text(), status: r.status, finalUrl: url, mode };
    } catch {
      /* on retombe sur fetch simple */
    }
  }
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const html = r.ok ? await r.text() : null;
    return { html, status: r.status, finalUrl: r.url || url, mode };
  } catch (e) {
    clearTimeout(to);
    return { html: null, status: 0, finalUrl: url, mode, error: e.message };
  }
}

// ── Parsing des montants ────────────────────────────────────────
function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&euro;/g, "€")
    .replace(/\s+/g, " ");
}
function cleanNumber(raw) {
  let cleaned = String(raw || "").replace(/\s/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  else if (cleaned.includes(",")) cleaned = /,\d{2}$/.test(cleaned) ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  else if ((cleaned.match(/\./g) || []).length > 1) cleaned = cleaned.replace(/\./g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : Math.round(val);
}
function parsePrices(text) {
  const re = /(?:€|EUR)\s?([\d\s.,]{2,8})|([\d\s.,]{2,8})\s?(?:€|EUR)/gi;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const val = cleanNumber(m[1] || m[2] || "");
    if (val != null && val >= 50 && val <= 10000) out.push(val);
  }
  return out;
}
// Montants proches d'un mot-clé "total/séjour/taxes comprises" (fenêtre de texte)
function pricesNearKeywords(text, keywords) {
  const lower = text.toLowerCase();
  const found = [];
  for (const kw of keywords) {
    let idx = 0;
    while ((idx = lower.indexOf(kw, idx)) !== -1) {
      const window = text.slice(Math.max(0, idx - 40), idx + 80);
      found.push(...parsePrices(window));
      idx += kw.length;
    }
  }
  return found;
}
// Montants dans les blocs JSON (script) contenant price / gross_amount
function pricesFromJson(html) {
  const out = [];
  const re = /"(?:gross_amount|grossAmount|price|amount|total_price|totalPrice|value)"\s*:\s*"?([\d.,]{2,9})"?/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) {
    const val = cleanNumber(m[1]);
    if (val != null && val >= 50 && val <= 10000) out.push(val);
  }
  return out;
}
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
function mostFrequent(arr) {
  const count = {};
  let best = null, bestN = 0;
  for (const v of arr) { count[v] = (count[v] || 0) + 1; if (count[v] > bestN) { bestN = count[v]; best = v; } }
  return bestN >= 2 ? best : null;
}
// Seuil plancher de plausibilité selon durée/capacité
function minPlausible(ctx) {
  const nights = Number(ctx.stayNights || 7);
  const cap = Number(ctx.capacity || 2);
  if (nights >= 7) return cap >= 6 ? 500 : 400;
  if (nights >= 3) return 200;
  if (nights >= 2) return 80;
  return 50;
}

// ── Extracteurs par source ──────────────────────────────────────
// Booking : la page est souvent dynamique (HTTP 202 / HTML court) → manuel
function extractBookingPrice(html, ctx, meta = {}) {
  const text = stripTags(html);
  const floor = minPlausible(ctx);
  const jsonPrices = pricesFromJson(html).filter((p) => p >= floor);
  const kwPrices = pricesNearKeywords(text, ["total", "séjour", "sejour", "taxes comprises", "pour", "nuits"]).filter((p) => p >= floor);
  const candidates = Array.from(new Set(jsonPrices.length ? jsonPrices : kwPrices));
  const shortOrBlocked = (meta.status === 202) || (Number(meta.html_length || html.length) < 10000);
  // Page courte/dynamique et aucun prix fiable → manuel
  if (!candidates.length) {
    const reason = shortOrBlocked
      ? "Booking retourne une page courte ou dynamique. Scraping simple insuffisant."
      : "Prix Booking non détecté. Page probablement dynamique ou bloquée.";
    return {
      price_total: null, price_candidates: [], confidence: "low",
      warning: "Booking : prix non détecté automatiquement. Ouvrir et vérifier manuellement.",
      debug: { detection_method: "booking", prices_found: [], selected_price: null, failure_reason: reason, floor },
    };
  }
  // Candidats distincts, jamais de moyenne
  const price_candidates = candidates.slice(0, 6).map((p, i) => ({ price_total: p, price_night: Math.round(p / (Number(ctx.stayNights || 7))), label: `Offre détectée ${i + 1}`, confidence: "medium" }));
  const single = price_candidates.length === 1;
  return {
    price_total: single ? price_candidates[0].price_total : null,
    price_candidates,
    confidence: "medium",
    warning: single ? "Prix détecté à vérifier." : "Plusieurs prix détectés. Sélectionnez le prix vérifié.",
    debug: { detection_method: "booking", prices_found: candidates.slice(0, 12), selected_price: single ? price_candidates[0].price_total : null, floor },
  };
}
// La France du Nord au Sud : JAMAIS de moyenne — renvoie des candidats distincts
function extractLfdnasPrice(html, ctx) {
  const text = stripTags(html);
  const floor = minPlausible(ctx);
  const kwPrices = pricesNearKeywords(text, ["prix", "total", "séjour", "sejour", "réserver", "reserver", "disponible", "à partir"]).filter((p) => p >= floor);
  const jsonPrices = pricesFromJson(html).filter((p) => p >= floor);
  const candidates = Array.from(new Set(kwPrices.length ? kwPrices : jsonPrices)).sort((a, b) => a - b);
  const debug = { detection_method: kwPrices.length ? "lfdnas" : (jsonPrices.length ? "json" : "none"), prices_found: candidates.slice(0, 12), floor };
  if (!candidates.length) {
    return { price_total: null, price_candidates: [], confidence: "low", warning: "Prix TO non détecté automatiquement. Vérification manuelle nécessaire.", debug: { ...debug, selected_price: null, failure_reason: "Aucun prix plausible proche d'un mot-clé prix." } };
  }
  const price_candidates = candidates.slice(0, 6).map((p, i) => ({ price_total: p, price_night: Math.round(p / (Number(ctx.stayNights || 7))), label: `Offre détectée ${i + 1}`, confidence: "medium" }));
  const single = price_candidates.length === 1;
  return {
    // Si plusieurs candidats : pas de prix auto (pas de moyenne) ; un seul → proposé à vérifier
    price_total: single ? price_candidates[0].price_total : null,
    price_candidates,
    confidence: "medium",
    warning: single ? "Prix détecté à vérifier." : "Plusieurs prix détectés. Sélectionnez le prix vérifié.",
    debug: { ...debug, selected_price: single ? price_candidates[0].price_total : null },
  };
}
function extractMaevaPrice(html, ctx) {
  const text = stripTags(html);
  const floor = minPlausible(ctx);
  const kwPrices = pricesNearKeywords(text, ["prix", "total", "séjour", "sejour", "à partir"]).filter((p) => p >= floor);
  const debug = { detection_method: "keyword", prices_found: Array.from(new Set(kwPrices)).slice(0, 12), floor };
  if (!kwPrices.length) {
    return { price_total: null, confidence: "low", warning: "Prix Maeva non détecté automatiquement. Vérification manuelle nécessaire.", debug: { ...debug, failure_reason: "Aucun prix plausible détecté." } };
  }
  const price = mostFrequent(kwPrices) || median(kwPrices);
  return { price_total: price, confidence: "low", warning: "Prix Maeva détecté incertain. Vérifiez avant validation.", debug: { ...debug, selected_price: price } };
}
function extractGenericPrice(html, ctx) {
  const text = stripTags(html);
  const floor = minPlausible(ctx);
  const prices = parsePrices(text).filter((p) => p >= floor);
  const debug = { detection_method: "generic", prices_found: Array.from(new Set(prices)).slice(0, 12), floor };
  if (!prices.length) {
    return { price_total: null, confidence: "low", warning: "Prix non détecté automatiquement. Vérification manuelle nécessaire.", debug: { ...debug, failure_reason: "Aucun prix plausible trouvé." } };
  }
  const freq = mostFrequent(prices);
  const price = freq || median(prices);
  return { price_total: price, confidence: freq ? "medium" : "low", warning: freq ? null : "Prix incertain. Vérifiez avant validation.", debug: { ...debug, selected_price: price } };
}

// ── Construit l'URL effective d'une source selon son type ───────
function buildSourceUrl(source, competitor, ctx) {
  const kind = detectSourceKind(source);
  const base = source.source_url || competitor.booking_url || "";
  if (kind === "booking") return buildBookingUrl(base || competitor.booking_url, ctx);
  if (kind === "lfdnas") return buildLfdnasUrl(base, ctx);
  return base;
}

// ── Handler ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", results: [], errors: ["POST attendu"] });
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const ctx = body.context || {};
    const competitors = Array.isArray(body.competitors) ? body.competitors : [];

    if (!ctx.checkin || !ctx.checkout || !ctx.capacity) {
      return res.status(400).json({ error: "Contexte incomplet (checkin/checkout/capacity).", results: [], errors: ["Contexte incomplet"] });
    }

    const list = competitors.filter((c) => c && c.name && !isOwnProperty(c.name)).slice(0, MAX_COMPETITORS);
    const browserless = !!process.env.BROWSERLESS_API_KEY;
    const results = [];
    const errors = [];
    const nights = Number(ctx.stayNights || 7) || 7;

    for (const c of list) {
      // Sources : soit competitor.sources[], soit fallback booking_url / direct_url
      let srcs = Array.isArray(c.sources) && c.sources.length ? c.sources : [];
      if (!srcs.length) {
        if (c.booking_url) srcs.push({ source_type: "booking", source_name: "Booking.com", source_url: c.booking_url });
        if (c.direct_url) srcs.push({ source_type: "direct", source_name: "Site direct", source_url: c.direct_url });
      }

      for (const s of srcs) {
        const kind = detectSourceKind(s);
        const url = buildSourceUrl(s, c, ctx);
        const base = {
          competitor_id: c.id, competitor_name: c.name,
          channel: s.source_type, source: s.source_name, source_name: s.source_name, source_type: s.source_type,
          url, currency: "EUR",
        };

        // Sites directs : jamais de scraping auto
        if (kind === "direct") {
          results.push({
            ...base, price_total: null, price_night: null, confidence: "low",
            warning: "Site direct : vérification manuelle nécessaire.",
            debug: { http_status: null, final_url: url, html_length: 0, prices_found: [], selected_price: null, detection_method: "none", failure_reason: "Site direct non scrapé automatiquement", mode: browserless ? "browserless" : "fetch_simple" },
          });
          continue;
        }

        try {
          const { html, status, finalUrl, mode, error } = await fetchHtml(url);
          if (!html) {
            results.push({
              ...base, price_total: null, price_night: null, confidence: "low", price_candidates: [],
              warning: "Page inaccessible ou bloquée. Vérification manuelle nécessaire.",
              debug: { http_status: status, final_url: finalUrl, html_length: 0, prices_found: [], price_candidates: [], selected_price: null, detection_method: detectSourceKind(s, finalUrl), failure_reason: error || "Page vide ou bloquée", mode },
            });
            continue;
          }
          // Re-détecte le type avec l'URL finale (corrige Booking mal nommé)
          const kindFinal = detectSourceKind(s, finalUrl);
          let r;
          if (kindFinal === "booking") r = extractBookingPrice(html, ctx, { status, html_length: html.length });
          else if (kindFinal === "lfdnas") r = extractLfdnasPrice(html, ctx);
          else if (kindFinal === "maeva") r = extractMaevaPrice(html, ctx);
          else r = extractGenericPrice(html, ctx);

          const fullDebug = {
            http_status: status, final_url: finalUrl, html_length: html.length,
            source_kind: kindFinal,
            prices_found: r.debug?.prices_found || [],
            price_candidates: (r.price_candidates || []).map((c) => c.price_total),
            selected_price: r.debug?.selected_price ?? null,
            detection_method: r.debug?.detection_method || kindFinal,
            failure_reason: r.debug?.failure_reason || null,
            floor: r.debug?.floor,
            mode: mode === "fetch_simple" ? "Mode fetch simple : certains prix dynamiques peuvent être invisibles." : "browserless",
          };
          results.push({
            ...base,
            price_total: r.price_total,
            price_night: r.price_total ? Math.round(r.price_total / nights) : null,
            price_candidates: r.price_candidates || [],
            confidence: r.confidence,
            extracted_text: r.price_total ? `Prix détecté ~${r.price_total}€` : "",
            warning: r.warning,
            debug: fullDebug,
          });
        } catch (e) {
          errors.push(`${c.name} (${s.source_name}) : ${e.message}`);
          results.push({
            ...base, price_total: null, price_night: null, confidence: "low",
            warning: "Erreur de scraping. Vérification manuelle nécessaire.",
            debug: { http_status: 0, final_url: url, html_length: 0, prices_found: [], selected_price: null, detection_method: "none", failure_reason: e.message, mode: browserless ? "browserless" : "fetch_simple" },
          });
        }
      }
    }

    return res.status(200).json({ results, errors });
  } catch (e) {
    return res.status(500).json({ error: e.message, results: [], errors: [e.message] });
  }
}

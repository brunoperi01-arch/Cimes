// api/scrape-tracked-rates.js
// Scraping ciblé et PRUDENT des concurrents suivis.
// Ne valide jamais automatiquement : renvoie des prix "à vérifier" pour prévalidation côté UI.

const MAX_COMPETITORS = 5;
const FETCH_TIMEOUT_MS = 12000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ── Helpers URL (mêmes règles que le front) ─────────────────────
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

function buildTrackedBookingUrl(competitor, ctx) {
  const cleanBase = normalizeBookingBaseUrl(competitor.booking_url);
  const url = new URL(cleanBase);
  url.searchParams.set("checkin", ctx.checkin);
  url.searchParams.set("checkout", ctx.checkout);
  url.searchParams.set("group_adults", String(ctx.capacity));
  url.searchParams.set("req_adults", String(ctx.capacity));
  url.searchParams.set("group_children", "0");
  url.searchParams.set("req_children", "0");
  url.searchParams.set("no_rooms", "1");
  url.searchParams.set("room1", Array.from({ length: Number(ctx.capacity || 2) }, () => "A").join(","));
  url.searchParams.set("sb_price_type", "total");
  if (url.pathname.includes("searchresults")) {
    url.searchParams.set("ss", competitor.search_location || competitor.name || "La Foux d'Allos");
  }
  return url.toString();
}

function buildTrackedDirectUrl(competitor) {
  return competitor.direct_url || "";
}

function isOwnProperty(name) {
  const n = String(name || "").toLowerCase();
  return (
    n.includes("les cimes du val d'allos") ||
    n.includes("résidence les cimes") ||
    n.includes("residence les cimes")
  );
}

// ── Récupération du HTML ────────────────────────────────────────
async function fetchHtml(url) {
  // Si Browserless est configuré, on l'utilise pour le rendu dynamique.
  const key = process.env.BROWSERLESS_API_KEY;
  if (key) {
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
      if (r.ok) return await r.text();
    } catch {
      /* on retombe sur fetch simple */
    }
  }
  // Fetch simple
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
    if (!r.ok) return null;
    return await r.text();
  } catch {
    clearTimeout(to);
    return null;
  }
}

// ── Extraction des prix ─────────────────────────────────────────
function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&euro;/g, "€")
    .replace(/\s+/g, " ");
}

function parsePrices(text) {
  const re = /(?:€|EUR)\s?([\d\s.,]{2,8})|([\d\s.,]{2,8})\s?(?:€|EUR)/gi;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] || m[2] || "").trim();
    if (!raw) continue;
    // Normalisation : retirer espaces, gérer virgule décimale
    let cleaned = raw.replace(/\s/g, "");
    // "1.240,50" -> "1240.50" ; "1,240" -> ambigu : on retire séparateurs de milliers
    if (cleaned.includes(",") && cleaned.includes(".")) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else if (cleaned.includes(",")) {
      // virgule = décimale si 2 chiffres après, sinon milliers
      cleaned = /,\d{2}$/.test(cleaned) ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
    } else if ((cleaned.match(/\./g) || []).length > 1) {
      cleaned = cleaned.replace(/\./g, "");
    }
    const val = parseFloat(cleaned);
    if (!isNaN(val) && val >= 50 && val <= 10000) out.push(Math.round(val));
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

function analyzePrices(text) {
  const prices = parsePrices(text);
  if (!prices.length) {
    return { price_total: null, confidence: "low", warning: "Prix non détecté automatiquement. Vérification manuelle nécessaire." };
  }
  const freq = mostFrequent(prices);
  const med = median(prices);
  const price = freq || med;
  // Heuristique de confiance
  const lower = text.toLowerCase();
  const hasTotalKw = /\btotal\b|s[ée]jour|prix final|\d\s*nuits?/.test(lower);
  const distinct = new Set(prices).size;
  let confidence = "medium";
  if (distinct >= 5 && !freq) confidence = "low";
  if (hasTotalKw && (freq || distinct <= 3)) confidence = "high";
  return {
    price_total: price,
    confidence,
    warning: confidence === "low" ? "Plusieurs prix contradictoires détectés. Vérifiez manuellement." : null,
  };
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

    const list = competitors
      .filter((c) => c && c.name && !isOwnProperty(c.name))
      .slice(0, MAX_COMPETITORS);

    const results = [];
    const errors = [];

    for (const c of list) {
      const channels = [];
      const pref = c.preferred_channel || "booking";
      if (c.booking_url && (pref === "booking" || pref === "both")) channels.push("booking");
      if (buildTrackedDirectUrl(c) && (pref === "direct" || pref === "both")) channels.push("direct");
      // fallback : si aucun canal explicite mais une URL existe
      if (!channels.length) {
        if (c.booking_url) channels.push("booking");
        else if (buildTrackedDirectUrl(c)) channels.push("direct");
      }

      for (const channel of channels) {
        const isBooking = channel === "booking";
        const url = isBooking ? buildTrackedBookingUrl(c, ctx) : buildTrackedDirectUrl(c);
        const source = isBooking ? "Booking.com" : "Site direct";
        try {
          const html = await fetchHtml(url);
          if (!html) {
            results.push({
              competitor_id: c.id, competitor_name: c.name, channel, source, url,
              price_total: null, price_night: null, currency: "EUR", confidence: "low",
              extracted_text: "", warning: "Page inaccessible ou bloquée. Vérification manuelle nécessaire.",
            });
            continue;
          }
          const text = stripTags(html);
          const { price_total, confidence, warning } = analyzePrices(text);
          const nights = Number(ctx.stayNights || 7) || 7;
          results.push({
            competitor_id: c.id,
            competitor_name: c.name,
            channel,
            source,
            url,
            price_total,
            price_night: price_total ? Math.round(price_total / nights) : null,
            currency: "EUR",
            confidence,
            extracted_text: price_total ? `Prix détecté ~${price_total}€` : "",
            warning,
          });
        } catch (e) {
          errors.push(`${c.name} (${channel}) : ${e.message}`);
          results.push({
            competitor_id: c.id, competitor_name: c.name, channel, source, url,
            price_total: null, price_night: null, currency: "EUR", confidence: "low",
            extracted_text: "", warning: "Erreur de scraping. Vérification manuelle nécessaire.",
          });
        }
      }
    }

    return res.status(200).json({ results, errors });
  } catch (e) {
    return res.status(500).json({ error: e.message, results: [], errors: [e.message] });
  }
}

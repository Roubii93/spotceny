// Shared helper: fetch 15-min spot prices from OTE-CR + EUR/CZK rate from CNB
// Underscore prefix = not exposed as a Vercel endpoint

const OTE_URL      = 'https://www.ote-cr.cz/cs/kratkodobe-trhy/elektrina/denni-trh/@@chart-data';
const CNB_URL      = 'https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt';
const EUR_CZK_FALLBACK = 25.0;

/** Current date in Czech timezone, offset by N days, as YYYY-MM-DD */
export function czDate(offsetDays = 0) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Fetch EUR/CZK from CNB daily rate table. Returns fallback on any error. */
export async function fetchEurCzk() {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(CNB_URL, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return EUR_CZK_FALLBACK;
    const text = await r.text();
    // Line format: "EMU|euro|1|EUR|25,130"
    const match = text.match(/\|EUR\|(\d+[,\.]\d+)/);
    if (!match) return EUR_CZK_FALLBACK;
    return parseFloat(match[1].replace(',', '.'));
  } catch {
    clearTimeout(tid);
    return EUR_CZK_FALLBACK;
  }
}

/**
 * Fetch raw OTE-CR 15-min price points for a given date.
 * Returns array of { x, y } (x=1–96, y=EUR/MWh) or null if unavailable.
 */
export async function fetchOtePoints(dateStr) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(
      `${OTE_URL}?report_date=${dateStr}&time_resolution=PT15M`,
      { signal: ctrl.signal, headers: { 'Accept': 'application/json' } }
    );
    clearTimeout(tid);
    if (!r.ok) return null;
    const json = await r.json();
    const lines = json?.data?.dataLine || [];
    // Find the 15-min price series (title contains "15min")
    const series = lines.find(l => l.title?.includes('15min'));
    return series?.point?.length ? series.point : null;
  } catch {
    clearTimeout(tid);
    return null;
  }
}

/**
 * Derive level string from CZK price (matches levelClass/levelLabel in config.js).
 * @param {number} czk
 * @returns {'low'|'medium'|'high'|'veryhigh'}
 */
function priceLevel(czk) {
  if (czk < 1000) return 'low';
  if (czk < 2500) return 'medium';
  if (czk < 3500) return 'high';
  return 'veryhigh';
}

/**
 * Convert raw OTE points to app slot format.
 * Includes priceEur and level so renderPrices / charts work without modification.
 * @param {Array<{x:number, y:number}>} points
 * @param {number} eurCzk  EUR/CZK exchange rate
 * @returns {Array<{hour:number, minute:number, priceCZK:number, priceEur:number, level:string}>}
 */
export function parseOteSlots(points, eurCzk) {
  return points.map(p => {
    const idx      = p.x - 1;                        // 1-indexed → 0-indexed
    const hour     = Math.floor(idx / 4);
    const minute   = (idx % 4) * 15;
    const priceCZK = Math.round(p.y * eurCzk);
    const priceEur = Math.round(p.y * 100) / 100;    // 2 decimal places
    const level    = priceLevel(priceCZK);
    return { hour, minute, priceCZK, priceEur, level };
  });
}

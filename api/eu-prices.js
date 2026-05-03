// EU spot price proxy — Energy-Charts API (Fraunhofer ISE)
// Free, no auth, JSON, covers CZ/DE/AT/PL/HU/FR
// https://api.energy-charts.info/

const ENERGY_CHARTS = 'https://api.energy-charts.info/price';

const COUNTRIES = {
  cz: { bzn: 'CZ',    name: 'Česká republika', currency: 'CZK', flag: '🇨🇿', tz: 'Europe/Prague'  },
  de: { bzn: 'DE-LU', name: 'Německo',         currency: 'EUR', flag: '🇩🇪', tz: 'Europe/Berlin'  },
  at: { bzn: 'AT',    name: 'Rakousko',         currency: 'EUR', flag: '🇦🇹', tz: 'Europe/Vienna'  },
  pl: { bzn: 'PL',    name: 'Polsko',           currency: 'PLN', flag: '🇵🇱', tz: 'Europe/Warsaw'  },
  hu: { bzn: 'HU',    name: 'Maďarsko',         currency: 'HUF', flag: '🇭🇺', tz: 'Europe/Budapest'},
  fr: { bzn: 'FR',    name: 'Francie',           currency: 'EUR', flag: '🇫🇷', tz: 'Europe/Paris'   },
};

// EUR/CZK from ČNB
async function fetchEurCzk() {
  try {
    const r = await fetch('https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt', {
      signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) return 25.0;
    const text = await r.text();
    const match = text.match(/\|EUR\|(\d+[,\.]\d+)/);
    return match ? parseFloat(match[1].replace(',', '.')) : 25.0;
  } catch { return 25.0; }
}

function localDate(offsetDays, tz) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function priceLevel(eur) {
  if (eur < 0)   return 'negative';
  if (eur < 40)  return 'low';
  if (eur < 100) return 'medium';
  if (eur < 140) return 'high';
  return 'veryhigh';
}

function calcStats(slots) {
  if (!slots.length) return null;
  let min = slots[0], max = slots[0], sum = 0;
  for (const s of slots) {
    if (s.price_eur < min.price_eur) min = s;
    if (s.price_eur > max.price_eur) max = s;
    sum += s.price_eur;
  }
  return {
    min: { price_eur: min.price_eur, time: min.time },
    max: { price_eur: max.price_eur, time: max.time },
    avg_eur: Math.round(sum / slots.length * 100) / 100,
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');

  const countryKey = (req.query?.country || 'cz').toLowerCase();
  const meta = COUNTRIES[countryKey];
  if (!meta) {
    return res.status(400).json({
      error: `Nepodporovaná země. Podporované: ${Object.keys(COUNTRIES).join(', ')}`,
      supported: COUNTRIES,
    });
  }

  const today    = localDate(0, meta.tz);
  const tomorrow = localDate(1, meta.tz);

  try {
    // Fetch today + tomorrow in one call (end = day after tomorrow)
    const dayAfter = localDate(2, meta.tz);
    const url = `${ENERGY_CHARTS}?bzn=${meta.bzn}&start=${today}&end=${dayAfter}`;

    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 9000);

    // Parallel: Energy-Charts + ČNB (only CZK needed for CZ, but fetch anyway for consistency)
    const [r, eurCzk] = await Promise.all([
      fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } }),
      fetchEurCzk(),
    ]);
    if (!r.ok) throw new Error(`Energy-Charts: HTTP ${r.status}`);

    const json = await r.json();

    // Response: { unix_seconds: [...], price: [...], unit: "EUR/MWh" }
    const times  = json.unix_seconds || [];
    const prices = json.price        || [];
    if (!times.length) throw new Error('Energy-Charts: prázdná data');

    // Build slots — split into today / tomorrow by local date
    const todaySlots    = [];
    const tomorrowSlots = [];

    for (let i = 0; i < times.length; i++) {
      const ts  = times[i];
      const eur = prices[i];
      if (eur === null || eur === undefined) continue;

      const dt       = new Date(ts * 1000);
      const localStr = dt.toLocaleString('sv', { timeZone: meta.tz }); // sv → "YYYY-MM-DD HH:MM:SS"
      const dateStr  = localStr.slice(0, 10);
      const hour     = parseInt(localStr.slice(11, 13));
      const timeStr  = localStr.slice(11, 16);

      const slot = {
        hour,
        time:      timeStr,
        price_eur: Math.round(eur * 100) / 100,
        level:     priceLevel(eur),
      };
      // CZK only for CZ
      if (countryKey === 'cz') slot.price_czk = Math.round(eur * eurCzk);

      if (dateStr === today)    todaySlots.push(slot);
      if (dateStr === tomorrow) tomorrowSlots.push(slot);
    }

    // Mark current slot
    const nowLocal    = new Date(new Date().toLocaleString('en-US', { timeZone: meta.tz }));
    const currentHour = nowLocal.getHours();
    const cur = todaySlots.find(s => s.hour === currentHour);
    if (cur) cur.current = true;

    res.status(200).json({
      country:            countryKey,
      country_name:       meta.name,
      flag:               meta.flag,
      currency:           meta.currency,
      bzn:                meta.bzn,
      date:               today,
      date_tomorrow:      tomorrow,
      eur_czk:            eurCzk,
      today:              todaySlots,
      tomorrow:           tomorrowSlots,
      today_stats:        calcStats(todaySlots),
      tomorrow_stats:     calcStats(tomorrowSlots),
      tomorrow_available: tomorrowSlots.length > 0,
      current_hour:       currentHour,
      source:             'energy-charts.info (Fraunhofer ISE)',
      generated_at:       new Date().toISOString(),
      api_version:        '1.0',
    });

  } catch (e) {
    res.status(500).json({ error: e.message, country: countryKey, generated_at: new Date().toISOString() });
  }
}

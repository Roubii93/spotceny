// Public price API — enriched OTE-CR spot prices in CZK + EUR
// Returns today + tomorrow slots with buy/sell prices, stats, current slot marker
// Designed to be used by 3rd party apps (Home Assistant, Node-RED, etc.)

import { czDate, fetchEurCzk, fetchOtePoints, parseOteSlots } from './_ote.js';

const DAN   = 28.30;
const SYST  = 164.24;
const DPH   = 1.21;
const DG_BUY  = 350;
const DG_SELL = 450;

const DIST_DB = {
  cez: { D57d: { vt: 754.77, nt: 116.50 }, D25d: { vt: 400, nt: 116.50 }, D35d: { vt: 550, nt: 116.50 } },
  eon: { D57d: { vt: 780,    nt: 120    }, D25d: { vt: 410, nt: 120    }, D35d: { vt: 560, nt: 120    } },
  pre: { D57d: { vt: 740,    nt: 115    }, D25d: { vt: 390, nt: 115    }, D35d: { vt: 540, nt: 115    } },
};
const VT_HOURS = new Set([8, 12, 15, 19]);

function buyPrice(spotCzk, hour, dist = 'cez', tariff = 'D57d') {
  const rates = DIST_DB[dist]?.[tariff] ?? DIST_DB.cez.D57d;
  const distRate = VT_HOURS.has(hour) ? rates.vt : rates.nt;
  return Math.round((spotCzk + distRate + DG_BUY + DAN + SYST) * DPH);
}

function sellPrice(spotCzk) {
  return Math.round(spotCzk - DG_SELL);
}

function priceLevel(czk) {
  if (czk < 0)    return 'negative';
  if (czk < 1000) return 'low';
  if (czk < 2500) return 'medium';
  if (czk < 3500) return 'high';
  return 'veryhigh';
}

function enrichSlots(slots, dist, tariff) {
  return slots.map(s => ({
    hour:      s.hour,
    minute:    s.minute,
    time:      `${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}`,
    spot_czk:  s.priceCZK,
    spot_eur:  s.priceEur,
    buy_czk:   buyPrice(s.priceCZK, s.hour, dist, tariff),
    sell_czk:  sellPrice(s.priceCZK),
    level:     priceLevel(s.priceCZK),
  }));
}

function calcStats(slots) {
  if (!slots.length) return null;
  let min = slots[0], max = slots[0], sum = 0;
  for (const s of slots) {
    if (s.spot_czk < min.spot_czk) min = s;
    if (s.spot_czk > max.spot_czk) max = s;
    sum += s.spot_czk;
  }
  return {
    min: { spot_czk: min.spot_czk, spot_eur: min.spot_eur, time: min.time },
    max: { spot_czk: max.spot_czk, spot_eur: max.spot_eur, time: max.time },
    avg_spot_czk: Math.round(sum / slots.length),
    avg_spot_eur: Math.round(sum / slots.length / 40) / 10, // rough EUR avg
    count: slots.length,
  };
}

function currentSlotTime() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  return {
    hour:   now.getHours(),
    minute: Math.floor(now.getMinutes() / 15) * 15,
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');

  // Optional query params: ?dist=cez&tariff=D57d
  const dist   = ['cez','eon','pre'].includes(req.query?.dist)   ? req.query.dist   : 'cez';
  const tariff = ['D57d','D25d','D35d'].includes(req.query?.tariff) ? req.query.tariff : 'D57d';

  try {
    const [eurCzk, todayPts, tomorrowPts] = await Promise.all([
      fetchEurCzk(),
      fetchOtePoints(czDate(0)),
      fetchOtePoints(czDate(1)),
    ]);

    const rawToday    = todayPts    ? parseOteSlots(todayPts,    eurCzk) : [];
    const rawTomorrow = tomorrowPts ? parseOteSlots(tomorrowPts, eurCzk) : [];

    const today    = enrichSlots(rawToday,    dist, tariff);
    const tomorrow = enrichSlots(rawTomorrow, dist, tariff);

    const { hour, minute } = currentSlotTime();
    const currentIdx = today.findIndex(s => s.hour === hour && s.minute === minute);
    if (currentIdx >= 0) today[currentIdx].current = true;

    res.status(200).json({
      date:               czDate(0),
      date_tomorrow:      czDate(1),
      eur_czk:            eurCzk,
      dist,
      tariff,
      today,
      tomorrow,
      today_stats:        calcStats(today),
      tomorrow_stats:     calcStats(tomorrow),
      tomorrow_available: tomorrow.length > 0,
      current_time:       `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,
      source:             'ote-cr.cz + cnb.cz',
      generated_at:       new Date().toISOString(),
      api_version:        '1.0',
      docs:               'https://mh-energy.vercel.app/api/ceny.json?dist=cez&tariff=D57d',
    });
  } catch (e) {
    res.status(500).json({ error: e.message, generated_at: new Date().toISOString() });
  }
}

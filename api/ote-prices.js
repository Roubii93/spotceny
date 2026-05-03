// Public endpoint for frontend: fetches OTE-CR 15-min spot prices for today + tomorrow
// Returns { hoursToday, hoursTomorrow } in CZK/MWh — same format as former spotovaelektrina.cz API
// Note: OTE-CR publishes next-day prices around 14:00 CET; hoursTomorrow may be empty before that.

import { czDate, fetchEurCzk, fetchOtePoints, parseOteSlots } from './_ote.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Cache 5 minutes — prices change only each 15-min slot
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');

  try {
    const [eurCzk, todayPts, tomorrowPts] = await Promise.all([
      fetchEurCzk(),
      fetchOtePoints(czDate(0)),
      fetchOtePoints(czDate(1)),
    ]);

    const hoursToday    = todayPts    ? parseOteSlots(todayPts,    eurCzk) : [];
    const hoursTomorrow = tomorrowPts ? parseOteSlots(tomorrowPts, eurCzk) : [];

    res.status(200).json({
      hoursToday,
      hoursTomorrow,
      eurCzk,
      source:      'ote-cr.cz',
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * Seed the dev stub executor with REAL weather for the location configured
 * in weather_settings, so localhost matches what's outside the window
 * instead of synthetic QA data.
 *
 *   node scripts/stub-real-weather.mjs [stub-url]   (default http://127.0.0.1:8899)
 *
 * Reads lat/long from the weather_settings row (DATABASE_URL, like seed.ts),
 * fetches Open-Meteo (the same provider the real executor uses), and POSTs
 * the stub's /__control payload: current conditions, past24/next6 sums, and
 * 48h of hourly points. One-shot — re-run whenever the data feels stale.
 */
import "dotenv/config";
import pg from "pg";

const STUB_URL = process.argv[2] ?? "http://127.0.0.1:8899";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  "select latitude, longitude from weather_settings limit 1",
);
await client.end();

const { latitude, longitude } = rows[0] ?? {};
if (latitude == null || longitude == null) {
  console.error("weather_settings has no location — set one in Admin → Weather");
  process.exit(1);
}

const url =
  "https://api.open-meteo.com/v1/forecast" +
  `?latitude=${latitude}&longitude=${longitude}` +
  "&hourly=temperature_2m,precipitation&past_days=1&forecast_days=3" +
  "&current=temperature_2m&timezone=UTC";
const om = await (await fetch(url)).json();

const times = om.hourly.time.map((t) => `${t}:00Z`);
const nowIdx = times.findIndex((t) => new Date(t).getTime() > Date.now()) - 1;
const sum = (from, to) =>
  om.hourly.precipitation
    .slice(Math.max(0, from), to)
    .reduce((a, b) => a + (b ?? 0), 0);

const weather = {
  fetched_at: new Date().toISOString(),
  past24_mm: Math.round(sum(nowIdx - 24, nowIdx) * 10) / 10,
  next6_mm: Math.round(sum(nowIdx, nowIdx + 6) * 10) / 10,
  current_temp_c: om.current.temperature_2m,
};
const hourly = times.slice(nowIdx, nowIdx + 48).map((time, i) => ({
  time,
  precip_mm: om.hourly.precipitation[nowIdx + i] ?? 0,
  temp_c: om.hourly.temperature_2m[nowIdx + i],
}));

const res = await fetch(`${STUB_URL}/__control`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    weather,
    forecast: { enabled: true, weather, hourly, upcoming: [] },
  }),
});
console.log(
  `seeded stub with real weather for ${latitude},${longitude}: ` +
    `${weather.current_temp_c}°C now, past24 ${weather.past24_mm}mm, ` +
    `next6 ${weather.next6_mm}mm, ${hourly.length} hourly points ` +
    `(stub said ${res.status})`,
);

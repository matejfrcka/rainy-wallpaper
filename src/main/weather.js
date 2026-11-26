'use strict';
/**
 * Real weather → rain settings (Open-Meteo, free, no API key) and automatic
 * day/night grading from the sun's elevation.
 */
const { net } = require('electron');

const WEATHER_TEXT = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers',
  82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail',
};

async function getJson(url) {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'RainyGlassWallpaper/1.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** City name → { name, lat, lon } (first match). */
async function geocode(city) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&format=json&name=' + encodeURIComponent(city);
  const data = await getJson(url);
  const r = data.results && data.results[0];
  if (!r) throw new Error('City not found');
  return { name: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude };
}

async function current(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,precipitation,rain,showers,weather_code,cloud_cover,is_day,wind_speed_10m&timezone=auto';
  const c = (await getJson(url)).current;
  return {
    temp: c.temperature_2m, precip: c.precipitation || 0, code: c.weather_code, cloud: c.cloud_cover,
    isDay: !!c.is_day, wind: c.wind_speed_10m, text: WEATHER_TEXT[c.weather_code] || 'Weather ' + c.weather_code,
    time: Date.now(),
  };
}

/** Map current weather to effect settings. */
function toSettings(w) {
  const code = w.code;
  const thunder = code >= 95;
  const drizzle = code >= 51 && code <= 57;
  const fog = code === 45 || code === 48;
  let intensity;
  if (w.precip > 0) intensity = Math.min(100, 22 + w.precip * 16);
  else if (thunder || (code >= 61 && code <= 82)) intensity = 30;
  else if (drizzle) intensity = 18;
  else intensity = w.cloud > 80 ? 8 : 4; // just a wet window
  const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const out = {
    rainIntensity: Math.round(intensity), thunderEnabled: thunder, windEnabled: w.wind > 25,
    precipitation: snow ? 'snow' : 'rain',
    ...(snow ? { snowIntensity: Math.min(100, Math.round(30 + w.precip * 25)), rainIntensity: 15 } : {}),
    frost: w.temp <= -2 ? Math.min(80, Math.round(-w.temp * 8)) : 0,
  };
  if (fog) Object.assign(out, { condensationEnabled: true, condensation: 75 });
  if (thunder) out.streaks = Math.max(60, out.streaks || 0);
  return out;
}

/** Solar elevation in degrees (NOAA-style approximation, ±0.5°). */
function sunElevation(date, lat, lon) {
  const rad = Math.PI / 180;
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}

/** Sun elevation → dayNight slider value (8 deep night … 65 bright day). */
function dayNightFor(elev) {
  const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
  if (elev <= -12) return 8;
  if (elev <= 0) return Math.round(lerp(8, 35, (elev + 12) / 12));
  if (elev <= 10) return Math.round(lerp(35, 50, elev / 10));
  return Math.round(lerp(50, 65, (elev - 10) / 30));
}

/** Rough location when none is configured: longitude from the time zone, latitude of central Europe. */
function guessLocation() {
  return { lat: 48, lon: -new Date().getTimezoneOffset() / 4 };
}

module.exports = { geocode, current, toSettings, sunElevation, dayNightFor, guessLocation };

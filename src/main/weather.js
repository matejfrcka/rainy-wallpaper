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

/**
 * Map current weather to effect settings so the desktop follows the forecast:
 * dry glass when it doesn't rain, drizzle → light rain → heavy showers by
 * WMO weather code and measured precipitation, snow by snowfall, thunder,
 * fog (condensation), wind and frost below −2 °C.
 */
function toSettings(w) {
  const code = w.code, mm = w.precip || 0;
  const RAIN = { 51: 15, 53: 22, 55: 30, 56: 20, 57: 30, 61: 35, 63: 60, 65: 85, 66: 40, 67: 70, 80: 45, 81: 70, 82: 95, 95: 80, 96: 90, 99: 95 };
  const SNOW = { 71: 35, 73: 60, 75: 90, 77: 30, 85: 55, 86: 85 };
  const thunder = code >= 95;
  const fog = code === 45 || code === 48;
  const freezing = [56, 57, 66, 67].includes(code);
  const out = {
    thunderEnabled: thunder,
    thunderFrequency: code >= 96 ? 85 : 60,
    windEnabled: w.wind > 20,
    windVolume: Math.round(Math.min(90, 25 + w.wind)),
    frost: w.temp <= -2 ? Math.min(80, Math.round(-w.temp * 8)) : freezing ? 45 : 0,
  };
  if (SNOW[code] !== undefined) {
    const amount = Math.min(100, Math.max(SNOW[code], Math.round(25 + mm * 25)));
    Object.assign(out, { precipitation: 'snow', snowIntensity: amount, snowFall: amount, rainIntensity: 8, dropletDensity: 25 });
  } else if (RAIN[code] !== undefined || mm > 0) {
    const amount = Math.min(100, Math.max(RAIN[code] || 0, Math.round(20 + mm * 15)));
    Object.assign(out, { precipitation: 'rain', rainIntensity: amount, streaks: Math.round(20 + amount * 0.6), dropletDensity: Math.round(45 + amount * 0.35) });
  } else {
    // No precipitation: the glass slowly dries; only a little condensation stays.
    Object.assign(out, { precipitation: 'rain', rainIntensity: 0, streaks: 0, dropletDensity: w.cloud > 80 ? 20 : 8 });
  }
  if (fog) Object.assign(out, { condensationEnabled: true, condensation: 75, dropletDensity: 40 });
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

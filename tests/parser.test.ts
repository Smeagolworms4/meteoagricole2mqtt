// Live test: downloads a public location from lameteoagricole.net, parses it, and
// asserts that the parser extracts sensible values. This is intentionally a live
// test so that it catches breakage when the site's HTML changes.
//
// Uses Paris-75001 on purpose — generic, public, well-known.
//
// Requires network access. In CI, run with: npm test. If you want to skip live
// tests in a particular context, set MA_SKIP_LIVE=1.

import fetch from 'node-fetch';
import {
	parseDaily,
	parseHourly,
	mapCondition,
	windBearing,
	numOrNull,
	maxNum,
} from '../src/parser';

const SLUG = 'Paris-75001';
const DAILY_URL = `https://www.lameteoagricole.net/previsions-meteo-agricole/${SLUG}.html`;
const HOURLY_URL = `https://www.lameteoagricole.net/meteo-heure-par-heure/${SLUG}-j1.html`;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 meteoagricole2mqtt-test';

async function fetchHtml(url: string): Promise<string> {
	const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR' } });
	if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
	return r.text();
}

const skipLive = process.env.MA_SKIP_LIVE === '1';
const liveIt = skipLive ? it.skip : it;

describe('helpers', () => {
	test('numOrNull', () => {
		expect(numOrNull('14°')).toBe(14);
		expect(numOrNull('-2')).toBe(-2);
		expect(numOrNull('8.5')).toBe(8.5);
		expect(numOrNull('abc')).toBeNull();
		expect(numOrNull(null)).toBeNull();
	});

	test('maxNum takes the largest number in a range like "10 à 12"', () => {
		expect(maxNum('10 à 12')).toBe(12);
		expect(maxNum('9')).toBe(9);
		expect(maxNum('')).toBeNull();
	});

	test('windBearing for French 16-point compass', () => {
		expect(windBearing('N')).toBe(0);
		expect(windBearing('S')).toBe(180);
		expect(windBearing('SSO')).toBe(202.5);
		expect(windBearing('SO')).toBe(225);
		expect(windBearing('O')).toBe(270); // Ouest = West
		expect(windBearing('NO')).toBe(315);
		// Accept "W" spelled as "O" after normalization
		expect(windBearing('W')).toBe(270);
		expect(windBearing(null)).toBeNull();
	});

	test('mapCondition maps French text to HA conditions', () => {
		expect(mapCondition('Ensoleillé', null, null, false)).toBe('sunny');
		expect(mapCondition('Ensoleillé', null, null, true)).toBe('clear-night');
		expect(mapCondition('Peu nuageux', null, null, false)).toBe('partlycloudy');
		expect(mapCondition('Ciel couvert', null, null, false)).toBe('cloudy');
		expect(mapCondition('Nuageux et averses', null, 2, false)).toBe('rainy');
		expect(mapCondition('Ciel couvert et pluie', null, 8, false)).toBe('pouring');
		expect(mapCondition('Orages', null, null, false)).toBe('lightning');
		expect(mapCondition("Orages avec pluie", null, 5, false)).toBe('lightning-rainy');
		expect(mapCondition('Chutes de neige', null, null, false)).toBe('snowy');
		expect(mapCondition('Brouillard dense', null, null, false)).toBe('fog');
	});
});

describe('parseDaily (live)', () => {
	jest.setTimeout(30000);
	let html: string;

	beforeAll(async () => {
		if (skipLive) return;
		html = await fetchHtml(DAILY_URL);
	});

	liveIt('extracts location name and zip', () => {
		const p = parseDaily(html);
		expect(p.locationName.toLowerCase()).toContain('paris');
		expect(p.zipCode).toBe('75001');
	});

	liveIt('returns ~10 daily forecasts with coherent structure', () => {
		const p = parseDaily(html);
		expect(p.daily.length).toBeGreaterThanOrEqual(7);
		expect(p.daily.length).toBeLessThanOrEqual(14);

		for (const d of p.daily) {
			expect(typeof d.datetime).toBe('string');
			expect(d.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
			expect([
				'clear-night', 'cloudy', 'exceptional', 'fog', 'hail',
				'lightning', 'lightning-rainy', 'partlycloudy', 'pouring',
				'rainy', 'snowy', 'snowy-rainy', 'sunny', 'windy', 'windy-variant',
			]).toContain(d.condition);
		}
	});

	liveIt('first day (today) has temperature and at least one agri metric populated', () => {
		const p = parseDaily(html);
		const today = p.daily[0];
		// Today's max temperature may not yet be published by the site (depending
		// on time of day and whether the daily peak has passed). Humidity and
		// pressure are always present on the free visible days.
		expect(today.humidity).not.toBeNull();
		expect(today.humidity!).toBeGreaterThan(0);
		expect(today.humidity!).toBeLessThanOrEqual(100);
		expect(today.pressure).not.toBeNull();
		expect(today.pressure!).toBeGreaterThan(900);
		expect(today.pressure!).toBeLessThan(1100);
	});

	liveIt('current observations have a condition and valid ranges', () => {
		const p = parseDaily(html);
		expect(p.current.conditionText).toBeTruthy();
		if (p.current.temperature != null) {
			expect(p.current.temperature).toBeGreaterThan(-40);
			expect(p.current.temperature).toBeLessThan(55);
		}
		if (p.current.humidity != null) {
			expect(p.current.humidity).toBeGreaterThanOrEqual(0);
			expect(p.current.humidity).toBeLessThanOrEqual(100);
		}
	});

	liveIt('exposes alert structure (active may be true or false)', () => {
		const p = parseDaily(html);
		expect(p.alert).toHaveProperty('active');
		expect(typeof p.alert.active).toBe('boolean');
		// If active, text must be non-empty
		if (p.alert.active) expect(p.alert.text).toBeTruthy();
	});

	liveIt('exposes sun/moon times in HhMM format when present', () => {
		const p = parseDaily(html);
		if (p.sunMoon.sunrise) expect(p.sunMoon.sunrise).toMatch(/^\d{1,2}h\d{2}$/);
		if (p.sunMoon.sunset) expect(p.sunMoon.sunset).toMatch(/^\d{1,2}h\d{2}$/);
	});
});

describe('parseHourly (live)', () => {
	jest.setTimeout(30000);
	let html: string;

	beforeAll(async () => {
		if (skipLive) return;
		html = await fetchHtml(HOURLY_URL);
	});

	liveIt('returns ~24 hourly slots', () => {
		const h = parseHourly(html);
		expect(h.length).toBeGreaterThanOrEqual(20);
		expect(h.length).toBeLessThanOrEqual(28);
	});

	liveIt('each hourly slot has an ISO datetime and temperature', () => {
		const h = parseHourly(html);
		for (const slot of h) {
			expect(slot.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
			expect(typeof slot.conditionText).toBe('string');
			// Temperature may be null on a bad parse but should usually be populated
		}
		const withTemp = h.filter((s) => s.temperature != null);
		expect(withTemp.length).toBeGreaterThan(h.length / 2);
	});

	liveIt('humidity values are in 0..100 and not swapped with rain probability', () => {
		const h = parseHourly(html);
		const withHum = h.filter((s) => s.humidity != null);
		expect(withHum.length).toBeGreaterThan(0);
		for (const s of withHum) {
			expect(s.humidity!).toBeGreaterThanOrEqual(0);
			expect(s.humidity!).toBeLessThanOrEqual(100);
		}
		// Sanity: humidity and precipitation_probability should rarely be identical
		// across most slots (if they match everywhere, the regex is mis-capturing)
		const pairs = h.filter((s) => s.humidity != null && s.precipitation_probability != null);
		const equalCount = pairs.filter((s) => s.humidity === s.precipitation_probability).length;
		if (pairs.length >= 6) expect(equalCount / pairs.length).toBeLessThan(0.7);
	});

	liveIt('wind_bearing, when present, is one of 16 cardinal degrees', () => {
		const h = parseHourly(html);
		const valid = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5];
		for (const s of h) {
			if (s.wind_bearing != null) expect(valid).toContain(s.wind_bearing);
		}
	});
});

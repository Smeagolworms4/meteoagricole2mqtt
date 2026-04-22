// Parser for lameteoagricole.net HTML pages.
// Exports pure functions — no MQTT, no side-effects.
import * as cheerio from 'cheerio';

// HA standard weather conditions (subset used here)
export type HAWeatherCondition =
	| 'clear-night' | 'cloudy' | 'exceptional' | 'fog' | 'hail'
	| 'lightning' | 'lightning-rainy' | 'partlycloudy' | 'pouring'
	| 'rainy' | 'snowy' | 'snowy-rainy' | 'sunny' | 'windy' | 'windy-variant';

export interface CurrentObs {
	condition: HAWeatherCondition;
	conditionText: string | null;
	temperature: number | null;
	apparent_temperature: number | null;
	dew_point: number | null;
	humidity: number | null;
	wind_speed: number | null;
	wind_bearing: number | null;
	wind_gust_speed: number | null;
	pressure: number | null;
	cloud_coverage: number | null;
	observedAt: string | null;
}

export interface DailyForecast {
	datetime: string;
	condition: HAWeatherCondition;
	conditionText: string;
	temperature: number | null;
	templow: number | null;
	temp_deviation: number | null;
	precipitation: number | null;
	precipitation_probability: number | null;
	wind_speed: number | null;
	wind_gust_speed: number | null;
	wind_bearing: number | null;
	humidity: number | null;
	humidity_min: number | null;
	humidity_max: number | null;
	dew_point: number | null;
	dew_point_min: number | null;
	dew_point_max: number | null;
	uv_index: number | null;
	air_quality: string | null;
	cloud_coverage: number | null;
	sunshine_hours: number | null;
	heat_index: number | null;
	pressure: number | null;
	djc_base0: number | null;
	djc_base6: number | null;
	djc_base10: number | null;
}

export interface HourlyForecast {
	datetime: string;
	condition: HAWeatherCondition;
	conditionText: string;
	temperature: number | null;
	apparent_temperature: number | null;
	precipitation: number | null;
	precipitation_probability: number | null;
	wind_speed: number | null;
	wind_gust_speed: number | null;
	wind_bearing: number | null;
	humidity: number | null;
	cloud_coverage: number | null;
}

export interface SunMoon {
	sunrise: string | null;
	sunset: string | null;
	civil_twilight: string | null;
	nautical_twilight: string | null;
	saint: string | null;
	moonrise: string | null;
	moonset: string | null;
	moon_phase: string | null;
	moon_trend: string | null;
}

export interface DailyPayload {
	locationName: string;
	zipCode: string;
	current: CurrentObs;
	alert: { active: boolean; text: string | null };
	daily: DailyForecast[];
	sunMoon: SunMoon;
}

// ---------- helpers ---------- //
export function numOrNull(v: any): number | null {
	if (v == null) return null;
	const s = String(v).replace(/\s|&nbsp;/g, '').replace(',', '.');
	const m = s.match(/-?\d+(\.\d+)?/);
	if (!m) return null;
	const n = parseFloat(m[0]);
	return isNaN(n) ? null : n;
}

export function maxNum(v: any): number | null {
	if (v == null) return null;
	const s = String(v).replace(/\s|&nbsp;/g, '').replace(',', '.');
	const matches = Array.from(s.matchAll(/-?\d+(\.\d+)?/g)).map((m) => parseFloat(m[0]));
	if (!matches.length) return null;
	return Math.max(...matches);
}

// French 16-point compass rose → degrees (O = Ouest = West)
export const WIND_DIR: Record<string, number> = {
	N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
	E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
	S: 180, SSO: 202.5, SO: 225, OSO: 247.5,
	O: 270, ONO: 292.5, NO: 315, NNO: 337.5,
};

export function windBearing(code: string | null | undefined): number | null {
	if (!code) return null;
	const up = code.trim().toUpperCase().replace(/W/g, 'O');
	return WIND_DIR[up] ?? null;
}

export function mapCondition(text: string, cloudPct: number | null, rainMm: number | null, isNight: boolean): HAWeatherCondition {
	const t = (text || '').toLowerCase();
	if (/neige|flocons/.test(t) && /pluie|averse/.test(t)) return 'snowy-rainy';
	if (/neige|flocons/.test(t)) return 'snowy';
	if (/gr[êe]le|verglas/.test(t)) return 'hail';
	if (/orage/.test(t) && /pluie|averse/.test(t)) return 'lightning-rainy';
	if (/orage|tonnerre/.test(t)) return 'lightning';
	if (/brouillard|brume/.test(t)) return 'fog';
	const pouring = rainMm != null && rainMm >= 5;
	if (/averses?|pluie/.test(t)) return pouring ? 'pouring' : 'rainy';
	if (/tempête|bourrasque|rafale|venteux/.test(t)) return 'windy';
	if (/ciel couvert|couvert/.test(t)) return 'cloudy';
	if (/nuageux/.test(t)) {
		if (/peu|partiellement|ensoleillé|éclair/.test(t)) return 'partlycloudy';
		return 'cloudy';
	}
	if (/éclair|éclaircies|peu nuageux|partiel/.test(t)) return 'partlycloudy';
	if (/ensoleillé|soleil|dégagé|ciel clair|clair/.test(t)) return isNight ? 'clear-night' : 'sunny';
	if (cloudPct != null) {
		if (cloudPct < 20) return isNight ? 'clear-night' : 'sunny';
		if (cloudPct < 60) return 'partlycloudy';
		return 'cloudy';
	}
	return isNight ? 'clear-night' : 'sunny';
}

function cellText(cell: cheerio.Cheerio<any>): string {
	return cell.text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function isNightHour(hour: number): boolean {
	return hour < 7 || hour >= 21;
}

// ---------- Daily page ---------- //
export function parseDaily(html: string, now: Date = new Date()): DailyPayload {
	const $ = cheerio.load(html);

	const titleText = $('h3.fs-5').first().text().trim();
	const locMatch = titleText.match(/^(.+?)\s*\((\d{5})\)/);
	const locationName = locMatch ? locMatch[1].trim() : titleText;
	const zipCode = locMatch ? locMatch[2] : '';

	// Current observations
	const obsBlock = $('h4:contains("Conditions observées")').closest('.card-body');
	const currentText = obsBlock.find('p').first().text().trim();
	const observedAt = (obsBlock.find('.small.text-shade-4').first().text().match(/(\d{1,2}:\d{2})/) || [])[1] || null;
	const currentTempC = numOrNull(obsBlock.find('.h3').first().text());
	const obsTxt = cellText(obsBlock);
	const humidityCur = (obsTxt.match(/Humidité relative[\s\S]*?(\d+)\s*%/) || [])[1];
	const dewCur = (obsTxt.match(/Point de rosée[\s\S]*?(-?\d+)\s*°/) || [])[1];
	const ressentiCur = (obsTxt.match(/Ressenti[\s\S]*?(-?\d+)\s*°/) || [])[1];
	const windCur = (obsTxt.match(/Vent[\s\S]*?(\d+)\s*km\/h/) || [])[1];
	const pressureCur = numOrNull((obsTxt.match(/(\d{3,4})\s*hPa/) || [])[1]);
	const cloudCur = numOrNull((obsTxt.match(/Nébulosité[\s\S]*?(\d+)\s*%/) || [])[1]);
	const gustCur = numOrNull((obsTxt.match(/rafale[^0-9]*(\d+)\s*km\/h/i) || [])[1]);
	const windDirCur = (obsTxt.match(/Direction\s*(?:du\s*vent)?\s*:?\s*([NSEOW]{1,3})/i) || [])[1];

	const current: CurrentObs = {
		conditionText: currentText || null,
		condition: mapCondition(currentText, cloudCur, null, isNightHour(now.getHours())),
		temperature: currentTempC,
		apparent_temperature: numOrNull(ressentiCur),
		dew_point: numOrNull(dewCur),
		humidity: numOrNull(humidityCur),
		wind_speed: numOrNull(windCur),
		wind_bearing: windBearing(windDirCur),
		wind_gust_speed: gustCur,
		pressure: pressureCur,
		cloud_coverage: cloudCur,
		observedAt,
	};

	// Alert / vigilance
	const vigilanceBlock = $('.alert:has(.icon-Warning), .alert:has(.icon-thunder)').first();
	const alertText = vigilanceBlock.length ? cellText(vigilanceBlock) : null;
	const alert = { active: !!alertText, text: alertText };

	// Daily table
	const table = $('#jours-table');
	const headerCells = table.find('thead th');
	const dayHeaders: { dayName: string; dayNum: number; month: string }[] = [];
	headerCells.each((_i, th) => {
		const txt = cellText($(th));
		const m = txt.match(/(\S+)\s+(\d{1,2})\s+(\S+)/);
		if (m) dayHeaders.push({ dayName: m[1], dayNum: parseInt(m[2], 10), month: m[3] });
		else dayHeaders.push({ dayName: '?', dayNum: 0, month: '?' });
	});

	const rows = table.find('tbody tr');
	const nbCols = dayHeaders.length;
	const daily: DailyForecast[] = [];

	for (let i = 0; i < nbCols; i++) {
		const d: DailyForecast = {
			datetime: '',
			condition: 'sunny',
			conditionText: '',
			temperature: null,
			templow: null,
			temp_deviation: null,
			precipitation: null,
			precipitation_probability: null,
			wind_speed: null,
			wind_gust_speed: null,
			wind_bearing: null,
			humidity: null,
			humidity_min: null,
			humidity_max: null,
			dew_point: null,
			dew_point_min: null,
			dew_point_max: null,
			uv_index: null,
			air_quality: null,
			cloud_coverage: null,
			sunshine_hours: null,
			heat_index: null,
			pressure: null,
			djc_base0: null,
			djc_base6: null,
			djc_base10: null,
		};

		const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
		d.datetime = d0.toISOString().split('T')[0];

		rows.each((rIdx, tr) => {
			const cells = $(tr).find('th, td');
			const cell = $(cells[i]);
			if (!cell.length) return;
			const txt = cellText(cell);

			switch (rIdx) {
				case 0: {
					const condText = cell.find('img[src*="/Weather/numbers/"]').first().attr('alt')
						|| cell.find('.forModal').first().text().trim();
					d.conditionText = condText || '';
					d.temperature = numOrNull(cell.find('.fw-bold.fs-4.text-warning').first().text());
					const minMatch = txt.match(/min\s*(-?\d+)\s*°/);
					if (minMatch) d.templow = parseFloat(minMatch[1]);
					const ecartTxt = cell.find('.text-invalid .fw-bold').first().text().trim();
					if (ecartTxt === '=') d.temp_deviation = 0;
					else if (ecartTxt) d.temp_deviation = numOrNull(ecartTxt);
					const precipMatch = txt.match(/Précipitations\s*:\s*([\d.,]+(?:\s*à\s*[\d.,]+)?)\s*mm/);
					if (precipMatch) d.precipitation = maxNum(precipMatch[1]);
					const probaMatch = txt.match(/Probabilité\s*:\s*(\d+)\s*%/);
					if (probaMatch) d.precipitation_probability = parseInt(probaMatch[1], 10);
					const dirImg = cell.find('img[src*="/Direction/"]').first();
					if (dirImg.length) {
						const code = (dirImg.attr('alt') || '').replace(/Direction du vent\s*:\s*/i, '').trim();
						d.wind_bearing = windBearing(code);
					}
					const windMatches = Array.from(txt.matchAll(/(\d+)\s*km\/h/g)).map((m) => parseInt(m[1], 10));
					if (windMatches.length >= 1) d.wind_speed = windMatches[0];
					if (windMatches.length >= 2) d.wind_gust_speed = windMatches[1];
					break;
				}
				case 1: {
					const humMatch = txt.match(/(\d+)\s*%\s*Humidité/);
					if (humMatch) d.humidity = parseInt(humMatch[1], 10);
					const humMini = txt.match(/Mini\s*:\s*(\d+)\s*%/);
					const humMaxi = txt.match(/Maxi\s*:\s*(\d+)\s*%/);
					if (humMini) d.humidity_min = parseInt(humMini[1], 10);
					if (humMaxi) d.humidity_max = parseInt(humMaxi[1], 10);
					const dewMatch = txt.match(/(-?\d+)\s*°C\s*Point de rosée/);
					if (dewMatch) d.dew_point = parseFloat(dewMatch[1]);
					const dewBlock = txt.split('Point de rosée')[1] || '';
					const dewMini = dewBlock.match(/Mini\s*:\s*(-?\d+)\s*°C/);
					const dewMaxi = dewBlock.match(/Maxi\s*:\s*(-?\d+)\s*°C/);
					if (dewMini) d.dew_point_min = parseFloat(dewMini[1]);
					if (dewMaxi) d.dew_point_max = parseFloat(dewMaxi[1]);
					break;
				}
				case 2: {
					const uvMatch = txt.match(/(\d+)\s*Indice UV/);
					if (uvMatch) d.uv_index = parseInt(uvMatch[1], 10);
					const airMatch = txt.match(/\b(Bon|Moyen|Dégradé|Mauvais|Très mauvais)\b\s*Qualité air/i);
					if (airMatch) d.air_quality = airMatch[1];
					const nebMatch = txt.match(/(\d+)\s*%\s*Nébulosité/);
					if (nebMatch) d.cloud_coverage = parseInt(nebMatch[1], 10);
					const sunMatch = txt.match(/(\d+)h(\d+)\s*Ensoleillement/);
					if (sunMatch) d.sunshine_hours = parseInt(sunMatch[1], 10) + parseInt(sunMatch[2], 10) / 60;
					break;
				}
				case 3: {
					const hiMatch = txt.match(/(\d+)\s*Indice chaleur/);
					if (hiMatch) d.heat_index = parseInt(hiMatch[1], 10);
					const pMatch = txt.match(/(\d{3,4})\s*hPa/);
					if (pMatch) d.pressure = parseInt(pMatch[1], 10);
					break;
				}
				case 4: {
					const b10 = txt.match(/Base\s*10\s*(-?[\d.]+)/);
					const b6 = txt.match(/Base\s*6\s*(-?[\d.]+)/);
					const b0 = txt.match(/Base\s*0\s*(-?[\d.]+)/);
					if (b10) d.djc_base10 = parseFloat(b10[1]);
					if (b6) d.djc_base6 = parseFloat(b6[1]);
					if (b0) d.djc_base0 = parseFloat(b0[1]);
					break;
				}
			}
		});

		d.condition = mapCondition(d.conditionText, d.cloud_coverage, d.precipitation, false);
		daily.push(d);
	}

	// Sun / Moon
	const sunBlock = $('h4:contains("Soleil")').closest('.card').text().replace(/\s+/g, ' ');
	const moonBlock = $('h4:contains("Lune")').closest('.card').first().text().replace(/\s+/g, ' ');
	const sunTimes = sunBlock.match(/(\d{1,2}h\d{2})/g) || [];
	const civilMatch = sunBlock.match(/Crépuscule civil\s*:\s*([\dh :–-]+(?:\d{2}))/);
	const nautMatch = sunBlock.match(/Crépuscule nautique\s*:\s*([\dh :–-]+(?:\d{2}))/);
	const saintMatch = sunBlock.match(/Saint\(e\)\s*([A-Za-zÀ-ÖØ-öø-ÿ' -]+?)(?:Crépuscule|$)/);
	const moonTimes = moonBlock.match(/(\d{1,2}h\d{2})/g) || [];
	const phaseMatch = moonBlock.match(/(Nouvelle lune|Premier quartier|Pleine lune|Dernier quartier|Lune gibbeuse[^<]*|Lune croissante|Lune décroissante)/i);
	const trendMatch = moonBlock.match(/(croissante|décroissante)/i);

	const sunMoon: SunMoon = {
		sunrise: sunTimes[0] ?? null,
		sunset: sunTimes[1] ?? null,
		civil_twilight: civilMatch ? civilMatch[1].trim() : null,
		nautical_twilight: nautMatch ? nautMatch[1].trim() : null,
		saint: saintMatch ? saintMatch[1].trim() : null,
		moonrise: moonTimes[0] ?? null,
		moonset: moonTimes[1] ?? null,
		moon_phase: phaseMatch?.[1]?.trim() ?? null,
		moon_trend: trendMatch?.[1] ?? null,
	};

	return { locationName, zipCode, current, alert, daily, sunMoon };
}

// ---------- Hourly page ---------- //
export function parseHourly(html: string, baseDate: Date = new Date()): HourlyForecast[] {
	const $ = cheerio.load(html);
	const table = $('#heures-table');
	const headerCells = table.find('thead th, tr').first().find('th');
	const dataRow = table.find('tbody tr').first();
	const dataCells = dataRow.find('td');

	const out: HourlyForecast[] = [];

	headerCells.each((i, th) => {
		const txt = cellText($(th));
		const hMatch = txt.match(/(\d{1,2})h/);
		const dayMatch = txt.match(/(\d{1,2})/);
		const cell = $(dataCells[i]);
		if (!cell.length) return;
		const cTxt = cellText(cell);

		const condText = cell.find('img[src*="/Weather/numbers/"]').first().attr('alt')
			|| cell.find('.forModal').first().text().trim();
		const temp = numOrNull(cell.find('.fw-bold.fs-4.text-warning').first().text());
		const ressentiMatch = cTxt.match(/ressentie\s*(-?\d+)\s*°/i);
		const precipMatch = cTxt.match(/Précipitations\s*:\s*([\d.,]+(?:\s*à\s*[\d.,]+)?)\s*mm/);
		const probaMatch = cTxt.match(/Probabilité\s*:\s*(\d+)\s*%/);
		const humMatch = cTxt.match(/(\d+)\s*%\s*Humidité/);
		const nebMatch = cTxt.match(/(\d+)\s*%\s*Nébulosité/);
		const dirImg = cell.find('img[src*="/Direction/"]').first();
		const windDir = (dirImg.attr('alt') || '').replace(/Direction du vent\s*:\s*/i, '').trim();
		const windMatches = Array.from(cTxt.matchAll(/(\d+)\s*km\/h/g)).map((m) => parseInt(m[1], 10));

		const hour = hMatch ? parseInt(hMatch[1], 10) : i;
		const dayNum = dayMatch ? parseInt(dayMatch[1], 10) : baseDate.getDate();
		let dt = new Date(baseDate.getFullYear(), baseDate.getMonth(), dayNum, hour, 0, 0);
		if (dayNum < baseDate.getDate() - 3) {
			dt = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, dayNum, hour, 0, 0);
		}

		const cloud = nebMatch ? parseInt(nebMatch[1], 10) : null;
		const rain = precipMatch ? maxNum(precipMatch[1]) : null;

		out.push({
			datetime: dt.toISOString(),
			condition: mapCondition(condText || '', cloud, rain, isNightHour(hour)),
			conditionText: condText || '',
			temperature: temp,
			apparent_temperature: ressentiMatch ? parseFloat(ressentiMatch[1]) : null,
			precipitation: rain,
			precipitation_probability: probaMatch ? parseInt(probaMatch[1], 10) : null,
			wind_speed: windMatches[0] ?? null,
			wind_gust_speed: windMatches[1] ?? null,
			wind_bearing: windBearing(windDir),
			humidity: humMatch ? parseInt(humMatch[1], 10) : null,
			cloud_coverage: cloud,
		});
	});

	return out;
}

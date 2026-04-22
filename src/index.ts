import minimist from 'minimist';
import * as mqtt from 'mqtt';
import fetch from 'node-fetch';
import {
	parseDaily,
	parseHourly,
	DailyPayload,
	HourlyForecast,
} from './parser';

console.log('');
console.log('========================================');
console.log('= Start LaMeteoAgricole.net 2 MQTT     =');
console.log('========================================');
console.log('');

// ---------- CLI args ---------- //
const rawArgv = process.argv.slice(2);
const args = minimist(rawArgv, {
	string: [
		'mqtt-uri', 'mqtt-prefix', 'mqtt-retain', 'mqtt-qos',
		'locations', 'scan-interval', 'city-delay',
		'ha-discovery', 'ha-prefix', 'log',
	],
	boolean: ['help'],
	alias: { 'mqtt-uri': 'm', 'locations': 'L', 'log': 'l', 'help': 'h' },
	default: {
		log: 'MESSAGE',
		'mqtt-prefix': 'meteoagricole',
		'mqtt-retain': '1',
		'mqtt-qos': '0',
		'ha-discovery': '1',
		'ha-prefix': 'homeassistant',
		'scan-interval': '300',
		'city-delay': '30',
	},
});

let argError: string | null = null;
if (!args.m) argError = 'mqtt-uri is required';
if (!args.locations) argError = 'locations is required (comma-separated slugs, e.g. Saint-Etienne-42000,Paris-75001)';

if (args.h || argError) {
	if (argError) console.error('ERROR:', argError);
	console.log(`
Run command:

    ${process.argv[0]} ${process.argv[1]} [PARAMS]

Parameters:

    mqtt-uri, m              MQTT URI (mqtt://login:pass@127.0.0.1:1883)
    mqtt-prefix              MQTT topic prefix (default: meteoagricole)
    mqtt-retain              MQTT retain, 0 or 1 (default: 1)
    mqtt-qos                 MQTT QOS, 0 / 1 / 2 (default: 0)
    locations, L             Comma-separated slugs (Town-Zip), e.g. Saint-Etienne-42000,Paris-75001
    scan-interval            Seconds between full refresh cycles (default: 300)
    city-delay               Seconds between each location (default: 30)
    ha-discovery             Enable HA discovery, 0 or 1 (default: 1)
    ha-prefix                HA discovery prefix (default: homeassistant)
    log, l                   Log level: ERROR | MESSAGE | DEBUG (default: MESSAGE)
    help, h                  Display help
    `);
	process.exit(argError ? 1 : 0);
}

const mqttUri: string = args.m;
const mqttPrefix: string = args['mqtt-prefix'];
const mqttRetain: boolean = args['mqtt-retain'] === '1' || args['mqtt-retain']?.toLowerCase?.() === 'true';
let mqttQos = parseInt(args['mqtt-qos'], 10);
if (![0, 1, 2].includes(mqttQos)) mqttQos = 0;

const locations: string[] = String(args.locations).split(',').map((s) => s.trim()).filter(Boolean);

let scanInterval = parseInt(args['scan-interval'], 10);
if (isNaN(scanInterval) || scanInterval < 60) scanInterval = 300;
let cityDelay = parseInt(args['city-delay'], 10);
if (isNaN(cityDelay) || cityDelay < 0) cityDelay = 30;

const haDiscovery: boolean = args['ha-discovery'] === '1' || args['ha-discovery']?.toLowerCase?.() === 'true';
const haPrefix: string = args['ha-prefix'] || 'homeassistant';

console.log('Config:', `
    mqtt-uri:                ${mqttUri.replace(/(mqtt:\/\/[^:]+:)([^@]+)(@)/, '$1*****$3')}
    mqtt-prefix:             ${mqttPrefix}
    mqtt-retain:             ${mqttRetain ? 'enabled' : 'disabled'}
    mqtt-qos:                ${mqttQos}
    locations:               ${locations.join(', ')}
    scan-interval:           ${scanInterval}s
    city-delay:              ${cityDelay}s
    ha-discovery:            ${haDiscovery ? 'enabled' : 'disabled'}
    ha-prefix:               ${haPrefix}
    log:                     ${String(args.l).toUpperCase()}
`);

switch (String(args.l).toLowerCase()) {
	case 'error':
		console.log = () => {};
	default:
		console.debug = () => {};
	case 'debug':
		break;
}

// ---------- MQTT ---------- //
let client: mqtt.MqttClient | null = null;

function publish(topic: string, payload: string) {
	if (client && client.connected) {
		console.debug('Publish:', topic, payload.length > 200 ? payload.slice(0, 200) + '…' : payload);
		client.publish(topic, payload, { retain: mqttRetain, qos: mqttQos as any });
	} else {
		console.error('MQTT not connected, skipping publish:', topic);
	}
}

// ---------- HTTP fetch ---------- //
const USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 meteoagricole2mqtt';

async function fetchPage(url: string): Promise<string> {
	console.debug('GET', url);
	const resp = await fetch(url, {
		headers: {
			'User-Agent': USER_AGENT,
			'Accept': 'text/html,application/xhtml+xml',
			'Accept-Language': 'fr-FR,fr;q=0.9',
		},
	});
	if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${url}`);
	return resp.text();
}

function slugify(loc: string): string {
	return loc
		.toLowerCase()
		.replace(/%[0-9a-f]{2}/gi, '')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

// ---------- scan a single location ---------- //
async function scanLocation(slug: string) {
	console.log(`→ [${slug}] scanning…`);
	const locSlug = slugify(slug);

	const dailyUrl = `https://www.lameteoagricole.net/previsions-meteo-agricole/${slug}.html`;
	const hourlyUrls = [1, 2, 3].map((j) => `https://www.lameteoagricole.net/meteo-heure-par-heure/${slug}-j${j}.html`);

	let dailyPayload: DailyPayload;
	try {
		const html = await fetchPage(dailyUrl);
		dailyPayload = parseDaily(html);
	} catch (e) {
		console.error(`[${slug}] daily fetch failed:`, e);
		return;
	}

	const hourly: HourlyForecast[] = [];
	for (let idx = 0; idx < hourlyUrls.length; idx++) {
		try {
			const html = await fetchPage(hourlyUrls[idx]);
			const base = new Date();
			base.setDate(base.getDate() + idx);
			hourly.push(...parseHourly(html, base));
		} catch (e) {
			console.error(`[${slug}] hourly j${idx + 1} fetch failed:`, e);
		}
	}

	publishLocation(slug, locSlug, dailyPayload, hourly);
	console.log(
		`✓ [${slug}] ${dailyPayload.locationName} (${dailyPayload.zipCode}) — ${dailyPayload.daily.length}d / ${hourly.length}h` +
			(dailyPayload.alert.active ? ` ⚠ ${dailyPayload.alert.text}` : ''),
	);
}

function publishLocation(slug: string, locSlug: string, daily: DailyPayload, hourly: HourlyForecast[]) {
	const base = `${mqttPrefix}/${locSlug}`;
	const device = {
		identifiers: [`meteoagricole_${locSlug}`],
		name: `MétéoAgricole ${daily.locationName || slug}`,
		manufacturer: 'lameteoagricole.net',
		model: `Location ${daily.zipCode}`,
		configuration_url: `https://www.lameteoagricole.net/previsions-meteo-agricole/${slug}.html`,
	};

	const currentPayload = {
		...daily.current,
		location: daily.locationName,
		zip: daily.zipCode,
		updated: new Date().toISOString(),
	};
	publish(`${base}/current`, JSON.stringify(currentPayload));
	publish(`${base}/daily`, JSON.stringify(daily.daily));
	publish(`${base}/hourly`, JSON.stringify(hourly));
	publish(`${base}/sun_moon`, JSON.stringify(daily.sunMoon));
	publish(`${base}/alert`, JSON.stringify(daily.alert));
	// Wrapped payloads for json_attributes_topic (MQTT sensors need a JSON object, not a bare array)
	publish(`${base}/forecast_daily`, JSON.stringify({ count: daily.daily.length, forecast: daily.daily }));
	publish(`${base}/forecast_hourly`, JSON.stringify({ count: hourly.length, forecast: hourly }));

	if (!haDiscovery) return;

	// HA MQTT integration does NOT support the `weather` platform via discovery.
	// Clear any previously published broken config (retained) so HA forgets the entity.
	publish(`${haPrefix}/weather/meteoagricole/${locSlug}/config`, '');

	// Legacy slug keys cleanup (renamed to match meteofrance-weather-card convention).
	// Publishing an empty retained payload removes the old entity from HA's registry.
	const LEGACY_SLUGS = ['cloud_coverage', 'uv_index', 'precipitation_probability_today'];
	for (const legacy of LEGACY_SLUGS) {
		publish(`${haPrefix}/sensor/meteoagricole/${locSlug}_${legacy}/config`, '');
	}

	// Modern HA MQTT discovery uses `default_entity_id` (since 2025+) to suggest the
	// entity_id — `object_id` in the payload is deprecated.
	const addSensor = (slugKey: string, name: string, valueTemplate: string, topic: string, opts: Record<string, any> = {}) => {
		publish(`${haPrefix}/sensor/meteoagricole/${locSlug}_${slugKey}/config`, JSON.stringify({
			name,
			unique_id: `meteoagricole_${locSlug}_${slugKey}`,
			default_entity_id: `sensor.meteoagricole_${locSlug}_${slugKey}`,
			state_topic: topic,
			value_template: valueTemplate,
			device,
			...opts,
		}));
	};

	const addBinary = (slugKey: string, name: string, valueTemplate: string, topic: string, opts: Record<string, any> = {}) => {
		publish(`${haPrefix}/binary_sensor/meteoagricole/${locSlug}_${slugKey}/config`, JSON.stringify({
			name,
			unique_id: `meteoagricole_${locSlug}_${slugKey}`,
			default_entity_id: `binary_sensor.meteoagricole_${locSlug}_${slugKey}`,
			state_topic: topic,
			value_template: valueTemplate,
			payload_on: 'true',
			payload_off: 'false',
			device,
			...opts,
		}));
	};

	const curT = `${base}/current`;
	const dT = `${base}/daily`;
	const smT = `${base}/sun_moon`;
	const alT = `${base}/alert`;
	const fdT = `${base}/forecast_daily`;
	const fhT = `${base}/forecast_hourly`;

	// Condition code (HA-standard) — used as state of a template weather entity
	addSensor('condition', 'Condition', '{{ value_json.condition }}', curT, { icon: 'mdi:weather-partly-cloudy' });

	// Forecast arrays exposed as attribute `forecast` of a sensor (HA requires a JSON object
	// on json_attributes_topic, so we wrap the arrays). The template `weather:` entity in
	// configuration.yaml reads them via `state_attr('sensor.xxx_forecast_daily', 'forecast')`.
	publish(`${haPrefix}/sensor/meteoagricole/${locSlug}_forecast_daily/config`, JSON.stringify({
		name: 'Forecast daily',
		unique_id: `meteoagricole_${locSlug}_forecast_daily`,
		default_entity_id: `sensor.meteoagricole_${locSlug}_forecast_daily`,
		state_topic: fdT,
		value_template: '{{ value_json.count }}',
		json_attributes_topic: fdT,
		unit_of_measurement: 'd',
		icon: 'mdi:calendar-week',
		device,
	}));
	publish(`${haPrefix}/sensor/meteoagricole/${locSlug}_forecast_hourly/config`, JSON.stringify({
		name: 'Forecast hourly',
		unique_id: `meteoagricole_${locSlug}_forecast_hourly`,
		default_entity_id: `sensor.meteoagricole_${locSlug}_forecast_hourly`,
		state_topic: fhT,
		value_template: '{{ value_json.count }}',
		json_attributes_topic: fhT,
		unit_of_measurement: 'h',
		icon: 'mdi:clock-outline',
		device,
	}));

	addSensor('temperature', 'Température', '{{ value_json.temperature }}', curT, {
		device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement',
	});
	addSensor('apparent_temperature', 'Température ressentie', '{{ value_json.apparent_temperature }}', curT, {
		device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement',
	});
	addSensor('dew_point', 'Point de rosée', '{{ value_json.dew_point }}', curT, {
		device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement',
	});
	addSensor('humidity', 'Humidité', '{{ value_json.humidity }}', curT, {
		device_class: 'humidity', unit_of_measurement: '%', state_class: 'measurement',
	});
	addSensor('pressure', 'Pression', '{{ value_json.pressure }}', curT, {
		device_class: 'atmospheric_pressure', unit_of_measurement: 'hPa', state_class: 'measurement',
	});
	addSensor('wind_speed', 'Vent', '{{ value_json.wind_speed }}', curT, {
		device_class: 'wind_speed', unit_of_measurement: 'km/h', state_class: 'measurement',
	});
	addSensor('wind_gust_speed', 'Rafales', '{{ value_json.wind_gust_speed }}', curT, {
		device_class: 'wind_speed', unit_of_measurement: 'km/h', state_class: 'measurement',
	});
	addSensor('wind_bearing', 'Direction du vent', '{{ value_json.wind_bearing }}', curT, {
		unit_of_measurement: '°', icon: 'mdi:compass',
	});
	// Slug aligned with meteofrance-weather-card auto-detection (`_cloud_cover`)
	addSensor('cloud_cover', 'Nébulosité', '{{ value_json.cloud_coverage }}', curT, {
		unit_of_measurement: '%', icon: 'mdi:weather-cloudy', state_class: 'measurement',
	});
	// Renamed from "Condition" → avoids collision with the HA-code condition sensor above
	addSensor('condition_text', 'Observation', '{{ value_json.conditionText }}', curT, { icon: 'mdi:weather-partly-cloudy' });
	addSensor('observed_at', 'Dernière observation', '{{ value_json.observedAt }}', curT, { icon: 'mdi:clock-outline' });

	// Slug aligned with meteofrance-weather-card (`_uv`)
	addSensor('uv', 'Indice UV', '{{ value_json[0].uv_index }}', dT, { icon: 'mdi:weather-sunny-alert', state_class: 'measurement' });
	addSensor('air_quality', 'Qualité air', '{{ value_json[0].air_quality }}', dT, { icon: 'mdi:air-filter' });
	addSensor('sunshine_hours', 'Ensoleillement', '{{ value_json[0].sunshine_hours | round(1) if value_json[0].sunshine_hours else None }}', dT, {
		unit_of_measurement: 'h', icon: 'mdi:weather-sunny',
	});
	addSensor('heat_index', 'Indice chaleur', '{{ value_json[0].heat_index }}', dT, { unit_of_measurement: '°C', icon: 'mdi:thermometer-high' });
	addSensor('temp_deviation', 'Écart saisonnier', '{{ value_json[0].temp_deviation }}', dT, { unit_of_measurement: '°C', icon: 'mdi:chart-line-variant' });
	addSensor('precipitation_today', 'Précipitations J', '{{ value_json[0].precipitation }}', dT, {
		device_class: 'precipitation', unit_of_measurement: 'mm', state_class: 'total',
	});
	// Slug aligned with meteofrance-weather-card (`_rain_chance`)
	addSensor('rain_chance', 'Probabilité pluie J', '{{ value_json[0].precipitation_probability }}', dT, {
		unit_of_measurement: '%', icon: 'mdi:weather-pouring',
	});
	// Derived: freeze chance for today (cold + rainy days)
	addSensor('freeze_chance', 'Probabilité gel J',
		'{% set d = value_json[0] %}' +
		'{% set tmin = d.templow | float(99) %}' +
		'{% set pp = d.precipitation_probability | float(0) %}' +
		'{% if tmin <= 0 %}100{% elif tmin <= 2 and pp >= 30 %}50{% elif tmin <= 3 %}20{% else %}0{% endif %}',
		dT, { unit_of_measurement: '%', icon: 'mdi:snowflake-thermometer' });
	// Derived: snow chance for today (based on condition or cold+precip)
	addSensor('snow_chance', 'Probabilité neige J',
		'{% set d = value_json[0] %}' +
		'{% set c = d.condition %}' +
		'{% set txt = d.conditionText | lower %}' +
		'{% set tmin = d.templow | float(99) %}' +
		'{% if c in ["snowy","snowy-rainy","hail"] or "neige" in txt or "flocon" in txt %}100' +
		'{% elif tmin <= 1 and (d.precipitation | float(0)) > 0 %}40' +
		'{% else %}0{% endif %}',
		dT, { unit_of_measurement: '%', icon: 'mdi:weather-snowy' });
	addSensor('temperature_max_today', 'Température maxi J', '{{ value_json[0].temperature }}', dT, {
		device_class: 'temperature', unit_of_measurement: '°C',
	});
	addSensor('temperature_min_today', 'Température mini J', '{{ value_json[0].templow }}', dT, {
		device_class: 'temperature', unit_of_measurement: '°C',
	});
	addSensor('djc_base0', 'DJC base 0', '{{ value_json[0].djc_base0 }}', dT, { unit_of_measurement: '°C', icon: 'mdi:sprout' });
	addSensor('djc_base6', 'DJC base 6', '{{ value_json[0].djc_base6 }}', dT, { unit_of_measurement: '°C', icon: 'mdi:sprout' });
	addSensor('djc_base10', 'DJC base 10', '{{ value_json[0].djc_base10 }}', dT, { unit_of_measurement: '°C', icon: 'mdi:sprout' });

	addSensor('sunrise', 'Lever du soleil', '{{ value_json.sunrise }}', smT, { icon: 'mdi:weather-sunset-up' });
	addSensor('sunset', 'Coucher du soleil', '{{ value_json.sunset }}', smT, { icon: 'mdi:weather-sunset-down' });
	addSensor('saint', 'Saint du jour', '{{ value_json.saint }}', smT, { icon: 'mdi:cross' });
	addSensor('moon_phase', 'Phase lunaire', '{{ value_json.moon_phase }}', smT, { icon: 'mdi:moon-waning-crescent' });
	addSensor('moonrise', 'Lever de lune', '{{ value_json.moonrise }}', smT, { icon: 'mdi:weather-night' });
	addSensor('moonset', 'Coucher de lune', '{{ value_json.moonset }}', smT, { icon: 'mdi:weather-night' });

	addBinary('vigilance', 'Vigilance', '{{ value_json.active | string | lower }}', alT, {
		device_class: 'safety', icon: 'mdi:weather-lightning-rainy',
	});
	addSensor('vigilance_text', 'Vigilance texte', '{{ value_json.text if value_json.text else "" }}', alT, { icon: 'mdi:alert-outline' });
}

// ---------- main loop ---------- //
async function sleep(sec: number) {
	return new Promise((r) => setTimeout(r, sec * 1000));
}

async function main() {
	try {
		client = mqtt.connect(mqttUri);
		client.on('connect', () => console.log('Connected to MQTT:', mqttUri.replace(/:[^:@]+@/, ':*****@')));
		client.on('error', (e) => console.error('MQTT error:', e));

		await new Promise<void>((resolve) => {
			if (client!.connected) return resolve();
			client!.once('connect', () => resolve());
		});

		const mainLoop = async () => {
			const started = Date.now();
			console.log(`Cycle starting — ${locations.length} location(s), ${cityDelay}s between, ${scanInterval}s cycle`);
			for (let i = 0; i < locations.length; i++) {
				const slug = locations[i];
				try {
					await scanLocation(slug);
				} catch (e) {
					console.error(`Scan error on ${slug}:`, e);
				}
				if (i < locations.length - 1 && cityDelay > 0) {
					console.debug(`Sleeping ${cityDelay}s before next location…`);
					await sleep(cityDelay);
				}
			}
			const elapsed = Math.floor((Date.now() - started) / 1000);
			const wait = Math.max(5, scanInterval - elapsed);
			console.log(`Cycle done in ${elapsed}s, sleeping ${wait}s`);
			await sleep(wait);
			mainLoop();
		};

		mainLoop();
	} catch (e) {
		console.error('Fatal:', e);
	}
}

main();

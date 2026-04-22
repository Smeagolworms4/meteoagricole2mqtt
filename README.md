# La Météo Agricole 2 MQTT

[![pipeline status](https://github.com/Smeagolworms4/meteoagricole2mqtt/actions/workflows/build_images.yml/badge.svg)](https://github.com/Smeagolworms4/meteoagricole2mqtt/actions/workflows/build_images.yml)

[!["Buy Me A Coffee"](https://raw.githubusercontent.com/Smeagolworms4/donate-assets/master/coffee.png)](https://www.buymeacoffee.com/smeagolworms4)
[!["Buy Me A Coffee"](https://raw.githubusercontent.com/Smeagolworms4/donate-assets/master/paypal.png)](https://www.paypal.com/donate/?business=SURRPGEXF4YVU&no_recurring=0&item_name=Hello%2C+I%27m+SmeagolWorms4.+For+my+open+source+projects.%0AThanks+you+very+mutch+%21%21%21&currency_code=EUR)

Scrape [lameteoagricole.net](https://www.lameteoagricole.net/) and publish the data to MQTT with Home Assistant auto-discovery (weather entity + agri sensors).

## Usage

Pull repository

```bash
docker pull smeagolworms4/meteoagricole2mqtt
```

Run container:

```bash
docker run -ti \
    -e MQTT_URI=mqtt://login:password@192.168.1.100 \
    -e LOCATIONS=Saint-Etienne-42000,Paris-75001 \
    smeagolworms4/meteoagricole2mqtt
```

## Environment variables

```
ENV MQTT_URI=                       #Required
ENV LOCATIONS=                      #Required (comma-separated Town-Zip slugs)
ENV SCAN_INTERVAL=300
ENV CITY_DELAY=30
ENV DEBUG=MESSAGE
ENV MQTT_PREFIX=meteoagricole
ENV MQTT_RETAIN=1
ENV MQTT_QOS=0
ENV HA_DISCOVERY=1
ENV HA_PREFIX=homeassistant
```

## Weather entity (template)

Home Assistant does **not** support the `weather` platform via MQTT discovery — only `sensor`, `binary_sensor`, `switch`, `light`, etc. So this addon publishes every field as an MQTT sensor and you assemble a `weather` entity in `configuration.yaml` using the built-in `template` integration. Three-step procedure:

### 1. Find the entity IDs your addon created

Once the addon is running, open **Dev Tools → States** and filter `meteoagricole_` — you'll see entities like:

```
sensor.meteoagricole_<slug>_condition            (HA condition code: sunny / rainy / …)
sensor.meteoagricole_<slug>_temperature          (°C)
sensor.meteoagricole_<slug>_humidity             (%)
sensor.meteoagricole_<slug>_pressure             (hPa)
sensor.meteoagricole_<slug>_wind_speed           (km/h)
sensor.meteoagricole_<slug>_wind_bearing         (°)
sensor.meteoagricole_<slug>_dew_point            (°C)
sensor.meteoagricole_<slug>_cloud_coverage       (%)
sensor.meteoagricole_<slug>_apparent_temperature (°C)
sensor.meteoagricole_<slug>_forecast_daily       (state=count, attribute forecast=daily array)
sensor.meteoagricole_<slug>_forecast_hourly      (state=count, attribute forecast=hourly array)
```

`<slug>` is the town + zip lowercased with non-alphanum replaced by `_`, e.g. `saint_etienne_42000`, `lyon_69001`, `aix_en_provence_13100`.

### 2. Add this block to `configuration.yaml`

Replace `saint_etienne_42000` by your actual slug:

```yaml
template:
  - weather:
      - name: "MétéoAgricole Saint-Etienne"
        condition_template: "{{ states('sensor.meteoagricole_saint_etienne_42000_condition') }}"
        temperature_template: "{{ states('sensor.meteoagricole_saint_etienne_42000_temperature') | float(0) }}"
        temperature_unit: "°C"
        humidity_template: "{{ states('sensor.meteoagricole_saint_etienne_42000_humidity') | float(0) }}"
        pressure_template: "{{ states('sensor.meteoagricole_saint_etienne_42000_pressure') | float(0) }}"
        pressure_unit: "hPa"
        wind_speed_template: "{{ states('sensor.meteoagricole_saint_etienne_42000_wind_speed') | float(0) }}"
        wind_speed_unit: "km/h"
        wind_bearing_template: "{{ states('sensor.meteoagricole_saint_etienne_42000_wind_bearing') | float(0) }}"
        dew_point_template: "{{ states('sensor.meteoagricole_saint_etienne_42000_dew_point') | float(0) }}"
        cloud_coverage_template: "{{ states('sensor.meteoagricole_saint_etienne_42000_cloud_coverage') | float(0) }}"
        apparent_temperature_template: "{{ states('sensor.meteoagricole_saint_etienne_42000_apparent_temperature') | float(0) }}"
        forecast_daily_template: "{{ state_attr('sensor.meteoagricole_saint_etienne_42000_forecast_daily', 'forecast') }}"
        forecast_hourly_template: "{{ state_attr('sensor.meteoagricole_saint_etienne_42000_forecast_hourly', 'forecast') }}"
```

### 3. Reload and use

- **Dev Tools → YAML → "Template Entities"** (or restart HA) → entity `weather.meteoagricole_<town>` appears
- Use it in any weather card (native `Weather forecast`, HACS `custom:meteofrance-weather-card`, etc.)

## For Dev

Start container

```bash
make up
```

Initialize env

```bash
make init
```

Run watch

```bash
make meteoagricole2mqtt-watch
```

Run tests

```bash
npm test
```

## Docker hub

https://hub.docker.com/r/smeagolworms4/meteoagricole2mqtt

## Github

https://github.com/Smeagolworms4/meteoagricole2mqtt


## Home Assistant Addon

https://github.com/GollumDom/addon-repository

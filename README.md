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

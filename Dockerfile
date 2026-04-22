# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY src /app/src
COPY tsconfig.json package.json /app/
COPY package-lock.json* /app/
RUN npm install && npm run build

# Runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

ENV MQTT_URI=
ENV LOCATIONS=
ENV DEBUG=MESSAGE
ENV SCAN_INTERVAL=300
ENV CITY_DELAY=30
ENV MQTT_PREFIX=meteoagricole
ENV MQTT_RETAIN=1
ENV MQTT_QOS=0
ENV HA_DISCOVERY=1
ENV HA_PREFIX=homeassistant

CMD node dist/index.js \
	-m "$MQTT_URI" \
	--locations "$LOCATIONS" \
	-l $DEBUG \
	--scan-interval $SCAN_INTERVAL \
	--city-delay $CITY_DELAY \
	--mqtt-prefix $MQTT_PREFIX \
	--mqtt-retain $MQTT_RETAIN \
	--mqtt-qos $MQTT_QOS \
	--ha-discovery $HA_DISCOVERY \
	--ha-prefix $HA_PREFIX

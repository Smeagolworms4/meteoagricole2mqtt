export DOCKER_NAME=meteoagricole2mqtt

RULE_DEP_UP=history

include .env.local

.env.local:
	@echo "Init your environment:"
	@echo ""
	@read -p "	- Enter MQTT_URI (mqtt://login:pass@host:port): " MQTT_URI; echo "MQTT_URI=$$MQTT_URI" >> .env.local
	@read -p "	- Enter LOCATIONS (ex: Saint-Etienne-42000,Paris-75001): " LOCATIONS; echo "LOCATIONS=$$LOCATIONS" >> .env.local
	@echo ""

# external resource #
export MAKEFILE_URL=https://raw.githubusercontent.com/Smeagolworms4/auto-makefile/master

# import #
$(shell [ ! -f docker/.makefiles/index.mk ] && mkdir -p docker/.makefiles && curl -L --silent -f $(MAKEFILE_URL)/docker-compose.mk -o docker/.makefiles/index.mk)
include docker/.makefiles/index.mk

# Add variable on documentation #
export MQTT_EXPLORER_PORT    ## HTTP port (default: 8080)
export DEBUG_PORT            ## HTTP port (default: 9229)


###################
# Logs containers #
###################

## Display logs `meteoagricole2mqtt`
meteoagricole2mqtt-logs:
	$(COMPOSE) logs -f meteoagricole2mqtt

######################
# Connect containers #
######################

## Connect to `meteoagricole2mqtt`
meteoagricole2mqtt-bash:
	$(COMPOSE) exec -u node meteoagricole2mqtt env $(FIX_SHELL) sh -l

## Connect to `meteoagricole2mqtt` in root
meteoagricole2mqtt-bash-root:
	$(COMPOSE) exec meteoagricole2mqtt env $(FIX_SHELL) sh -l

###############
# Development #
###############

## Init all project
init: meteoagricole2mqtt-install

## Install package for `meteoagricole2mqtt`
meteoagricole2mqtt-install:
	$(COMPOSE) exec -u node meteoagricole2mqtt env $(FIX_SHELL) npm install

## Build to `meteoagricole2mqtt`
meteoagricole2mqtt-build:
	$(COMPOSE) exec -u node meteoagricole2mqtt env $(FIX_SHELL) npm run build

## Start to `meteoagricole2mqtt` (mode production)
meteoagricole2mqtt-start:
	$(COMPOSE) exec -u node meteoagricole2mqtt env $(FIX_SHELL) npm run start

## Watch to `meteoagricole2mqtt` (mode development)
meteoagricole2mqtt-watch:
	$(COMPOSE) exec -u node meteoagricole2mqtt env $(FIX_SHELL) npm run watch

#########
# Utils #
#########

history: history_meteoagricole2mqtt

history_meteoagricole2mqtt:
	@if [ ! -f $(DOCKER_PATH)/.history_meteoagricole2mqtt ]; then touch $(DOCKER_PATH)/.history_meteoagricole2mqtt; fi

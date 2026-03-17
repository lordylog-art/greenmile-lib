var GreenmileAPI = (function () {
    var CONFIG = {
        baseUrl: 'https://3coracoes.greenmile.com',
        module: 'LIVE',
        build: '1705315',
        version: '26.0130',
        defaultAccept: 'application/json, text/plain, */*',
        batchChunkSize: 20,
        batchSleepMs: 100,
        batchMaxRetries: 3
    };

    function init(username, password) {
        GreenmileAuth.setBaseUrl(CONFIG.baseUrl);
        GreenmileAuth.init(username, password);
    }

    function initFromProperties() {
        GreenmileAuth.setBaseUrl(CONFIG.baseUrl);
        GreenmileAuth.initFromProperties();
    }

    function setBaseUrl(baseUrl) {
        if (!baseUrl) throw new Error('Informe baseUrl.');
        CONFIG.baseUrl = String(baseUrl).replace(/\/+$/, '');
        GreenmileAuth.setBaseUrl(CONFIG.baseUrl);
    }

    function setClientInfo(build, version) {
        if (build) CONFIG.build = String(build);
        if (version) CONFIG.version = String(version);
    }

    function setBatchOptions(chunkSize, sleepMs) {
        if (chunkSize !== undefined && chunkSize !== null) {
            CONFIG.batchChunkSize = Math.max(1, Number(chunkSize) || 1);
        }

        if (sleepMs !== undefined && sleepMs !== null) {
            CONFIG.batchSleepMs = Math.max(0, Number(sleepMs) || 0);
        }
    }

    function shouldRetryBatchError_(err) {
        var message = err && err.message ? String(err.message) : String(err || '');
        return /Service invoked too many times/i.test(message) ||
            /Bandwidth quota exceeded/i.test(message) ||
            /Try Utilities\.sleep/i.test(message);
    }

    function getConfig() {
        return JSON.parse(JSON.stringify(CONFIG));
    }

    function request(path, options) {
        options = options || {};

        var fetchRequest = buildFetchRequest(path, options);
        var response = UrlFetchApp.fetch(fetchRequest.url, fetchRequest.options);
        return parseResponse(path, response);
    }

    function buildFetchRequest(path, options) {
        options = options || {};

        var auth = GreenmileAuth.getAuth();
        var method = String(options.method || 'get').toLowerCase();
        var useBearer = !!options.useBearer;
        var payload = options.payload;
        var headers = options.headers || {};

        var finalHeaders = {
            'Accept': headers.Accept || CONFIG.defaultAccept,
            'Greenmile-Module': headers['Greenmile-Module'] || CONFIG.module,
            'Greenmile-Build': headers['Greenmile-Build'] || CONFIG.build,
            'Greenmile-Version': headers['Greenmile-Version'] || CONFIG.version,
            'Cookie': headers.Cookie || auth.cookie
        };

        if (useBearer && auth.token) {
            finalHeaders.Authorization = headers.Authorization || ('Bearer ' + auth.token);
        }

        Object.keys(headers).forEach(function (key) {
            finalHeaders[key] = headers[key];
        });

        var fetchOptions = {
            method: method,
            muteHttpExceptions: true,
            followRedirects: false,
            headers: finalHeaders
        };

        if (options.contentType) {
            fetchOptions.contentType = options.contentType;
        }

        if (payload !== undefined && payload !== null) {
            fetchOptions.payload =
                typeof payload === 'string' ? payload : JSON.stringify(payload);
        }

        return {
            url: CONFIG.baseUrl + path,
            path: path,
            options: fetchOptions
        };
    }

    function parseResponse(path, response) {
        var status = response.getResponseCode();
        var text = response.getContentText();

        if (status < 200 || status >= 300) {
            throw new Error('Erro Greenmile [' + path + ']: ' + status + ' - ' + text);
        }

        try {
            return JSON.parse(text);
        } catch (err) {
            return text;
        }
    }

    function requestAll(requests) {
        requests = requests || [];

        if (!requests.length) {
            Logger.log('⚪ [requestAll] Nenhuma requisicao para executar');
            return [];
        }

        var fetchRequests = requests.map(function (item) {
            var requestOptions = item.options || {};
            return buildFetchRequest(item.path, requestOptions);
        });

        var chunkSize = CONFIG.batchChunkSize || 20;
        var sleepMs = CONFIG.batchSleepMs || 0;
        var maxRetries = CONFIG.batchMaxRetries || 3;
        var parsedResponses = [];
        var totalChunks = Math.ceil(fetchRequests.length / chunkSize);

        Logger.log(
            '🚀 [requestAll] Inicio | requests=%s | chunkSize=%s | chunks=%s | sleepMs=%s',
            fetchRequests.length,
            chunkSize,
            totalChunks,
            sleepMs
        );

        for (var start = 0; start < fetchRequests.length; start += chunkSize) {
            var chunk = fetchRequests.slice(start, start + chunkSize);
            var chunkNumber = Math.floor(start / chunkSize) + 1;
            Logger.log(
                '📦 [requestAll] Chunk %s/%s | requests=%s | firstPath=%s',
                chunkNumber,
                totalChunks,
                chunk.length,
                chunk[0] && chunk[0].path ? chunk[0].path : ''
            );

            var responses;
            var attempt = 0;
            while (attempt < maxRetries) {
                attempt += 1;
                try {
                    responses = UrlFetchApp.fetchAll(chunk.map(function (item) {
                        return {
                            url: item.url,
                            method: item.options.method,
                            muteHttpExceptions: item.options.muteHttpExceptions,
                            followRedirects: item.options.followRedirects,
                            headers: item.options.headers,
                            contentType: item.options.contentType,
                            payload: item.options.payload
                        };
                    }));
                    break;
                } catch (err) {
                    var retryable = shouldRetryBatchError_(err);
                    Logger.log(
                        '⚠️ [requestAll] Falha no chunk | chunk=%s/%s | tentativa=%s/%s | retryable=%s | erro=%s',
                        chunkNumber,
                        totalChunks,
                        attempt,
                        maxRetries,
                        retryable ? 'sim' : 'nao',
                        err && err.message ? err.message : String(err)
                    );

                    if (!retryable || attempt >= maxRetries) {
                        throw err;
                    }

                    var backoffMs = sleepMs > 0 ? sleepMs * attempt : 200 * attempt;
                    Logger.log('⏳ [requestAll] Backoff antes de retry | ms=%s', backoffMs);
                    Utilities.sleep(backoffMs);
                }
            }

            responses.forEach(function (response, index) {
                parsedResponses.push(parseResponse(chunk[index].path, response));
            });

            Logger.log(
                '✅ [requestAll] Chunk %s/%s concluido | acumulado=%s/%s',
                chunkNumber,
                totalChunks,
                parsedResponses.length,
                fetchRequests.length
            );

            if (sleepMs > 0 && start + chunkSize < fetchRequests.length) {
                Logger.log('⏳ [requestAll] Pausa entre chunks | sleepMs=%s', sleepMs);
                Utilities.sleep(sleepMs);
            }
        }

        Logger.log('🏁 [requestAll] Fim | responses=%s', parsedResponses.length);

        return parsedResponses;
    }

    function normalizeMatchMode(matchMode) {
        var mode = String(matchMode || 'EXACT').toUpperCase();

        var map = {
            EXACT: 'EXACT',
            ANYWHERE: 'ANYWHERE',
            START: 'START',
            END: 'END'
        };

        if (!map[mode]) {
            throw new Error('matchMode inválido. Use EXACT, ANYWHERE, START ou END.');
        }

        return map[mode];
    }

    function buildSingleFilterCriteria(attr, value, matchMode, includeMatchMode) {
        var filter = {
            attr: String(attr),
            eq: String(value)
        };

        if (includeMatchMode !== false) {
            filter.matchMode = normalizeMatchMode(matchMode);
        }

        return {
            criteriaChain: [
                {
                    and: [filter]
                }
            ]
        };
    }

    function routeSummaryFilters() {
        return [
            'id',
            'route.driverAssignments.*',
            'route.driverAssignments.driver.id',
            'route.driverAssignments.driver.name',
            'route.driverAssignments.driver.key',
            'primaryAssignments.equipment.id',
            'primaryAssignments.equipment.key',
            'route.baseLineDeparture',
            'route.plannedDistance',
            'route.baselineSize1',
            'route.actualDistance',
            'route.plannedSize1',
            'route.actualSize1',
            'route.key',
            'route.description',
            'route.origin.id',
            'route.origin.description',
            'route.destination.id',
            'route.destination.description',
            'route.baseLineArrival',
            'route.plannedDeparture',
            'route.plannedArrival',
            'route.projectedDeparture',
            'route.projectedArrival',
            'route.actualDeparture',
            'route.actualArrival',
            'route.baseLineComplete',
            'route.plannedComplete',
            'route.projectedComplete',
            'route.actualComplete',
            'route.actualDistanceDataQuality',
            'route.actualCompleteDataQuality',
            'route.actualDepartureDataQuality',
            'route.plannedStart',
            'route.actualCost',
            'route.actualStart',
            'route.plannedCost',
            'route.baseLineCost',
            'route.id',
            'route.date',
            'route.totalStops',
            'route.canceledStops',
            'route.redeliveredStops',
            'route.actualDepartures',
            'route.organization.description',
            'route.status',
            'routePercentage',
            'stopView',
            'route.undeliveredStops',
            'totalStopsInProgress'
        ];
    }

    function routeRestrictionsFilters() {
        return [
            '*',
            'organization.id',
            'organization.description',
            'origin.*',
            'destination.*',
            'driverAssignments.*',
            'driverAssignments.driver.*',
            'equipmentAssignments.equipment.*',
            'equipmentAssignments.equipment.id',
            'equipmentAssignments.equipment.key',
            'equipmentAssignments.principal',
            'equipmentAssignments.equipment.gpsProvider.id',
            'proactiveRouteOptConfig'
        ];
    }

    function routeRestrictionsLiteFilters() {
        return [
            'id',
            'key',
            'date',
            'creationDate',
            'driverAssignments.driver.key'
        ];
    }

    function orderRestrictionsFilters() {
        return [
            '*',
            'id',
            'number',
            'lineItems.sku.id',
            'lineItems.sku.description',
            'lineItems.plannedSize1',
            'lineItems.plannedSize2',
            'lineItems.plannedSize3',
            'lineItems.actualSize1',
            'lineItems.actualSize2',
            'lineItems.actualSize3',
            'lineItems.plannedPickupSize1',
            'lineItems.plannedPickupSize2',
            'lineItems.plannedPickupSize3',
            'lineItems.actualPickupSize1',
            'lineItems.actualPickupSize2',
            'lineItems.actualPickupSize3',
            'lineItems.damagedSize1',
            'lineItems.damagedSize2',
            'lineItems.damagedSize3',
            'lineItems.deliveryReasonCode.id',
            'lineItems.deliveryReasonCode.description',
            'lineItems.overReasonCode.id',
            'lineItems.overReasonCode.description',
            'lineItems.shortReasonCode.id',
            'lineItems.shortReasonCode.description',
            'lineItems.damagedReasonCode.id',
            'lineItems.damagedReasonCode.description',
            'lineItems.pickupReasonCode.id',
            'lineItems.pickupReasonCode.description',
            'lineItems.lineItemID'
        ];
    }

    function stopViewRestrictionsFilters() {
        return [
            'id',
            '*',
            'stop.*',
            'stop.location.*',
            'stop.location.locationType.*',
            'stop.stopType.*',
            'stop.cancelCode.*',
            'stop.redeliveryStop.*',
            'stop.redeliveryStop.location.key*',
            'stop.undeliverableCode.*',
            'route.origLatitude',
            'route.origLongitude',
            'route.destLatitude',
            'route.destLongitude',
            'route.origin.*',
            'route.destination.*',
            'route.organization.id',
            'route.proactiveRouteOptConfig'
        ];
    }

    function extractRows(data) {
        return Array.isArray(data) ? data : (data && (data.content || data.rows || data.items) || []);
    }

    function firstRow(data) {
        return extractRows(data)[0] || null;
    }

    function firstDefined() {
        for (var i = 0; i < arguments.length; i += 1) {
            var value = arguments[i];
            if (value !== undefined && value !== null && value !== '') {
                return value;
            }
        }

        return null;
    }

    function normalizeStopsFromRoute(summaryRow, routeDetails) {
        var routeStops =
            (routeDetails && (routeDetails.stopView || routeDetails.stopViews)) ||
            (summaryRow && (summaryRow.stopView || summaryRow.stopViews)) ||
            [];

        return routeStops.map(function (item) {
            if (item && item.stop) {
                return item.stop;
            }

            return item;
        });
    }

    function buildStopContext(stop, detail) {
        var location = firstDefined(
            detail && detail.location,
            stop && stop.location,
            detail && detail.stop && detail.stop.location,
            stop && stop.customer,
            detail && detail.customer
        ) || {};

        var locationId = firstDefined(
            location.id,
            stop && stop.locationId,
            detail && detail.locationId
        );

        var locationKey = firstDefined(
            location.key,
            location.alternativeKey,
            stop && stop.locationKey,
            detail && detail.locationKey,
            stop && stop.key,
            detail && detail.stop && detail.stop.key
        );

        var locationName = firstDefined(
            location.description,
            location.name,
            stop && stop.description,
            detail && detail.description
        );

        return {
            location: location,
            locationId: locationId,
            locationKey: locationKey,
            locationName: locationName,
            signatureTarget: firstDefined(
                locationKey,
                stop && stop.key,
                detail && detail.stop && detail.stop.key,
                stop && stop.id
            )
        };
    }

    function searchRouteSummary(options) {
        options = options || {};

        var attr = options.attr || 'route.key';
        var value = options.value;
        var matchMode = options.matchMode || 'EXACT';
        var firstResult = options.firstResult || 0;
        var maxResults = options.maxResults || 50;
        var sort = options.sort || [{ attr: 'route.date', type: 'DESC' }];
        var filters = options.filters || routeSummaryFilters();

        var criteriaQuery = {
            filters: filters,
            firstResult: firstResult,
            maxResults: maxResults
        };

        var body = value === undefined || value === null || value === ''
            ? { sort: sort }
            : Object.assign(
                { sort: sort },
                buildSingleFilterCriteria(attr, value, matchMode, true)
            );

        return request(
            '/RouteView/Summary?criteria=' + encodeURIComponent(JSON.stringify(criteriaQuery)),
            {
                method: 'post',
                contentType: 'application/json;charset=UTF-8',
                payload: body
            }
        );
    }

    function searchRoutes(options) {
        return searchRouteSummary(options);
    }

    function routeViewSummary(routeKey, maxResults) {
        return searchRouteSummary({
            attr: 'route.key',
            value: routeKey,
            matchMode: 'EXACT',
            maxResults: maxResults || 51
        });
    }

    function getRouteRestrictions(options) {
        options = options || {};

        var attr = options.attr || 'id';
        var value = options.value;
        var matchMode = options.matchMode || 'EXACT';
        var filters = options.filters || routeRestrictionsFilters();
        var sort = options.sort || [];
        var includeMatchMode = options.includeMatchMode !== false;

        var criteriaQuery = {
            filters: filters
        };

        var body = {
            sort: sort
        };

        if (value !== undefined && value !== null && value !== '') {
            body.criteriaChain = buildSingleFilterCriteria(
                attr,
                value,
                matchMode,
                includeMatchMode
            ).criteriaChain;
        }

        return request(
            '/Route/restrictions?criteria=' + encodeURIComponent(JSON.stringify(criteriaQuery)),
            {
                method: 'post',
                contentType: 'application/json;charset=UTF-8',
                payload: body
            }
        );
    }

    function getRouteRestrictionsByRouteKey(routeKey, matchMode) {
        return getRouteRestrictions({
            attr: 'key',
            value: routeKey,
            matchMode: matchMode || 'EXACT'
        });
    }

    function getRouteRestrictionsByRouteId(routeId) {
        return getRouteRestrictions({
            attr: 'id',
            value: routeId,
            matchMode: 'EXACT',
            includeMatchMode: false
        });
    }

    function getRouteRestrictionsByRouteIds(routeIds, filters) {
        var filteredRouteIds = (routeIds || []).filter(function (routeId) {
            return !!routeId;
        });

        return requestAll(filteredRouteIds.map(function (routeId) {
            var effectiveFilters = filters || routeRestrictionsFilters();
            var criteriaQuery = {
                filters: effectiveFilters
            };
            var body = {
                sort: [],
                criteriaChain: buildSingleFilterCriteria(
                    'id',
                    routeId,
                    'EXACT',
                    false
                ).criteriaChain
            };

            return {
                path: '/Route/restrictions?criteria=' + encodeURIComponent(JSON.stringify(criteriaQuery)),
                options: {
                    method: 'post',
                    contentType: 'application/json;charset=UTF-8',
                    payload: body
                }
            };
        }));
    }

    function getStopDetail(stopId) {
        if (!stopId) throw new Error('Informe stopId.');

        return request('/Stop/' + encodeURIComponent(String(stopId)) + '/Detail', {
            method: 'get',
            contentType: 'application/json;charset=utf-8'
        });
    }

    function getRouteStopSignature(routeId, stopId) {
        if (!routeId) throw new Error('Informe routeId.');
        if (!stopId) throw new Error('Informe stopId.');

        return request(
            '/Route/' + encodeURIComponent(String(routeId)) +
            '/Stop/' + encodeURIComponent(String(stopId)) +
            '/Signature',
            {
                method: 'get',
                contentType: 'application/json;charset=utf-8'
            }
        );
    }

    function getOrderRestrictions(options) {
        options = options || {};

        var attr = options.attr || 'stop.id';
        var value = options.value;
        var matchMode = options.matchMode || 'EXACT';
        var filters = options.filters || orderRestrictionsFilters();
        var sort = options.sort || [];
        var includeMatchMode = !!options.includeMatchMode;

        var criteriaQuery = {
            filters: filters
        };

        var body = {
            sort: sort
        };

        if (value !== undefined && value !== null && value !== '') {
            body.criteriaChain = buildSingleFilterCriteria(
                attr,
                value,
                matchMode,
                includeMatchMode
            ).criteriaChain;
        }

        return request(
            '/Order/restrictions?criteria=' + encodeURIComponent(JSON.stringify(criteriaQuery)),
            {
                method: 'post',
                contentType: 'application/json;charset=UTF-8',
                payload: body
            }
        );
    }

    function getOrdersByStopId(stopId) {
        if (!stopId) throw new Error('Informe stopId.');

        return getOrderRestrictions({
            attr: 'stop.id',
            value: stopId,
            matchMode: 'EXACT',
            includeMatchMode: false
        });
    }

    function getOrdersByStopIds(stopIds) {
        var filteredStopIds = (stopIds || []).filter(function (stopId) {
            return !!stopId;
        });

        return requestAll(filteredStopIds.map(function (stopId) {
            var options = {
                attr: 'stop.id',
                value: stopId,
                matchMode: 'EXACT',
                includeMatchMode: false
            };

            var attr = options.attr;
            var value = options.value;
            var matchMode = options.matchMode || 'EXACT';
            var filters = options.filters || orderRestrictionsFilters();
            var sort = options.sort || [];
            var includeMatchMode = !!options.includeMatchMode;
            var criteriaQuery = {
                filters: filters
            };
            var body = {
                sort: sort
            };

            body.criteriaChain = buildSingleFilterCriteria(
                attr,
                value,
                matchMode,
                includeMatchMode
            ).criteriaChain;

            return {
                path: '/Order/restrictions?criteria=' + encodeURIComponent(JSON.stringify(criteriaQuery)),
                options: {
                    method: 'post',
                    contentType: 'application/json;charset=UTF-8',
                    payload: body
                }
            };
        }));
    }

    function getStopDetails(stopIds) {
        var filteredStopIds = (stopIds || []).filter(function (stopId) {
            return !!stopId;
        });

        return requestAll(filteredStopIds.map(function (stopId) {
            return {
                path: '/Stop/' + encodeURIComponent(String(stopId)) + '/Detail',
                options: {
                    method: 'get',
                    contentType: 'application/json;charset=utf-8'
                }
            };
        }));
    }

    function getStopViewsByRouteIds(routeIds, options) {
        options = options || {};

        var filteredRouteIds = (routeIds || []).filter(function (routeId) {
            return !!routeId;
        });
        var filters = options.filters || stopViewRestrictionsFilters();
        var including = options.including || ['geofence'];
        var sort = options.sort || [{ attr: 'stop.plannedSequenceNum', type: 'ASC' }];

        return requestAll(filteredRouteIds.map(function (routeId) {
            var criteriaQuery = {
                filters: filters
            };

            if (including && including.length) {
                criteriaQuery.including = including;
            }

            var body = {
                criteriaChain: buildSingleFilterCriteria(
                    'route.id',
                    routeId,
                    'EXACT',
                    false
                ).criteriaChain,
                sort: sort
            };

            return {
                path: '/StopView/restrictions?criteria=' + encodeURIComponent(JSON.stringify(criteriaQuery)),
                options: {
                    method: 'post',
                    contentType: 'application/json;charset=UTF-8',
                    payload: body
                }
            };
        }));
    }

    function getRouteStopSignatures(routeId, stopKeysOrIds) {
        if (!routeId) throw new Error('Informe routeId.');

        var filteredStops = (stopKeysOrIds || []).filter(function (value) {
            return !!value;
        });

        return requestAll(filteredStops.map(function (value) {
            return {
                path: '/Route/' + encodeURIComponent(String(routeId)) +
                    '/Stop/' + encodeURIComponent(String(value)) +
                    '/Signature',
                options: {
                    method: 'get',
                    contentType: 'application/json;charset=utf-8'
                }
            };
        }));
    }

    function getOrdersByNumber(orderNumber, matchMode) {
        if (!orderNumber) throw new Error('Informe orderNumber.');

        return getOrderRestrictions({
            attr: 'number',
            value: orderNumber,
            matchMode: matchMode || 'EXACT',
            includeMatchMode: true
        });
    }

    function getOrdersById(orderId) {
        if (!orderId) throw new Error('Informe orderId.');

        return getOrderRestrictions({
            attr: 'id',
            value: orderId,
            matchMode: 'EXACT',
            includeMatchMode: false
        });
    }

    function getRandomRoutesByPrefix(prefix, quantidade, maxResults) {
        quantidade = quantidade || 10;
        maxResults = maxResults || 200;

        var data = searchRouteSummary({
            filters: ['id', 'route.key', 'route.description', 'route.date', 'route.status'],
            firstResult: 0,
            maxResults: maxResults
        });

        var rows = Array.isArray(data) ? data : (data.content || data.rows || data.items || []);

        var filtradas = rows.filter(function (item) {
            var key = item && item.route && item.route.key ? String(item.route.key) : '';
            return key.indexOf(String(prefix)) === 0;
        });

        filtradas.sort(function () {
            return Math.random() - 0.5;
        });

        return filtradas.slice(0, quantidade);
    }

    function getRouteBundleByKey(routeKey, options) {
        if (!routeKey) throw new Error('Informe routeKey.');

        options = options || {};

        var includeStopDetails = options.includeStopDetails !== false;
        var includeOrders = options.includeOrders !== false;
        var includeSignatures = !!options.includeSignatures;
        var maxResults = options.maxResults || 1;

        var summaryResponse = routeViewSummary(routeKey, maxResults);
        var summaryRow = firstRow(summaryResponse);

        if (!summaryRow || !summaryRow.route || !summaryRow.route.id) {
            throw new Error('Rota não encontrada para a route.key informada.');
        }

        var routeId = summaryRow.route.id;
        var routeDetailsResponse = getRouteRestrictionsByRouteId(routeId);
        var routeDetails = firstRow(routeDetailsResponse);
        var stops = [];

        try {
            stops = extractRows(getStopViewsByRouteIds([routeId])[0]).map(function (item) {
                return item && item.stop ? item.stop : item;
            });
        } catch (err) {
            Logger.log('⚠️ [RouteBundle] Falha ao buscar StopView completo | routeId=%s | erro=%s', routeId, err && err.message ? err.message : String(err));
        }

        if (!stops.length) {
            stops = normalizeStopsFromRoute(summaryRow, routeDetails);
        }

        var enrichedStops = stops.map(function (stop) {
            var stopId = stop && stop.id ? stop.id : null;
            var stopKey = stop && stop.key ? stop.key : null;
            var result = {
                stop: stop
            };

            if (!stopId) {
                return result;
            }

            result.stopId = stopId;
            result.stopKey = stopKey;

            return result;
        });

        var stopsWithId = enrichedStops.filter(function (item) {
            return !!item.stopId;
        });

        if ((includeStopDetails || includeSignatures) && stopsWithId.length) {
            var detailResponses = getStopDetails(stopsWithId.map(function (item) {
                return item.stopId;
            }));

            stopsWithId.forEach(function (item, index) {
                item.detail = detailResponses[index];
            });
        }

        enrichedStops.forEach(function (item) {
            if (item.context) return;
            item.context = buildStopContext(item.stop, item.detail);
            item.location = item.context.location;
            item.locationId = item.context.locationId;
            item.locationKey = item.context.locationKey;
            item.locationName = item.context.locationName;
            item.signatureTarget = item.context.signatureTarget;
        });

        if (includeOrders && stopsWithId.length) {
            var orderResponses = getOrdersByStopIds(stopsWithId.map(function (item) {
                return item.stopId;
            }));

            stopsWithId.forEach(function (item, index) {
                item.orders = orderResponses[index];
            });
        }

        if (includeSignatures && stopsWithId.length) {
            var signatureTargets = stopsWithId
                .map(function (item) {
                    return item.signatureTarget;
                })
                .filter(function (value) {
                    return !!value;
                });

            if (signatureTargets.length) {
                try {
                    var signatureResponses = getRouteStopSignatures(routeId, signatureTargets);
                    var signatureIndex = 0;

                    stopsWithId.forEach(function (item) {
                        if (!item.signatureTarget) return;
                        item.signature = signatureResponses[signatureIndex];
                        signatureIndex += 1;
                    });
                } catch (err) {
                    stopsWithId.forEach(function (item) {
                        if (!item.signatureTarget) return;

                        try {
                            item.signature = getRouteStopSignature(routeId, item.signatureTarget);
                        } catch (fallbackErr) {
                            item.signatureError = fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr);
                        }
                    });
                }
            }
        }

        return {
            routeKey: summaryRow.route.key,
            routeId: routeId,
            summary: summaryRow,
            routeDetails: routeDetails,
            stops: enrichedStops
        };
    }

    return {
        init: init,
        initFromProperties: initFromProperties,
        setBaseUrl: setBaseUrl,
        setClientInfo: setClientInfo,
        setBatchOptions: setBatchOptions,
        getConfig: getConfig,
        request: request,

        normalizeMatchMode: normalizeMatchMode,

        searchRoutes: searchRoutes,
        searchRouteSummary: searchRouteSummary,
        routeViewSummary: routeViewSummary,
        getRouteBundleByKey: getRouteBundleByKey,
        getRandomRoutesByPrefix: getRandomRoutesByPrefix,

        getRouteRestrictions: getRouteRestrictions,
        getRouteRestrictionsByRouteKey: getRouteRestrictionsByRouteKey,
        getRouteRestrictionsByRouteId: getRouteRestrictionsByRouteId,
        getRouteRestrictionsByRouteIds: getRouteRestrictionsByRouteIds,

        getStopDetail: getStopDetail,
        getStopDetails: getStopDetails,
        getStopViewsByRouteIds: getStopViewsByRouteIds,
        getRouteStopSignature: getRouteStopSignature,
        getRouteStopSignatures: getRouteStopSignatures,

        getOrderRestrictions: getOrderRestrictions,
        getOrdersByStopId: getOrdersByStopId,
        getOrdersByStopIds: getOrdersByStopIds,
        getOrdersByNumber: getOrdersByNumber,
        getOrdersById: getOrdersById,
        requestAll: requestAll
    };
})();

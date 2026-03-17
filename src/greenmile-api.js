var GreenmileAPI = (function () {
    var CONFIG = {
        baseUrl: 'https://3coracoes.greenmile.com',
        module: 'LIVE',
        build: '1705315',
        version: '26.0130',
        defaultAccept: 'application/json, text/plain, */*'
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

    function getConfig() {
        return JSON.parse(JSON.stringify(CONFIG));
    }

    function request(path, options) {
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

        var response = UrlFetchApp.fetch(CONFIG.baseUrl + path, fetchOptions);
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

    function orderRestrictionsFilters() {
        return [
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
            matchMode: 'EXACT'
        });
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

    return {
        init: init,
        initFromProperties: initFromProperties,
        setBaseUrl: setBaseUrl,
        setClientInfo: setClientInfo,
        getConfig: getConfig,
        request: request,

        normalizeMatchMode: normalizeMatchMode,

        searchRoutes: searchRoutes,
        searchRouteSummary: searchRouteSummary,
        routeViewSummary: routeViewSummary,
        getRandomRoutesByPrefix: getRandomRoutesByPrefix,

        getRouteRestrictions: getRouteRestrictions,
        getRouteRestrictionsByRouteKey: getRouteRestrictionsByRouteKey,
        getRouteRestrictionsByRouteId: getRouteRestrictionsByRouteId,

        getStopDetail: getStopDetail,
        getRouteStopSignature: getRouteStopSignature,

        getOrderRestrictions: getOrderRestrictions,
        getOrdersByStopId: getOrdersByStopId,
        getOrdersByNumber: getOrdersByNumber,
        getOrdersById: getOrdersById
    };
})();
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

  function routeViewSummary(routeKey, maxResults) {
    maxResults = maxResults || 51;

    var criteriaQuery = {
      filters: [
        'id',
        'route.driverAssignments.*',
        'route.driverAssignments.driver.id',
        'route.driverAssignments.driver.name',
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
        'route.driverAssignments.driver.key',
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
      ],
      firstResult: 0,
      maxResults: maxResults
    };

    var body = {
      sort: [{ attr: 'route.date', type: 'DESC' }],
      criteriaChain: [
        {
          and: [
            { matchMode: 'EXACT', attr: 'route.key', eq: String(routeKey) }
          ]
        }
      ]
    };

    return request(
      '/RouteView/Summary?criteria=' + encodeURIComponent(JSON.stringify(criteriaQuery)),
      {
        method: 'post',
        contentType: 'application/json;charset=UTF-8',
        payload: body
      }
    );
  }

  return {
    init: init,
    initFromProperties: initFromProperties,
    setBaseUrl: setBaseUrl,
    setClientInfo: setClientInfo,
    request: request,
    routeViewSummary: routeViewSummary
  };
})();
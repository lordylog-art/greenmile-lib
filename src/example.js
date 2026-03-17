function exampleSetCredentials() {
  PropertiesService.getScriptProperties().setProperties({
    GREENMILE_USERNAME: 'SEU_USUARIO',
    GREENMILE_PASSWORD: 'SUA_SENHA'
  });
}

function exampleTestLogin() {
  GreenmileAuth.initFromProperties();

  var auth = GreenmileAuth.getAuth();
  Logger.log(JSON.stringify({
    cookie: auth.cookie,
    tokenPreview: auth.token ? auth.token.substring(0, 30) + '...' : '',
    expiresIn: auth.expiresIn,
    scope: auth.scope
  }, null, 2));
}

function exampleConfig() {
  GreenmileAPI.setBaseUrl('https://3coracoes.greenmile.com');
  GreenmileAPI.setClientInfo('1705315', '26.0130');

  Logger.log(JSON.stringify(GreenmileAPI.getConfig(), null, 2));
}

function exampleRouteViewSummary() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.routeViewSummary('6103019041', 10);
  Logger.log(JSON.stringify(data, null, 2));
}

function exampleGetRouteBundleByKey() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.getRouteBundleByKey('6103019041', {
    includeStopDetails: true,
    includeOrders: true,
    includeSignatures: false
  });

  Logger.log(JSON.stringify(data, null, 2));
}

function exampleRouteKeyToRouteIdFlow() {
  GreenmileAPI.initFromProperties();

  var summary = GreenmileAPI.routeViewSummary('6103019041', 1);
  var rows = Array.isArray(summary) ? summary : (summary.content || summary.rows || summary.items || []);
  var routeRow = rows[0];

  if (!routeRow || !routeRow.route || !routeRow.route.id) {
    throw new Error('Rota não encontrada para a route.key informada.');
  }

  var routeId = routeRow.route.id;
  var routeDetails = GreenmileAPI.getRouteRestrictionsByRouteId(routeId);

  Logger.log(JSON.stringify({
    routeKey: routeRow.route.key,
    routeId: routeId,
    routeDetails: routeDetails
  }, null, 2));
}

function exampleSearchRoutesByPrefix() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.searchRoutes({
    attr: 'route.key',
    value: '6103',
    matchMode: 'START',
    maxResults: 20
  });

  Logger.log(JSON.stringify(data, null, 2));
}

function exampleGetRandomRoutesByPrefix() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.getRandomRoutesByPrefix('6103', 5, 100);
  Logger.log(JSON.stringify(data, null, 2));
}

function exampleGetRouteRestrictionsByRouteKey() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.getRouteRestrictionsByRouteKey('6103019041');
  Logger.log(JSON.stringify(data, null, 2));
}

function exampleRouteKeyToStopAndOrdersFlow() {
  GreenmileAPI.initFromProperties();

  var summary = GreenmileAPI.routeViewSummary('6103019041', 1);
  var rows = Array.isArray(summary) ? summary : (summary.content || summary.rows || summary.items || []);
  var routeRow = rows[0];

  if (!routeRow || !routeRow.route || !routeRow.route.id) {
    throw new Error('Rota não encontrada para a route.key informada.');
  }

  var routeId = routeRow.route.id;
  var routeDetails = GreenmileAPI.getRouteRestrictionsByRouteId(routeId);
  var detailedRows = Array.isArray(routeDetails) ? routeDetails : (routeDetails.content || routeDetails.rows || routeDetails.items || []);
  var detailedRoute = detailedRows[0] || {};
  var stops = detailedRoute.stopView || [];
  var firstStop = stops[0];

  if (!firstStop || !firstStop.id) {
    throw new Error('Nenhum stop.id encontrado para a rota informada.');
  }

  var stopId = firstStop.id;
  var stopDetail = GreenmileAPI.getStopDetail(stopId);
  var orders = GreenmileAPI.getOrdersByStopId(stopId);

  Logger.log(JSON.stringify({
    routeKey: routeRow.route.key,
    routeId: routeId,
    stopId: stopId,
    stopDetail: stopDetail,
    orders: orders
  }, null, 2));
}

function exampleGetStopDetail() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.getStopDetail('STOP_ID');
  Logger.log(JSON.stringify(data, null, 2));
}

function exampleGetRouteStopSignature() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.getRouteStopSignature('ROUTE_ID', 'STOP_ID');
  Logger.log(JSON.stringify(data, null, 2));
}

function exampleGetOrdersByStopId() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.getOrdersByStopId('STOP_ID');
  Logger.log(JSON.stringify(data, null, 2));
}

function exampleGetOrdersByNumber() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.getOrdersByNumber('123456', 'EXACT');
  Logger.log(JSON.stringify(data, null, 2));
}

function exampleRawRequest() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.request('/RouteView/Summary?criteria=' + encodeURIComponent(JSON.stringify({
    filters: ['id', 'route.key'],
    firstResult: 0,
    maxResults: 5
  })), {
    method: 'post',
    contentType: 'application/json;charset=UTF-8',
    payload: {
      sort: [{ attr: 'route.date', type: 'DESC' }]
    }
  });

  Logger.log(JSON.stringify(data, null, 2));
}

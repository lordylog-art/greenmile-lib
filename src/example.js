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

function exampleRouteViewSummary() {
  GreenmileAPI.initFromProperties();

  var data = GreenmileAPI.routeViewSummary('6103019041', 10);
  Logger.log(JSON.stringify(data, null, 2));
}
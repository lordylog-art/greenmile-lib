// greenmile-auth.js
var GreenmileAuth = (function () {
  var CONFIG = {
    baseUrl: 'https://3coracoes.greenmile.com',
    module: 'LIVE'
  };

  var _credentials = null;

  function init(username, password) {
    if (!username || !password) {
      throw new Error('Informe usuário e senha.');
    }

    _credentials = {
      username: String(username),
      password: String(password)
    };
  }

  function initFromProperties() {
    var props = PropertiesService.getScriptProperties();
    var username = props.getProperty('GREENMILE_USERNAME');
    var password = props.getProperty('GREENMILE_PASSWORD');

    if (!username || !password) {
      throw new Error(
        'Credenciais não encontradas em Script Properties. Configure GREENMILE_USERNAME e GREENMILE_PASSWORD.'
      );
    }

    init(username, password);
  }

  function setBaseUrl(baseUrl) {
    if (!baseUrl) throw new Error('Informe baseUrl.');
    CONFIG.baseUrl = String(baseUrl).replace(/\/+$/, '');
  }

  function getConfig() {
    return JSON.parse(JSON.stringify(CONFIG));
  }

  function ensureInit_() {
    if (!_credentials) {
      throw new Error(
        'GreenmileAuth não inicializado. Use GreenmileAuth.init(usuario, senha) ou GreenmileAuth.initFromProperties().'
      );
    }
  }

  function parseCookie_(setCookie) {
    if (!setCookie) return '';

    if (Array.isArray(setCookie)) {
      return setCookie
        .map(function (item) {
          return String(item).split(';')[0];
        })
        .join('; ');
    }

    return String(setCookie)
      .split(',')
      .map(function (item) {
        return item.split(';')[0];
      })
      .join('; ');
  }

  function loginRaw_() {
    ensureInit_();

    var payload =
      'j_username=' + encodeURIComponent(_credentials.username) +
      '&j_password=' + encodeURIComponent(_credentials.password);

    var response = UrlFetchApp.fetch(CONFIG.baseUrl + '/login', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: payload,
      muteHttpExceptions: true,
      followRedirects: false,
      headers: {
        'Accept': 'application/json, text/html, */*',
        'Greenmile-Module': CONFIG.module
      }
    });

    var status = response.getResponseCode();
    var text = response.getContentText();
    var headers = response.getAllHeaders();

    if (status !== 200) {
      throw new Error('Erro no login Greenmile: ' + status + ' - ' + text);
    }

    var json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error('Resposta de login não é JSON válido: ' + text);
    }

    var setCookie = headers['Set-Cookie'] || headers['set-cookie'] || '';
    var cookie = parseCookie_(setCookie);
    var analyticsToken = json.analyticsToken || {};

    return {
      status: status,
      cookie: cookie,
      token: analyticsToken.access_token || '',
      tokenType: analyticsToken.token_type || '',
      scope: analyticsToken.scope || '',
      expiresIn: Number(analyticsToken.expires_in || 180),
      jsessionid: json.jsessionid || '',
      targetUrl: json.targetUrl || '',
      raw: json,
      createdAt: new Date().toISOString()
    };
  }

  function getAuth() {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('GREENMILE_AUTH');

    if (cached) {
      return JSON.parse(cached);
    }

    var auth = loginRaw_();
    var ttl = Math.max(30, Math.min(auth.expiresIn - 10, 300));

    cache.put('GREENMILE_AUTH', JSON.stringify(auth), ttl);
    return auth;
  }

  function getCookie() {
    return getAuth().cookie;
  }

  function getToken() {
    return getAuth().token;
  }

  function clear() {
    CacheService.getScriptCache().remove('GREENMILE_AUTH');
  }

  return {
    init: init,
    initFromProperties: initFromProperties,
    setBaseUrl: setBaseUrl,
    getConfig: getConfig,
    getAuth: getAuth,
    getCookie: getCookie,
    getToken: getToken,
    clear: clear
  };
})();
# Greenmile Apps Script

Biblioteca para autenticar na Greenmile e consumir endpoints via Google Apps Script.

## Arquivos
- `src/greenmile-auth.js`: autenticação, cache, cookie e bearer token
- `src/greenmile-api.js`: wrapper HTTP e helpers para rotas, paradas e pedidos
- `src/example.js`: exemplos de uso

## Requisitos
- Projeto Google Apps Script
- `UrlFetchApp`, `CacheService` e `PropertiesService`
- `clasp` opcional para versionamento e deploy

## Configuração
Defina as credenciais em `Script Properties`:

- `GREENMILE_USERNAME`
- `GREENMILE_PASSWORD`

Exemplo:

```javascript
function exampleSetCredentials() {
  PropertiesService.getScriptProperties().setProperties({
    GREENMILE_USERNAME: 'SEU_USUARIO',
    GREENMILE_PASSWORD: 'SUA_SENHA'
  });
}
```

## Inicialização

Usando `Script Properties`:

```javascript
GreenmileAPI.initFromProperties();
```

Usando usuário e senha diretamente:

```javascript
GreenmileAPI.init('usuario', 'senha');
```

## Configuração opcional

Você pode trocar a base URL ou sobrescrever os metadados do cliente enviados nos headers:

```javascript
GreenmileAPI.setBaseUrl('https://empresa.greenmile.com');
GreenmileAPI.setClientInfo('1705315', '26.0130');
Logger.log(JSON.stringify(GreenmileAPI.getConfig(), null, 2));
```

## Autenticação

`GreenmileAuth.getAuth()` retorna os dados de login em cache:

```javascript
GreenmileAuth.initFromProperties();

var auth = GreenmileAuth.getAuth();
Logger.log(JSON.stringify({
  cookie: auth.cookie,
  tokenPreview: auth.token ? auth.token.substring(0, 30) + '...' : '',
  expiresIn: auth.expiresIn,
  scope: auth.scope
}, null, 2));
```

Helpers disponíveis:

- `GreenmileAuth.getAuth()`
- `GreenmileAuth.getCookie()`
- `GreenmileAuth.getToken()`
- `GreenmileAuth.clear()`

## Request genérico

Para chamar endpoints não cobertos pelos helpers:

```javascript
GreenmileAPI.initFromProperties();

var response = GreenmileAPI.request('/algum/endpoint', {
  method: 'get',
  useBearer: true,
  headers: {
    Accept: 'application/json'
  }
});
```

## Busca de rotas

Resumo de rotas:

```javascript
GreenmileAPI.initFromProperties();

var data = GreenmileAPI.searchRouteSummary({
  attr: 'route.key',
  value: '6103019041',
  matchMode: 'EXACT',
  maxResults: 10
});

Logger.log(JSON.stringify(data, null, 2));
```

Na prática, esse é o ponto de entrada mais comum. Normalmente você começa com a `route.key`, encontra a rota correspondente e extrai o `id` interno para consultar as outras telas.

Exemplo de fluxo:

```javascript
GreenmileAPI.initFromProperties();

var summary = GreenmileAPI.routeViewSummary('6103019041', 1);
var routeRow = Array.isArray(summary) ? summary[0] : (summary.content || summary.rows || summary.items || [])[0];

if (!routeRow || !routeRow.route || !routeRow.route.id) {
  throw new Error('Rota não encontrada para a route.key informada.');
}

var routeId = routeRow.route.id;
var routeKey = routeRow.route.key;

var routeDetails = GreenmileAPI.getRouteRestrictionsByRouteId(routeId);
Logger.log(JSON.stringify({
  routeKey: routeKey,
  routeId: routeId,
  routeDetails: routeDetails
}, null, 2));
```

Helpers relacionados:

- `GreenmileAPI.searchRouteSummary(options)`
- `GreenmileAPI.searchRoutes(options)`
- `GreenmileAPI.routeViewSummary(routeKey, maxResults)`
- `GreenmileAPI.getRouteBundleByKey(routeKey, options)`
- `GreenmileAPI.getRandomRoutesByPrefix(prefix, quantidade, maxResults)`

`matchMode` aceito:

- `EXACT`
- `ANYWHERE`
- `START`
- `END`

## Restrições de rota

Esses endpoints normalmente são chamados depois que você descobre o `route.id` via `routeViewSummary()` ou `searchRouteSummary()`.

```javascript
GreenmileAPI.initFromProperties();

var route = GreenmileAPI.getRouteRestrictionsByRouteKey('6103019041');
Logger.log(JSON.stringify(route, null, 2));
```

Helpers relacionados:

- `GreenmileAPI.getRouteRestrictions(options)`
- `GreenmileAPI.getRouteRestrictionsByRouteKey(routeKey, matchMode)`
- `GreenmileAPI.getRouteRestrictionsByRouteId(routeId)`

## Buscar tudo pela route.key

Se você quer pesquisar uma `route.key` e já receber o pacote completo da rota, use:

```javascript
GreenmileAPI.initFromProperties();

var data = GreenmileAPI.getRouteBundleByKey('6103019041', {
  includeStopDetails: true,
  includeOrders: true,
  includeSignatures: false
});

Logger.log(JSON.stringify(data, null, 2));
```

Retorno:

- `routeKey`
- `routeId`
- `summary`
- `routeDetails`
- `stops[]`

Cada item de `stops[]` pode conter:

- `stop`
- `stopId`
- `detail`
- `orders`
- `signature`

Opções:

- `includeStopDetails`: padrão `true`
- `includeOrders`: padrão `true`
- `includeSignatures`: padrão `false`
- `maxResults`: padrão `1`

Observação: esse helper faz múltiplas chamadas HTTP. Se a rota tiver muitos stops, o custo aumenta porque ele consulta cada `stop.id` individualmente.

## Paradas

Para consultar detalhes da parada ou assinatura, você precisa do `stop.id`. Esse ID normalmente vem dos dados detalhados da rota.

Fluxo comum:

1. Buscar a rota pela `route.key`
2. Extrair o `route.id`
3. Consultar a rota detalhada
4. Extrair o `stop.id`
5. Chamar `getStopDetail()` ou `getRouteStopSignature()`

```javascript
GreenmileAPI.initFromProperties();

var stop = GreenmileAPI.getStopDetail('STOP_ID');
Logger.log(JSON.stringify(stop, null, 2));
```

Assinatura da parada:

```javascript
var signature = GreenmileAPI.getRouteStopSignature('ROUTE_ID', 'STOP_ID');
Logger.log(JSON.stringify(signature, null, 2));
```

## Pedidos

Pedidos seguem a mesma lógica: na maioria dos casos você chega neles a partir de um `stop.id` obtido na rota detalhada.

Por `stop.id`:

```javascript
GreenmileAPI.initFromProperties();

var orders = GreenmileAPI.getOrdersByStopId('STOP_ID');
Logger.log(JSON.stringify(orders, null, 2));
```

Por número do pedido:

```javascript
var order = GreenmileAPI.getOrdersByNumber('123456', 'EXACT');
Logger.log(JSON.stringify(order, null, 2));
```

Helpers relacionados:

- `GreenmileAPI.getOrderRestrictions(options)`
- `GreenmileAPI.getOrdersByStopId(stopId)`
- `GreenmileAPI.getOrdersByNumber(orderNumber, matchMode)`
- `GreenmileAPI.getOrdersById(orderId)`

## Observações

- A autenticação é armazenada em cache com TTL curto baseado no `expiresIn`.
- `GreenmileAPI.request()` lança erro para qualquer resposta fora da faixa `2xx`.
- Respostas JSON são convertidas automaticamente; outros formatos são retornados como texto.

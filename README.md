# Greenmile Apps Script

Biblioteca simples para autenticação e chamadas à Greenmile via Google Apps Script.

## Arquivos
- `greenmile-auth.js`: login, cookie, token e cache
- `greenmile-api.js`: wrapper de requests e exemplo com `RouteView/Summary`
- `examples.js`: exemplos de uso

## Requisitos
- Node.js
- `clasp`
- Projeto Apps Script

## Configuração
Defina as credenciais em Script Properties:

- `GREENMILE_USERNAME`
- `GREENMILE_PASSWORD`

Você pode usar a função:

```javascript
function exampleSetCredentials() {
  PropertiesService.getScriptProperties().setProperties({
    GREENMILE_USERNAME: 'SEU_USUARIO',
    GREENMILE_PASSWORD: 'SUA_SENHA'
  });
}
const { loadGasRuntime } = require('./helpers/gas-runtime');
const { createGasGlobals, createResponse } = require('./helpers/gas-mocks');

describe('GreenmileAuth', () => {
  let runtime;
  let mocks;
  let GreenmileAuth;

  beforeEach(() => {
    mocks = createGasGlobals();
    runtime = loadGasRuntime({
      files: ['src/greenmile-auth.js'],
      globals: mocks.globals
    });
    GreenmileAuth = runtime.GreenmileAuth;
  });

  test('requires explicit credentials during init', () => {
    expect(() => GreenmileAuth.init('', 'secret')).toThrow(/Informe usuário e senha/i);
    expect(() => GreenmileAuth.init('user', '')).toThrow(/Informe usuário e senha/i);
  });

  test('loads credentials from Script Properties', () => {
    mocks.scriptProperties.setProperties({
      GREENMILE_USERNAME: 'tester',
      GREENMILE_PASSWORD: '123'
    });

    mocks.globals.UrlFetchApp.fetch = () => createResponse({
      body: JSON.stringify({
        analyticsToken: {
          access_token: 'token-1',
          token_type: 'Bearer',
          expires_in: 180
        }
      }),
      headers: {
        'Set-Cookie': ['JSESSIONID=abc123; Path=/', 'XSRF=xyz; Path=/']
      }
    });

    GreenmileAuth.initFromProperties();
    const auth = GreenmileAuth.getAuth();

    expect(auth.token).toBe('token-1');
    expect(auth.cookie).toBe('JSESSIONID=abc123; XSRF=xyz');
  });

  test('returns cached auth without performing a new login', () => {
    mocks.cache.values.set('GREENMILE_AUTH', JSON.stringify({
      cookie: 'cached-cookie',
      token: 'cached-token'
    }));

    const auth = GreenmileAuth.getAuth();

    expect(auth).toEqual({
      cookie: 'cached-cookie',
      token: 'cached-token'
    });
    expect(mocks.fetchCalls).toHaveLength(0);
  });

  test('stores auth in cache with bounded ttl', () => {
    GreenmileAuth.init('user', 'secret');

    mocks.globals.UrlFetchApp.fetch = () => createResponse({
      body: JSON.stringify({
        analyticsToken: {
          access_token: 'token-2',
          token_type: 'Bearer',
          expires_in: 600
        }
      }),
      headers: {
        'Set-Cookie': 'JSESSIONID=abc123; Path=/, ROUTE=xyz; Path=/'
      }
    });

    const auth = GreenmileAuth.getAuth();

    expect(auth.cookie).toBe('JSESSIONID=abc123;  ROUTE=xyz');
    expect(mocks.cache.puts).toHaveLength(1);
    expect(mocks.cache.puts[0].ttl).toBe(300);
  });

  test('throws when login returns a non-200 status', () => {
    GreenmileAuth.init('user', 'secret');

    mocks.globals.UrlFetchApp.fetch = () => createResponse({
      status: 401,
      body: 'unauthorized'
    });

    expect(() => GreenmileAuth.getAuth()).toThrow(/Erro no login Greenmile: 401 - unauthorized/);
  });

  test('clears cached auth', () => {
    GreenmileAuth.clear();
    expect(mocks.cache.removals).toEqual(['GREENMILE_AUTH']);
  });
});

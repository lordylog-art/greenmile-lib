const { loadGasRuntime } = require('./helpers/gas-runtime');
const { createGasGlobals, createResponse } = require('./helpers/gas-mocks');

describe('GreenmileAPI', () => {
  let runtime;
  let mocks;
  let GreenmileAuth;
  let GreenmileAPI;

  beforeEach(() => {
    mocks = createGasGlobals();
    runtime = loadGasRuntime({
      globals: mocks.globals
    });
    GreenmileAuth = runtime.GreenmileAuth;
    GreenmileAPI = runtime.GreenmileAPI;

    mocks.cache.values.set('GREENMILE_AUTH', JSON.stringify({
      cookie: 'cookie-123',
      token: 'token-abc'
    }));
  });

  test('builds request headers using cookie and bearer token', () => {
    mocks.fetchQueue.push(createResponse({
      body: JSON.stringify({ ok: true })
    }));

    const response = GreenmileAPI.request('/orders', {
      method: 'post',
      useBearer: true,
      contentType: 'application/json',
      payload: { id: 1 }
    });

    expect(response).toEqual({ ok: true });
    expect(mocks.fetchCalls).toHaveLength(1);
    expect(mocks.fetchCalls[0].url).toBe('https://3coracoes.greenmile.com/orders');
    expect(mocks.fetchCalls[0].options.headers.Cookie).toBe('cookie-123');
    expect(mocks.fetchCalls[0].options.headers.Authorization).toBe('Bearer token-abc');
    expect(mocks.fetchCalls[0].options.payload).toBe(JSON.stringify({ id: 1 }));
  });

  test('throws on non-2xx responses', () => {
    mocks.fetchQueue.push(createResponse({
      status: 500,
      body: 'server-error'
    }));

    expect(() => GreenmileAPI.request('/broken')).toThrow(/Erro Greenmile \[\/broken\]: 500 - server-error/);
  });

  test('normalizes allowed match modes and rejects invalid values', () => {
    expect(GreenmileAPI.normalizeMatchMode('start')).toBe('START');
    expect(() => GreenmileAPI.normalizeMatchMode('contains')).toThrow(/matchMode inválido/i);
  });

  test('searchRouteSummary sends encoded criteria and body filters', () => {
    mocks.fetchQueue.push(createResponse({
      body: JSON.stringify({ content: [] })
    }));

    GreenmileAPI.searchRouteSummary({
      attr: 'route.key',
      value: '6103019041',
      matchMode: 'EXACT',
      maxResults: 10
    });

    const request = mocks.fetchCalls[0];
    expect(request.url).toContain('/RouteView/Summary?criteria=');

    const criteria = JSON.parse(decodeURIComponent(request.url.split('criteria=')[1]));
    const payload = JSON.parse(request.options.payload);

    expect(criteria.maxResults).toBe(10);
    expect(payload.criteriaChain[0].and[0]).toEqual({
      attr: 'route.key',
      eq: '6103019041',
      matchMode: 'EXACT'
    });
  });

  test('requestAll retries retryable batch errors with backoff', () => {
    mocks.globals.UrlFetchApp.fetchAll = (() => {
      let callCount = 0;
      return () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('Service invoked too many times in a short time');
        }

        return [
          createResponse({ body: JSON.stringify({ ok: 1 }) }),
          createResponse({ body: JSON.stringify({ ok: 2 }) })
        ];
      };
    })();

    const responses = GreenmileAPI.requestAll([
      { path: '/a', options: { method: 'get' } },
      { path: '/b', options: { method: 'get' } }
    ]);

    expect(responses).toEqual([{ ok: 1 }, { ok: 2 }]);
    expect(mocks.sleeps).toContain(100);
  });

  test('getRouteBundleByKey aggregates route, stops, orders and signatures', () => {
    mocks.fetchQueue.push(
      createResponse({
        body: JSON.stringify({
          content: [{ route: { id: 'route-1', key: 'RK-1' } }]
        })
      }),
      createResponse({
        body: JSON.stringify({
          content: [{ id: 'route-1', status: 'COMPLETED' }]
        })
      })
    );

    mocks.globals.UrlFetchApp.fetchAll = (requests) => {
      const firstUrl = requests[0].url;

      if (firstUrl.includes('/StopView/restrictions')) {
        return [
          createResponse({
            body: JSON.stringify({
              content: [
                { stop: { id: 'stop-1', key: 'S1', description: 'Cliente 1' } },
                { stop: { id: 'stop-2', key: 'S2', description: 'Cliente 2' } }
              ]
            })
          })
        ];
      }

      if (firstUrl.includes('/Route/route-1/Stop/')) {
        return [
          createResponse({ body: JSON.stringify({ signed: true }) }),
          createResponse({ body: JSON.stringify({ signed: false }) })
        ];
      }

      if (firstUrl.includes('/Stop/')) {
        return [
          createResponse({
            body: JSON.stringify({ id: 'stop-1', location: { id: 'loc-1', key: 'LOC-1', description: 'Cliente 1' } })
          }),
          createResponse({
            body: JSON.stringify({ id: 'stop-2', location: { id: 'loc-2', key: 'LOC-2', description: 'Cliente 2' } })
          })
        ];
      }

      if (firstUrl.includes('/Order/restrictions')) {
        return [
          createResponse({ body: JSON.stringify([{ id: 'order-1' }]) }),
          createResponse({ body: JSON.stringify([{ id: 'order-2' }]) })
        ];
      }

      throw new Error(`Unexpected fetchAll batch for ${firstUrl}`);
    };

    const bundle = GreenmileAPI.getRouteBundleByKey('RK-1', {
      includeStopDetails: true,
      includeOrders: true,
      includeSignatures: true
    });

    expect(bundle.routeId).toBe('route-1');
    expect(bundle.stops).toHaveLength(2);
    expect(bundle.stops[0].detail.location.key).toBe('LOC-1');
    expect(bundle.stops[0].orders).toEqual([{ id: 'order-1' }]);
    expect(bundle.stops[0].signature).toEqual({ signed: true });
    expect(bundle.stops[1].signature).toEqual({ signed: false });
  });

  test('setBaseUrl updates auth and request targets', () => {
    GreenmileAPI.setBaseUrl('https://tenant.greenmile.com/');
    mocks.fetchQueue.push(createResponse({
      body: JSON.stringify({ ok: true })
    }));

    GreenmileAPI.request('/ping');

    expect(GreenmileAPI.getConfig().baseUrl).toBe('https://tenant.greenmile.com');
    expect(GreenmileAuth.getConfig().baseUrl).toBe('https://tenant.greenmile.com');
    expect(mocks.fetchCalls[0].url).toBe('https://tenant.greenmile.com/ping');
  });
});

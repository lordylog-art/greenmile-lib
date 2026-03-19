const { loadGasRuntime } = require('./helpers/gas-runtime');

function createDashboardGlobals(options = {}) {
  const sheets = options.sheets || {
    route_batch_routes: [
      [
        'routeKey', 'routeId', 'date', 'creationDate', 'status', 'driverKey',
        'organization.description', 'driversName', 'actualStart', 'actualArrival',
        'actualComplete', 'actualTravelTimeMinutes', 'actualServiceTime',
        'plannedTravelTimeMinutes', 'actualDistance', 'plannedDistance', 'totalStops'
      ],
      [
        'CARGA-001', 'route-1', '2026-03-18T08:00:00Z', '2026-03-18T08:00:00Z', 'COMPLETED', 'DRV-1',
        'Filial SP', '[DRV-1] Maria', '', '', '2026-03-18T20:00:00Z', 0, 0, 0, 0, 0, 2
      ],
      [
        'CARGA-002', 'route-2', '2026-03-18T09:00:00Z', '2026-03-18T09:00:00Z', 'COMPLETED', 'DRV-2',
        'Filial RJ', '[DRV-2] Joao', '', '', '2026-03-20T04:30:00Z', 0, 0, 0, 0, 0, 1
      ]
    ],
    route_batch_stops: [
      [
        'routeKey', 'routeId', 'stopId', 'stopIndex', 'driverKey', 'locationKey',
        'organization.description', 'locationName', 'deliveryStatus', 'hasSignature',
        'actualArrival', 'actualDeparture', 'actualService', 'actualServiceTime',
        'plannedSequenceNum', 'actualSequenceNum', 'signatureConformity'
      ],
      [
        'CARGA-001', 'route-1', 'stop-1', 1, 'DRV-1', 'CLI-1',
        'Filial SP', 'Cliente A', 'DELIVERED', true,
        '2026-03-18T10:00:00Z', '2026-03-18T10:15:00Z', '', 0, 1, 1, 'OK'
      ],
      [
        'CARGA-002', 'route-2', 'stop-2', 1, 'DRV-2', 'CLI-2',
        'Filial RJ', 'Cliente B', 'DELIVERED', false,
        '2026-03-18T14:00:00Z', '2026-03-18T14:20:00Z', '', 0, 1, 1, 'PENDENTE'
      ]
    ],
    route_batch_orders: [
      ['routeKey', 'routeId', 'stopId', 'creationDate', 'driverKey', 'organization.description', 'locationKey', 'locationName', 'id', 'number'],
      ['CARGA-001', 'route-1', 'stop-1', '2026-03-18T08:00:00Z', 'DRV-1', 'Filial SP', 'CLI-1', 'Cliente A', 'ord-1', 'PED-001'],
      ['CARGA-002', 'route-2', 'stop-2', '2026-03-18T09:00:00Z', 'DRV-2', 'Filial RJ', 'CLI-2', 'Cliente B', 'ord-2', 'PED-002']
    ]
  };

  return {
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createTemplateFromFile() {
        return {
          evaluate() {
            return {
              setTitle() { return this; },
              setXFrameOptionsMode() { return this; }
            };
          }
        };
      },
      createHtmlOutput() {
        return {};
      }
    },
    ScriptApp: {
      getService() {
        return {
          getUrl() {
            return 'https://example.com/exec';
          }
        };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty() {
            return '';
          }
        };
      }
    },
    SpreadsheetApp: {
      openById() {
        return {
          getSheetByName(name) {
            const values = sheets[name];
            if (!values) return null;
            return {
              getDataRange() {
                return {
                  getValues() {
                    return values;
                  }
                };
              }
            };
          }
        };
      }
    }
  };
}

describe('dashboard cycle data', () => {
  test('classifies loads inside and outside the end-of-next-day deadline', () => {
    const runtime = loadGasRuntime({
      files: ['src/dashboard-webapp.js'],
      globals: createDashboardGlobals()
    });

    const data = runtime.dashboardGetCycleData({});

    expect(data.meta.cycleSlaDaysOffset).toBe(1);
    expect(data.overview.totalLoads).toBe(2);
    expect(data.overview.withinDeadline).toBe(1);
    expect(data.overview.outsideDeadline).toBe(1);
    expect(data.overview.withinDeadlinePct).toBe(50);
    expect(data.table[0].analysisStatus).toMatch(/Fora do prazo|Dentro do prazo|Aguardando/);
    expect(data.charts.slaBreakdown).toEqual([
      { label: 'Dentro do prazo', value: 1 },
      { label: 'Fora do prazo', value: 1 }
    ]);
  });

  test('filters cycle data by client', () => {
    const runtime = loadGasRuntime({
      files: ['src/dashboard-webapp.js'],
      globals: createDashboardGlobals()
    });

    const data = runtime.dashboardGetCycleData({ clientKey: 'CLI-1' });

    expect(data.overview.totalLoads).toBe(1);
    expect(data.table).toHaveLength(1);
    expect(data.table[0].clientName).toBe('Cliente A');
    expect(data.table[0].isWithinSla).toBe(true);
  });

  test('ignores empty rows and still returns a valid payload', () => {
    const globals = createDashboardGlobals();
    const emptyRouteRow = new Array(17).fill('');
    const emptyStopRow = new Array(17).fill('');
    globals.SpreadsheetApp.openById = function openById() {
      return {
        getSheetByName(name) {
          const baseSheets = createDashboardGlobals().SpreadsheetApp.openById().getSheetByName(name);
          if (!baseSheets) return null;
          const values = baseSheets.getDataRange().getValues().slice();
          if (name === 'route_batch_routes' || name === 'route_batch_stops') {
            values.push(name === 'route_batch_routes' ? emptyRouteRow : emptyStopRow);
            values.push(name === 'route_batch_routes' ? emptyRouteRow : emptyStopRow);
          }
          return {
            getDataRange() {
              return {
                getValues() {
                  return values;
                }
              };
            }
          };
        }
      };
    };

    const runtime = loadGasRuntime({
      files: ['src/dashboard-webapp.js'],
      globals
    });

    const data = runtime.dashboardGetCycleData({});
    expect(data).toBeTruthy();
    expect(data.meta.totalRows).toBe(2);
    expect(data.overview.totalLoads).toBe(2);
    expect(data.table).toHaveLength(2);
  });

  test('throws actionable error when routes sheet has no usable rows', () => {
    const sheets = {
      route_batch_routes: [
        ['routeKey', 'routeId', 'date', 'creationDate', 'status', 'driverKey', 'organization.description', 'driversName', 'actualComplete'],
        ['', '', '', '', '', '', '', '', '']
      ],
      route_batch_stops: [
        ['routeKey', 'routeId', 'stopId', 'stopIndex', 'driverKey', 'locationKey', 'organization.description', 'locationName', 'deliveryStatus', 'hasSignature', 'actualArrival', 'actualDeparture', 'actualService', 'actualServiceTime', 'plannedSequenceNum', 'actualSequenceNum', 'signatureConformity']
      ],
      route_batch_orders: [
        ['routeKey', 'routeId', 'stopId', 'creationDate', 'driverKey', 'organization.description', 'locationKey', 'locationName', 'id', 'number']
      ]
    };

    const runtime = loadGasRuntime({
      files: ['src/dashboard-webapp.js'],
      globals: createDashboardGlobals({ sheets })
    });

    expect(() => runtime.dashboardGetCycleData({})).toThrow(/nao possui dados utilizaveis para o ciclo do pedido/i);
  });
});

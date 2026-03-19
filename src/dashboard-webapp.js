var DashboardWebApp = (function () {
  var DEFAULT_SPREADSHEET_ID = '1KP0bMo_wizr_oupyGT87m7LskoZ18LXZ4G65KlWE8FE';
  var DEFAULT_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxbxhYb1yDAuRCqa5zy1v3DtKsPXazOyr_bA5q1qDMhJM1l_JOxO414cK85PxW2d5jb/exec';
  var SIGNATURE_GOAL_PCT = 99;
  var CYCLE_SLA_DAY_OFFSET = 1;
  var DEFAULT_TRANSPORTER_NAME = 'Jetta Transportes';
  var CLIENT_FALLBACK = 'CLIENTE NAO IDENTIFICADO';
  var DRIVER_FALLBACK = 'MOTORISTA NAO IDENTIFICADO';
  var SHEETS = {
    routes: 'route_batch_routes',
    stops: 'route_batch_stops',
    orders: 'route_batch_orders'
  };
  var RUNTIME_CACHE = {
    expiresAt: 0,
    snapshot: null
  };
  var CYCLE_RUNTIME_CACHE = {
    expiresAt: 0,
    snapshot: null
  };
  var SNAPSHOT_TTL_MS = 60 * 1000;

  function render(page) {
    var view = resolvePage_(page);
    var template = HtmlService.createTemplateFromFile(view.fileName);
    template.currentPage = view.page;
    template.appUrl = resolveWebAppUrl_();
    return template
      .evaluate()
      .setTitle(view.title)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  function resolvePage_(page) {
    if (page === 'canhoto') {
      return {
        page: 'canhoto',
        fileName: 'dashboard',
        title: 'Jetta Transportes | Analise Canhoto Digital'
      };
    }

    if (page === 'ciclo-pedido') {
      return {
        page: 'ciclo-pedido',
        fileName: 'dashboard-cycle',
        title: 'Jetta Transportes | Analise Ciclo do Pedido'
      };
    }

    return {
      page: 'hub',
      fileName: 'dashboard-selector',
      title: 'Jetta Transportes | Hub de Dashboards'
    };
  }

  function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }

  function getDashboardData(filters) {
    var snapshot = getSnapshot_();
    var appliedFilters = normalizeFilters_(filters, snapshot.options);
    var filtered = applyFilters_(snapshot, appliedFilters);
    return buildAnalytics_(filtered, snapshot, appliedFilters);
  }

  function refreshDashboardCache(filters) {
    RUNTIME_CACHE.snapshot = null;
    RUNTIME_CACHE.expiresAt = 0;
    return getDashboardData(filters || {});
  }

  function getCycleDashboardData(filters) {
    var snapshot = getCycleSnapshot_();
    var appliedFilters = normalizeCycleFilters_(filters, snapshot.options);
    return buildCycleAnalytics_(snapshot, appliedFilters);
  }

  function refreshCycleDashboardCache(filters) {
    CYCLE_RUNTIME_CACHE.snapshot = null;
    CYCLE_RUNTIME_CACHE.expiresAt = 0;
    return getCycleDashboardData(filters || {});
  }

  function warmDashboardCache(filters) {
    var snapshot = getSnapshot_();
    var appliedFilters = normalizeFilters_(filters, snapshot.options);
    var filtered = applyFilters_(snapshot, appliedFilters);
    return buildAnalytics_(filtered, snapshot, appliedFilters);
  }

  function getSnapshot_() {
    var now = Date.now();
    if (RUNTIME_CACHE.snapshot && RUNTIME_CACHE.expiresAt > now) {
      return RUNTIME_CACHE.snapshot;
    }

    var ss = SpreadsheetApp.openById(resolveSpreadsheetId_());
    var routesSheet = ss.getSheetByName(SHEETS.routes);
    var stopsSheet = ss.getSheetByName(SHEETS.stops);
    var ordersSheet = ss.getSheetByName(SHEETS.orders);

    if (!routesSheet || !stopsSheet || !ordersSheet) {
      throw new Error('Abas de lote nao encontradas. Execute o export antes de abrir o dashboard.');
    }

    var routes = readSheetObjects_(routesSheet, [
      'routeKey', 'routeId', 'date', 'creationDate', 'status', 'driverKey',
      'organization.description',
      'driversName', 'actualStart', 'actualArrival', 'actualComplete',
      'actualTravelTimeMinutes', 'actualServiceTime', 'plannedTravelTimeMinutes',
      'actualDistance', 'plannedDistance', 'totalStops'
    ]).map(normalizeRouteRow_).filter(function (row) {
      return !!row.routeKey;
    });

    var stops = readSheetObjects_(stopsSheet, [
      'routeKey', 'routeId', 'stopId', 'stopIndex', 'driverKey', 'locationKey',
      'organization.description',
      'locationName', 'deliveryStatus', 'hasSignature', 'actualArrival',
      'actualDeparture', 'actualService', 'actualServiceTime',
      'plannedSequenceNum', 'actualSequenceNum', 'signatureConformity'
    ]).map(normalizeStopRow_).filter(function (row) {
      return !!row.routeKey;
    });

    var orders = readSheetObjects_(ordersSheet, [
      'routeKey', 'routeId', 'stopId', 'creationDate', 'driverKey',
      'organization.description',
      'locationKey', 'locationName', 'id', 'number'
    ]).map(normalizeOrderRow_).filter(function (row) {
      return !!row.routeKey;
    });

    var routeMetricsBase = buildRouteMetricsBase_(routes, stops);
    var indexes = buildIndexes_(routes, stops, orders);
    var options = buildFilterOptions_(routes, indexes);
    var snapshot = {
      routes: routes,
      stops: stops,
      orders: orders,
      routeMetricsBase: routeMetricsBase,
      indexes: indexes,
      options: options
    };

    RUNTIME_CACHE.snapshot = snapshot;
    RUNTIME_CACHE.expiresAt = now + SNAPSHOT_TTL_MS;
    return snapshot;
  }

  function getCycleSnapshot_() {
    var startedAtMs = Date.now();
    var now = Date.now();
    if (CYCLE_RUNTIME_CACHE.snapshot && CYCLE_RUNTIME_CACHE.expiresAt > now) {
      logInfo_('[Cycle Snapshot] Cache hit | expiresInMs=%s', CYCLE_RUNTIME_CACHE.expiresAt - now);
      return CYCLE_RUNTIME_CACHE.snapshot;
    }

    var ss = SpreadsheetApp.openById(resolveSpreadsheetId_());
    var routesSheet = ss.getSheetByName(SHEETS.routes);
    var stopsSheet = ss.getSheetByName(SHEETS.stops);

    if (!routesSheet) {
      throw new Error('A aba de rotas nao foi encontrada para carregar o ciclo do pedido.');
    }

    var routes = readSheetObjects_(routesSheet, [
      'routeKey', 'routeId', 'date', 'creationDate', 'status', 'driverKey',
      'organization.description', 'driversName', 'actualComplete'
    ]).map(normalizeRouteRow_).filter(function (row) {
      return !!row.routeKey;
    });

    var stops = stopsSheet ? readSheetObjects_(stopsSheet, [
      'routeKey', 'routeId', 'stopId', 'stopIndex', 'driverKey', 'locationKey',
      'organization.description', 'locationName', 'deliveryStatus', 'hasSignature',
      'actualArrival', 'actualDeparture', 'actualService', 'actualServiceTime',
      'plannedSequenceNum', 'actualSequenceNum', 'signatureConformity'
    ]).map(normalizeStopRow_).filter(function (row) {
      return !!row.routeKey;
    }) : [];

    if (!routes.length) {
      throw new Error('A aba de rotas nao possui dados utilizaveis para o ciclo do pedido. Execute a exportacao novamente e confirme as colunas obrigatorias.');
    }

    var options = buildCycleBaseOptions_(routes, stops);
    var snapshot = {
      routes: routes,
      stops: stops,
      options: options
    };

    CYCLE_RUNTIME_CACHE.snapshot = snapshot;
    CYCLE_RUNTIME_CACHE.expiresAt = now + SNAPSHOT_TTL_MS;
    logInfo_(
      '[Cycle Snapshot] Rebuild complete | routes=%s | stops=%s | durationMs=%s',
      routes.length,
      stops.length,
      Date.now() - startedAtMs
    );
    return snapshot;
  }

  function buildAnalytics_(filtered, snapshot, appliedFilters) {
    var routes = filtered.routes;
    var stops = filtered.stops;
    var orders = filtered.orders;
    var routeMetrics = filtered.routeMetrics;
    var deliveredStops = stops.filter(function (stop) {
      return stop.deliveryStatus === 'DELIVERED';
    });
    var clients = buildClientMetrics_(deliveredStops, routeMetrics);
    var drivers = buildDriverMetrics_(routes, stops, deliveredStops, routeMetrics, snapshot.indexes.driverNameMap);
    var signatureOverall = buildSignatureOverall_(deliveredStops);
    var routeTimeOverall = buildRouteTimeOverall_(routeMetrics);
    var clientTable = buildClientTable_(clients);
    var driverTable = buildDriverTable_(drivers);
    var routeTable = buildRouteTable_(routes, routeMetrics, stops, orders);

    return {
      generatedAt: new Date().toISOString(),
      meta: {
        signatureGoalPct: SIGNATURE_GOAL_PCT,
        routeCount: routes.length,
        stopCount: stops.length,
        driverCount: drivers.length,
        clientCount: clients.length,
        calculableRouteCount: routeTimeOverall.calculableRouteCount
      },
      filters: appliedFilters,
      options: snapshot.options,
      executive: buildExecutive_(signatureOverall, routeTimeOverall, clientTable, driverTable),
      signatureAnalysis: {
        overall: signatureOverall,
        trendByPeriod: buildSignatureTrend_(deliveredStops),
        byClient: clientTable,
        lowSignatureClients: clientTable.filter(function (item) { return item.totalStops >= 5; }).slice(0, 10),
        belowGoalClients: clientTable.filter(function (item) { return item.belowGoal; }).slice(0, 12),
        byDriver: driverTable.slice().sort(sortBySignatureAsc_),
        byRoute: routeTable.slice().sort(sortBySignatureAsc_)
      },
      routeTimeAnalysis: {
        overall: routeTimeOverall,
        trendByPeriod: buildRouteTimeTrend_(routeMetrics),
        byDriver: driverTable.slice().sort(function (a, b) { return (b.avgRouteMinutes || 0) - (a.avgRouteMinutes || 0); }),
        byClient: clientTable.slice().sort(function (a, b) { return (b.avgRouteMinutes || 0) - (a.avgRouteMinutes || 0); }),
        longestRoutes: routeTable.filter(function (item) { return item.hasOperationalWindow; }).slice(0, 12)
      },
      driverPerformance: {
        methodology: {
          title: 'Como a nota do motorista e calculada',
          description: 'A nota combina assinatura digital, tempo medio em rota e taxa de entregas concluidas no periodo filtrado.',
          weights: [
            { label: 'Assinatura digital', value: 50, description: 'Percentual de entregas com canhoto digital.' },
            { label: 'Tempo em rota', value: 30, description: 'Tempo medio comparado com a mediana do periodo.' },
            { label: 'Conclusao operacional', value: 20, description: 'Relacao entre entregas concluidas e total de paradas.' }
          ],
          outlierRule: 'Outliers sao marcados por IQR para tempo em rota e assinatura muito abaixo da distribuicao.'
        },
        summary: driverTable,
        bestDrivers: driverTable.slice(0, 8),
        worstDrivers: driverTable.slice().reverse().slice(0, 8),
        lowSignatureDrivers: driverTable.slice().sort(function (a, b) {
          return (a.signaturePct || 0) - (b.signaturePct || 0);
        }).slice(0, 8),
        longestRouteDrivers: driverTable.slice().sort(function (a, b) {
          return (b.avgRouteMinutes || 0) - (a.avgRouteMinutes || 0);
        }).slice(0, 8),
        highestVolumeDrivers: driverTable.slice().sort(function (a, b) {
          return (b.deliveredStops || 0) - (a.deliveredStops || 0);
        }).slice(0, 8),
        outliers: driverTable.filter(function (item) {
          return item.isHighRouteTimeOutlier || item.isLowSignatureOutlier;
        }),
        efficiencyMatrix: driverTable.map(function (item) {
          return {
            driverKey: item.driverKey,
            driverName: item.driverName,
            signaturePct: item.signaturePct,
            avgRouteMinutes: item.avgRouteMinutes,
            efficiencyScore: item.efficiencyScore,
            deliveredStops: item.deliveredStops,
            isHighRouteTimeOutlier: item.isHighRouteTimeOutlier,
            isLowSignatureOutlier: item.isLowSignatureOutlier
          };
        })
      },
      tables: {
        clients: clientTable,
        drivers: driverTable,
        routes: routeTable
      }
    };
  }

  function buildCycleAnalytics_(snapshot, filters) {
    var cycleRows = buildCycleRows_(snapshot);
    var filteredRows = applyCycleFilters_(cycleRows, filters);
    var analyzedRows = filteredRows.filter(function (row) { return row.isAnalyzed; });
    var byDay = buildCycleCountByDay_(analyzedRows);
    var transporterPerformance = buildCycleTransporterPerformance_(analyzedRows);
    var trendByDay = buildCycleTrendByDay_(analyzedRows);

    return {
      generatedAt: new Date().toISOString(),
      filters: filters,
      options: buildCycleFilterOptions_(cycleRows, snapshot.options),
      meta: {
        totalRows: filteredRows.length,
        analyzedRows: analyzedRows.length,
        cycleSlaDaysOffset: CYCLE_SLA_DAY_OFFSET
      },
      overview: buildCycleOverview_(filteredRows, analyzedRows),
      charts: {
        slaBreakdown: buildCycleBreakdown_(analyzedRows),
        countByDay: byDay,
        transporterPerformance: transporterPerformance,
        trendByDay: trendByDay
      },
      table: filteredRows
    };
  }

  function applyFilters_(snapshot, filters) {
    var routes = snapshot.routes.slice();
    var stops = snapshot.stops.slice();
    var orders = snapshot.orders.slice();
    var clientRouteMap = {};

    if (filters.clientKey) {
      snapshot.stops.forEach(function (stop) {
        if (stop.clientKey === filters.clientKey) clientRouteMap[stop.routeKey] = true;
      });
    }

    routes = routes.filter(function (route) {
      if (filters.dateFrom && route.dateKey && route.dateKey < filters.dateFrom) return false;
      if (filters.dateTo && route.dateKey && route.dateKey > filters.dateTo) return false;
      if (filters.driverKey && route.driverKey !== filters.driverKey) return false;
      if (filters.organizationDescription && route.organizationDescription !== filters.organizationDescription) return false;
      if (filters.status && route.status !== filters.status) return false;
      if (filters.routeKey && route.routeKey !== filters.routeKey) return false;
      if (filters.clientKey && !clientRouteMap[route.routeKey]) return false;
      if (filters.search) {
        var haystack = [
          route.routeKey, route.routeId, route.driverKey,
          route.driverName, route.status, route.dateKey, route.organizationDescription
        ].join(' ').toLowerCase();
        if (haystack.indexOf(filters.search) === -1) return false;
      }
      return true;
    });

    var allowedRoutes = {};
    routes.forEach(function (route) {
      allowedRoutes[route.routeKey] = true;
    });

    stops = stops.filter(function (stop) {
      if (!allowedRoutes[stop.routeKey]) return false;
      if (filters.clientKey && stop.clientKey !== filters.clientKey) return false;
      if (filters.driverKey && stop.driverKey !== filters.driverKey) return false;
      return true;
    });

    orders = orders.filter(function (order) {
      if (!allowedRoutes[order.routeKey]) return false;
      if (filters.clientKey && order.clientKey !== filters.clientKey) return false;
      if (filters.driverKey && order.driverKey !== filters.driverKey) return false;
      return true;
    });

    return {
      routes: routes,
      stops: stops,
      orders: orders,
      routeMetrics: snapshot.routeMetricsBase
        .filter(function (metric) {
          if (!allowedRoutes[metric.routeKey]) return false;
          if (filters.driverKey && metric.driverKey !== filters.driverKey) return false;
          if (filters.organizationDescription && metric.organizationDescription !== filters.organizationDescription) return false;
          if (filters.routeKey && metric.routeKey !== filters.routeKey) return false;
          if (filters.clientKey && !metric.clientsMap[filters.clientKey]) return false;
          return true;
        })
        .map(function (metric) {
          if (!filters.clientKey) return metric;
          return withPreferredClient_(metric, filters.clientKey);
        })
        .sort(function (a, b) {
          return (b.routeDurationMinutes || 0) - (a.routeDurationMinutes || 0);
        })
    };
  }

  function buildRouteMetricsBase_(routes, allStops) {
    var stopsByRoute = groupBy_(allStops, function (stop) { return stop.routeKey; });
    return routes.map(function (route) {
      var routeStops = (stopsByRoute[route.routeKey] || []).slice();
      var arrivalStops = routeStops.filter(function (stop) {
        return !!stop.actualArrivalDate;
      }).sort(sortStopsForTimeline_);
      var completionStops = routeStops.filter(function (stop) {
        return !!stop.actualDepartureDate || !!stop.actualServiceDate;
      }).sort(sortStopsForTimeline_);
      var startStop = arrivalStops[0] || null;
      var endStop = completionStops.length ? completionStops[completionStops.length - 1] : null;
      var startDate = startStop ? startStop.actualArrivalDate : null;
      var endDate = endStop ? (endStop.actualDepartureDate || endStop.actualServiceDate) : null;
      var deliveredStops = routeStops.filter(function (stop) { return stop.deliveryStatus === 'DELIVERED'; });
      var signedStops = deliveredStops.filter(function (stop) { return stop.hasSignature; }).length;
      var clientsMap = {};
      var clientNamesMap = {};
      var clients = [];

      deliveredStops.forEach(function (stop) {
        if (!clientsMap[stop.clientKey]) clients.push(stop.clientName);
        clientsMap[stop.clientKey] = true;
        clientNamesMap[stop.clientKey] = stop.clientName;
      });

      var firstClientName = CLIENT_FALLBACK;
      if (clients.length) {
        firstClientName = clients[0];
      }

      return {
        routeKey: route.routeKey,
        routeId: route.routeId,
        dateKey: route.dateKey,
        driverKey: route.driverKey,
        driverName: route.driverName,
        organizationDescription: route.organizationDescription,
        status: route.status,
        totalStops: route.totalStops,
        deliveredStops: deliveredStops.length,
        signedStops: signedStops,
        unsignedStops: Math.max(0, deliveredStops.length - signedStops),
        signaturePct: round1_(safePct_(signedStops, deliveredStops.length)),
        actualDistance: route.actualDistance,
        plannedDistance: route.plannedDistance,
        hasOperationalWindow: minutesBetween_(startDate, endDate) !== null,
        routeDurationMinutes: round1_(minutesBetween_(startDate, endDate) || 0),
        startTime: startDate ? startDate.toISOString() : '',
        endTime: endDate ? endDate.toISOString() : '',
        firstClientName: firstClientName,
        clients: clients,
        clientsMap: clientsMap,
        clientNamesMap: clientNamesMap
      };
    });
  }

  function withPreferredClient_(metric, preferredClientKey) {
    if (!metric || !preferredClientKey || !metric.clientsMap[preferredClientKey]) return metric;
    return assign_({}, metric, {
      firstClientName: metric.clientNamesMap[preferredClientKey] || metric.firstClientName
    });
  }

  function buildSignatureOverall_(deliveredStops) {
    var signedStops = deliveredStops.filter(function (stop) { return stop.hasSignature; }).length;
    var totalStops = deliveredStops.length;
    var actualPct = round1_(safePct_(signedStops, totalStops));
    return {
      actualPct: actualPct,
      goalPct: SIGNATURE_GOAL_PCT,
      gapPct: round1_(actualPct - SIGNATURE_GOAL_PCT),
      signedStops: signedStops,
      unsignedStops: Math.max(0, totalStops - signedStops),
      totalStops: totalStops,
      belowGoal: actualPct < SIGNATURE_GOAL_PCT
    };
  }

  function buildRouteTimeOverall_(routeMetrics) {
    var values = routeMetrics.filter(function (item) {
      return item.hasOperationalWindow;
    }).map(function (item) {
      return item.routeDurationMinutes;
    });
    return {
      avgMinutes: round1_(safeAvgArray_(values)),
      medianMinutes: round1_(safeMedian_(values)),
      p90Minutes: round1_(quantile_(values, 0.9)),
      longestRouteMinutes: round1_(values.length ? Math.max.apply(null, values) : 0),
      calculableRouteCount: values.length,
      missingTelemetryRouteCount: routeMetrics.length - values.length
    };
  }

  function buildClientMetrics_(deliveredStops, routeMetrics) {
    var grouped = groupBy_(deliveredStops, function (stop) { return stop.clientKey; });
    return Object.keys(grouped).map(function (clientKey) {
      var items = grouped[clientKey];
      var signedStops = items.filter(function (stop) { return stop.hasSignature; }).length;
      var metrics = routeMetrics.filter(function (metric) {
        return !!metric.clientsMap[clientKey];
      });
      var routeMinutes = metrics.filter(function (metric) {
        return metric.hasOperationalWindow;
      }).map(function (metric) {
        return metric.routeDurationMinutes;
      });
      var driversMap = {};

      metrics.forEach(function (metric) {
        driversMap[metric.driverName] = (driversMap[metric.driverName] || 0) + 1;
      });

      var pct = round1_(safePct_(signedStops, items.length));
      return {
        clientKey: clientKey,
        clientName: items[0].clientName,
        totalStops: items.length,
        signedStops: signedStops,
        unsignedStops: Math.max(0, items.length - signedStops),
        signaturePct: pct,
        routeCount: uniqueCount_(metrics.map(function (metric) { return metric.routeKey; })),
        avgRouteMinutes: round1_(safeAvgArray_(routeMinutes)),
        medianRouteMinutes: round1_(safeMedian_(routeMinutes)),
        topDriverName: topKeyByValue_(driversMap) || DRIVER_FALLBACK,
        belowGoal: pct < SIGNATURE_GOAL_PCT
      };
    }).sort(sortBySignatureAsc_);
  }

  function buildDriverMetrics_(routes, stops, deliveredStops, routeMetrics, driverNameMap) {
    var deliveredByDriver = groupBy_(deliveredStops, function (stop) { return stop.driverKey || DRIVER_FALLBACK; });
    var allStopsByDriver = groupBy_(stops, function (stop) { return stop.driverKey || DRIVER_FALLBACK; });
    var metricsByDriver = groupBy_(routeMetrics, function (metric) { return metric.driverKey || DRIVER_FALLBACK; });
    var driverKeys = uniqueValues_(
      Object.keys(deliveredByDriver)
        .concat(Object.keys(allStopsByDriver))
        .concat(Object.keys(metricsByDriver))
        .concat(routes.map(function (route) { return route.driverKey; }))
    );

    var summary = driverKeys.map(function (driverKey) {
      var deliveredItems = deliveredByDriver[driverKey] || [];
      var allStopItems = allStopsByDriver[driverKey] || [];
      var routeItems = metricsByDriver[driverKey] || [];
      var minutes = routeItems.filter(function (item) {
        return item.hasOperationalWindow;
      }).map(function (item) {
        return item.routeDurationMinutes;
      });
      var signedStops = deliveredItems.filter(function (stop) { return stop.hasSignature; }).length;
      return {
        driverKey: driverKey,
        driverName: driverNameMap[driverKey] || driverKey || DRIVER_FALLBACK,
        deliveredStops: deliveredItems.length,
        totalStops: allStopItems.length,
        routeCount: routeItems.length,
        signedStops: signedStops,
        unsignedStops: Math.max(0, deliveredItems.length - signedStops),
        signaturePct: round1_(safePct_(signedStops, deliveredItems.length)),
        completionRate: round1_(safePct_(deliveredItems.length, allStopItems.length)),
        avgRouteMinutes: round1_(safeAvgArray_(minutes)),
        medianRouteMinutes: round1_(safeMedian_(minutes)),
        p90RouteMinutes: round1_(quantile_(minutes, 0.9)),
        calculableRouteCount: minutes.length,
        isHighRouteTimeOutlier: false,
        isLowSignatureOutlier: false,
        efficiencyScore: 0
      };
    });

    applyDriverOutliersAndScores_(summary);
    return summary.sort(function (a, b) {
      return (b.efficiencyScore || 0) - (a.efficiencyScore || 0);
    });
  }

  function buildExecutive_(signatureOverall, routeTimeOverall, clients, drivers) {
    var belowGoalClients = clients.filter(function (item) { return item.belowGoal; }).length;
    var avgScore = round1_(safeAvg_(drivers, function (item) { return item.efficiencyScore; }));
    return {
      kpis: [
        { id: 'signaturePct', label: 'Canhoto Digital', value: signatureOverall.actualPct, suffix: '%', tone: signatureOverall.actualPct >= SIGNATURE_GOAL_PCT ? 'good' : 'warn', help: signatureOverall.signedStops + ' assinados de ' + signatureOverall.totalStops },
        { id: 'goalPct', label: 'Meta', value: SIGNATURE_GOAL_PCT, suffix: '%', tone: 'brand', help: 'Meta operacional' },
        { id: 'gapPct', label: 'Gap vs Meta', value: signatureOverall.gapPct, suffix: ' pts', tone: signatureOverall.gapPct >= 0 ? 'good' : 'danger', help: 'Realizado menos meta' },
        { id: 'avgRouteMinutes', label: 'Tempo Medio em Rota', value: routeTimeOverall.avgMinutes, suffix: ' tempo', tone: 'info', help: routeTimeOverall.calculableRouteCount + ' rotas calculaveis' },
        { id: 'belowGoalClients', label: 'Clientes Abaixo da Meta', value: belowGoalClients, suffix: '', tone: belowGoalClients ? 'danger' : 'good', help: 'Clientes com assinatura abaixo de 99%' },
        { id: 'p90RouteMinutes', label: 'P90 em Rota', value: routeTimeOverall.p90Minutes, suffix: ' tempo', tone: 'warn', help: 'Faixa alta da operacao' },
        { id: 'avgOperationalScore', label: 'Score Operacional', value: avgScore, suffix: '', tone: avgScore >= 80 ? 'good' : 'warn', help: drivers.length + ' motoristas monitorados' }
      ],
      alerts: buildExecutiveAlerts_(signatureOverall, routeTimeOverall, clients, drivers)
    };
  }

  function buildExecutiveAlerts_(signatureOverall, routeTimeOverall, clients, drivers) {
    var alerts = [];
    var worstClient = clients.slice().sort(sortBySignatureAsc_)[0];
    var worstDriver = drivers.slice().sort(function (a, b) {
      return (a.efficiencyScore || 0) - (b.efficiencyScore || 0);
    })[0];

    if (signatureOverall.actualPct < SIGNATURE_GOAL_PCT) {
      alerts.push({
        tone: 'danger',
        title: 'Canhoto abaixo da meta',
        body: 'Realizado em ' + formatNumber_(signatureOverall.actualPct, 1) + '% contra meta de 99%.'
      });
    }

    if (routeTimeOverall.p90Minutes > routeTimeOverall.avgMinutes * 1.35) {
      alerts.push({
        tone: 'warn',
        title: 'Dispersao alta em tempo de rota',
        body: 'P90 em ' + formatDurationFromMinutes_(routeTimeOverall.p90Minutes) + ' acima da media operacional.'
      });
    }

    if (worstClient) {
      alerts.push({
        tone: worstClient.belowGoal ? 'danger' : 'info',
        title: 'Cliente mais sensivel',
        body: worstClient.clientName + ' em ' + formatNumber_(worstClient.signaturePct, 1) + '% de assinatura.'
      });
    }

    if (worstDriver) {
      alerts.push({
        tone: worstDriver.isHighRouteTimeOutlier || worstDriver.isLowSignatureOutlier ? 'warn' : 'info',
        title: 'Motorista em foco',
        body: worstDriver.driverName + ' com score ' + formatNumber_(worstDriver.efficiencyScore, 1) + '.'
      });
    }

    return alerts.slice(0, 4);
  }

  function buildClientTable_(clients) {
    return clients.slice().sort(sortBySignatureAsc_);
  }

  function buildDriverTable_(drivers) {
    return drivers.slice().sort(function (a, b) {
      return (b.efficiencyScore || 0) - (a.efficiencyScore || 0);
    });
  }

  function buildRouteTable_(routes, routeMetrics, stops, orders) {
    var stopCountByRoute = countBy_(stops, function (item) { return item.routeKey; });
    var deliveredByRoute = countBy_(stops.filter(function (stop) {
      return stop.deliveryStatus === 'DELIVERED';
    }), function (item) {
      return item.routeKey;
    });
    var signedByRoute = countBy_(stops.filter(function (stop) {
      return stop.deliveryStatus === 'DELIVERED' && stop.hasSignature;
    }), function (item) {
      return item.routeKey;
    });
    var orderCountByRoute = countBy_(orders, function (order) { return order.routeKey; });
    var metricMap = {};
    routeMetrics.forEach(function (metric) {
      metricMap[metric.routeKey] = metric;
    });

    return routes.map(function (route) {
      var metric = metricMap[route.routeKey] || {};
      var deliveredStops = deliveredByRoute[route.routeKey] || 0;
      var signedStops = signedByRoute[route.routeKey] || 0;
      return {
        routeKey: route.routeKey,
        routeId: route.routeId,
        dateKey: route.dateKey,
        driverKey: route.driverKey,
        driverName: route.driverName,
        organizationDescription: route.organizationDescription,
        status: route.status,
        totalStops: stopCountByRoute[route.routeKey] || route.totalStops || 0,
        deliveredStops: deliveredStops,
        signedStops: signedStops,
        unsignedStops: Math.max(0, deliveredStops - signedStops),
        signaturePct: round1_(safePct_(signedStops, deliveredStops)),
        orderCount: orderCountByRoute[route.routeKey] || 0,
        actualDistance: route.actualDistance,
        plannedDistance: route.plannedDistance,
        hasOperationalWindow: !!metric.hasOperationalWindow,
        routeDurationMinutes: round1_(metric.routeDurationMinutes || 0),
        firstClientName: metric.firstClientName || CLIENT_FALLBACK,
        belowGoal: round1_(safePct_(signedStops, deliveredStops)) < SIGNATURE_GOAL_PCT
      };
    }).sort(function (a, b) {
      return (b.routeDurationMinutes || 0) - (a.routeDurationMinutes || 0);
    });
  }

  function buildFilterOptions_(routes, indexes) {
    var statuses = {};
    var organizations = {};
    var minDate = '';
    var maxDate = '';

    routes.forEach(function (route) {
      if (route.status) statuses[route.status] = true;
      if (route.organizationDescription) organizations[route.organizationDescription] = true;
      if (route.dateKey) {
        if (!minDate || route.dateKey < minDate) minDate = route.dateKey;
        if (!maxDate || route.dateKey > maxDate) maxDate = route.dateKey;
      }
    });

    return {
      drivers: indexes.drivers,
      clients: indexes.clients,
      organizations: Object.keys(organizations).sort(),
      routes: routes.map(function (route) { return route.routeKey; }).filter(Boolean).sort(),
      statuses: Object.keys(statuses).sort(),
      minDate: minDate,
      maxDate: maxDate,
    };
  }

  function buildCycleFilterOptions_(cycleRows, baseOptions) {
    return {
      clients: (baseOptions && baseOptions.clients) || [],
      organizations: (baseOptions && baseOptions.organizations) || [],
      statuses: (baseOptions && baseOptions.statuses) || [],
      transporters: (baseOptions && baseOptions.transporters) || [],
      minDate: (baseOptions && baseOptions.minDate) || '',
      maxDate: (baseOptions && baseOptions.maxDate) || ''
    };
  }

  function buildCycleBaseOptions_(routes, stops) {
    var organizations = {};
    var statuses = {};
    var transporters = {};
    var clientsMap = {};
    var minDate = '';
    var maxDate = '';

    (routes || []).forEach(function (route) {
      if (route.organizationDescription) organizations[route.organizationDescription] = true;
      if (route.status) statuses[route.status] = true;
      transporters[DEFAULT_TRANSPORTER_NAME] = true;
      if (route.dateKey) {
        if (!minDate || route.dateKey < minDate) minDate = route.dateKey;
        if (!maxDate || route.dateKey > maxDate) maxDate = route.dateKey;
      }
    });

    (stops || []).forEach(function (stop) {
      if (stop.clientKey) {
        clientsMap[stop.clientKey] = stop.clientName || stop.clientKey;
      }
    });

    return {
      clients: Object.keys(clientsMap).sort().map(function (key) {
        return { key: key, name: clientsMap[key] };
      }),
      organizations: Object.keys(organizations).sort(),
      statuses: Object.keys(statuses).sort(),
      transporters: Object.keys(transporters).sort(),
      minDate: minDate,
      maxDate: maxDate
    };
  }

  function buildIndexes_(routes, stops, orders) {
    var driverNameMap = {};
    var clientsMap = {};

    routes.forEach(function (route) {
      if (route.driverKey) driverNameMap[route.driverKey] = route.driverName || route.driverKey;
    });
    stops.forEach(function (stop) {
      clientsMap[stop.clientKey] = stop.clientName;
      if (stop.driverKey && !driverNameMap[stop.driverKey]) {
        driverNameMap[stop.driverKey] = stop.driverKey;
      }
    });

    return {
      driverNameMap: driverNameMap,
      routeOrderCountMap: countBy_(orders, function (order) { return order.routeKey; }),
      drivers: Object.keys(driverNameMap).sort().map(function (key) {
        return { key: key, name: driverNameMap[key] };
      }),
      clients: Object.keys(clientsMap).sort().map(function (key) {
        return { key: key, name: clientsMap[key] };
      })
    };
  }

  function buildCycleRows_(snapshot) {
    var stopGroups = groupBy_(snapshot.stops || [], function (stop) { return stop.routeKey; });

    return (snapshot.routes || []).map(function (route) {
      var creationDate = parseDateSafe_(route.creationDate) || parseDateSafe_(route.date);
      var finalizationDate = route.actualCompleteDate || null;
      var cycleMinutes = minutesBetween_(creationDate, finalizationDate);
      var cycleDeadline = computeCycleDeadline_(creationDate);
      var isAnalyzed = cycleMinutes !== null;
      var isWithinSla = isAnalyzed && cycleDeadline && finalizationDate.getTime() <= cycleDeadline.getTime();
      var routeStops = stopGroups[route.routeKey] || [];
      var primaryStop = routeStops[0] || null;
      var clientNamesMap = {};
      var clientNames = [];

      routeStops.forEach(function (stop) {
        if (!stop.clientKey || clientNamesMap[stop.clientKey]) return;
        clientNamesMap[stop.clientKey] = stop.clientName || stop.clientKey;
        clientNames.push(stop.clientName || stop.clientKey);
      });

      return {
        routeKey: route.routeKey,
        routeId: route.routeId,
        orderOrLoadNumber: route.routeKey,
        primaryOrderNumber: '',
        clientKey: primaryStop ? primaryStop.clientKey : '',
        clientName: primaryStop ? primaryStop.clientName : CLIENT_FALLBACK,
        clientNames: clientNames,
        organizationDescription: route.organizationDescription || '',
        transporterName: DEFAULT_TRANSPORTER_NAME,
        status: route.status || 'UNKNOWN',
        creationDateIso: creationDate ? creationDate.toISOString() : '',
        finalizationDateIso: finalizationDate ? finalizationDate.toISOString() : '',
        cycleDeadlineIso: cycleDeadline ? cycleDeadline.toISOString() : '',
        creationDateKey: toDateKey_(creationDate),
        finalizationDateKey: toDateKey_(finalizationDate),
        cycleMinutes: round1_(cycleMinutes || 0),
        cycleHours: round1_((cycleMinutes || 0) / 60),
        isAnalyzed: isAnalyzed,
        isWithinSla: isWithinSla,
        slaLabel: !isAnalyzed ? 'Sem conclusao' : (isWithinSla ? 'Dentro do prazo' : 'Fora do prazo'),
        analysisStatus: !isAnalyzed ? 'Aguardando finalizacao' : (isWithinSla ? 'Dentro do prazo' : 'Fora do prazo'),
        analysisTone: !isAnalyzed ? 'info' : (isWithinSla ? 'good' : 'danger')
      };
    }).sort(function (a, b) {
      return (b.creationDateIso || '').localeCompare(a.creationDateIso || '');
    });
  }

  function applyCycleFilters_(rows, filters) {
    return (rows || []).filter(function (row) {
      if (filters.dateFrom && row.creationDateKey && row.creationDateKey < filters.dateFrom) return false;
      if (filters.dateTo && row.creationDateKey && row.creationDateKey > filters.dateTo) return false;
      if (filters.transporter && row.transporterName !== filters.transporter) return false;
      if (filters.organizationDescription && row.organizationDescription !== filters.organizationDescription) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.clientKey && row.clientKey !== filters.clientKey && row.clientNames.indexOf(resolveClientNameByKey_(filters.clientKey, filters.optionsClients)) === -1) return false;
      if (filters.search) {
        var haystack = [
          row.orderOrLoadNumber,
          row.primaryOrderNumber,
          row.routeKey,
          row.clientName,
          row.organizationDescription,
          row.status,
          row.transporterName,
          row.slaLabel,
          row.analysisStatus
        ].join(' ').toLowerCase();
        if (haystack.indexOf(filters.search) === -1) return false;
      }
      return true;
    });
  }

  function resolveClientNameByKey_(clientKey, optionsClients) {
    var clients = optionsClients || [];
    for (var i = 0; i < clients.length; i += 1) {
      if (clients[i].key === clientKey) return clients[i].name;
    }
    return '';
  }

  function buildCycleOverview_(filteredRows, analyzedRows) {
    var withinRows = analyzedRows.filter(function (row) { return row.isWithinSla; });
    var outsideRows = analyzedRows.filter(function (row) { return !row.isWithinSla; });
    var analyzedMinutes = analyzedRows.map(function (row) { return row.cycleMinutes; });
    var maxMinutes = analyzedMinutes.length ? Math.max.apply(null, analyzedMinutes) : 0;

    return {
      totalLoads: analyzedRows.length,
      totalVisibleLoads: filteredRows.length,
      withinDeadline: withinRows.length,
      outsideDeadline: outsideRows.length,
      withinDeadlinePct: round1_(safePct_(withinRows.length, analyzedRows.length)),
      averageCycleMinutes: round1_(safeAvgArray_(analyzedMinutes)),
      maxCycleMinutes: round1_(maxMinutes),
      pendingLoads: filteredRows.length - analyzedRows.length
    };
  }

  function buildCycleBreakdown_(analyzedRows) {
    var within = analyzedRows.filter(function (row) { return row.isWithinSla; }).length;
    var outside = analyzedRows.length - within;
    return [
      { label: 'Dentro do prazo', value: within },
      { label: 'Fora do prazo', value: outside }
    ];
  }

  function buildCycleCountByDay_(analyzedRows) {
    return buildPeriodTrend_(analyzedRows, function (row) {
      return row.creationDateKey;
    }, function (bucket) {
      bucket.total += 1;
    }, function (key, bucket) {
      return {
        period: key,
        totalLoads: bucket.total
      };
    });
  }

  function buildCycleTransporterPerformance_(analyzedRows) {
    return buildPeriodTrend_(analyzedRows, function (row) {
      return row.transporterName || DEFAULT_TRANSPORTER_NAME;
    }, function (bucket, row) {
      bucket.total += 1;
      if (row.isWithinSla) bucket.inside += 1;
    }, function (key, bucket) {
      return {
        transporterName: key,
        withinDeadlinePct: round1_(safePct_(bucket.inside, bucket.total)),
        withinDeadline: bucket.inside,
        totalLoads: bucket.total
      };
    }).sort(function (a, b) {
      return (b.withinDeadlinePct || 0) - (a.withinDeadlinePct || 0);
    });
  }

  function buildCycleTrendByDay_(analyzedRows) {
    return buildPeriodTrend_(analyzedRows, function (row) {
      return row.creationDateKey;
    }, function (bucket, row) {
      bucket.total += 1;
      if (row.isWithinSla) bucket.inside += 1;
    }, function (key, bucket) {
      return {
        period: key,
        withinDeadlinePct: round1_(safePct_(bucket.inside, bucket.total)),
        withinDeadline: bucket.inside,
        totalLoads: bucket.total
      };
    });
  }

  function normalizeFilters_(filters, options) {
    filters = filters || {};
    var normalized = {
      dateFrom: toStringSafe_(filters.dateFrom),
      dateTo: toStringSafe_(filters.dateTo),
      driverKey: toStringSafe_(filters.driverKey),
      organizationDescription: toStringSafe_(filters.organizationDescription),
      clientKey: toStringSafe_(filters.clientKey),
      routeKey: toStringSafe_(filters.routeKey),
      status: toStringSafe_(filters.status),
      search: toStringSafe_(filters.search).toLowerCase()
    };
    return normalized;
  }

  function normalizeCycleFilters_(filters, options) {
    filters = filters || {};
    return {
      dateFrom: toStringSafe_(filters.dateFrom),
      dateTo: toStringSafe_(filters.dateTo),
      transporter: toStringSafe_(filters.transporter),
      organizationDescription: toStringSafe_(filters.organizationDescription),
      clientKey: toStringSafe_(filters.clientKey),
      status: toStringSafe_(filters.status),
      search: toStringSafe_(filters.search).toLowerCase(),
      optionsClients: (options && options.clients) || []
    };
  }

  function readSheetObjects_(sheet, columns) {
    var values = [];
    var lastRow = 0;
    var lastColumn = 0;

    if (sheet && typeof sheet.getLastRow === 'function' && typeof sheet.getLastColumn === 'function') {
      lastRow = sheet.getLastRow();
      lastColumn = sheet.getLastColumn();
      if (lastRow < 2 || lastColumn < 1) return [];
      if (typeof sheet.getRange === 'function') {
        values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
      }
    }

    if (!values.length && sheet && typeof sheet.getDataRange === 'function') {
      values = sheet.getDataRange().getValues();
    }

    if (!values || values.length < 2) return [];

    var headers = values[0];
    var headerMap = {};
    headers.forEach(function (header, index) {
      if (header) headerMap[String(header).trim()] = index;
    });

    var rows = [];
    for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      var source = values[rowIndex];
      var hasAnyRelevantValue = false;
      for (var colCheck = 0; colCheck < columns.length; colCheck += 1) {
        var checkIndex = headerMap[columns[colCheck]];
        if (checkIndex === undefined) continue;
        var checkValue = source[checkIndex];
        if (checkValue !== '' && checkValue !== null && checkValue !== undefined) {
          hasAnyRelevantValue = true;
          break;
        }
      }
      if (!hasAnyRelevantValue) continue;
      var obj = {};
      columns.forEach(function (column) {
        var colIndex = headerMap[column];
        obj[column] = colIndex === undefined ? '' : source[colIndex];
      });
      rows.push(obj);
    }
    return rows;
  }

  function normalizeRouteRow_(row) {
    var dateObj = parseDateSafe_(row.date || row.creationDate);
    return {
      routeKey: toStringSafe_(row.routeKey),
      routeId: toStringSafe_(row.routeId),
      date: toStringSafe_(row.date),
      creationDate: toStringSafe_(row.creationDate),
      dateKey: toDateKey_(dateObj),
      sortTime: dateObj ? dateObj.getTime() : 0,
      status: toStringSafe_(row.status) || 'UNKNOWN',
      driverKey: toStringSafe_(row.driverKey) || DRIVER_FALLBACK,
      driverName: cleanDriverName_(row.driversName) || toStringSafe_(row.driverKey) || DRIVER_FALLBACK,
      organizationDescription: toStringSafe_(row['organization.description']) || '',
      actualStartDate: parseDateSafe_(row.actualStart),
      actualArrivalDate: parseDateSafe_(row.actualArrival),
      actualCompleteDate: parseDateSafe_(row.actualComplete),
      actualTravelTimeMinutes: toNumberSafe_(row.actualTravelTimeMinutes),
      actualServiceTime: toNumberSafe_(row.actualServiceTime),
      plannedTravelTimeMinutes: toNumberSafe_(row.plannedTravelTimeMinutes),
      actualDistance: toNumberSafe_(row.actualDistance),
      plannedDistance: toNumberSafe_(row.plannedDistance),
      totalStops: toNumberSafe_(row.totalStops)
    };
  }

  function normalizeStopRow_(row) {
    var actualArrivalDate = parseDateSafe_(row.actualArrival);
    var actualDepartureDate = parseDateSafe_(row.actualDeparture);
    var actualServiceDate = parseDateSafe_(row.actualService);
    var clientName = toStringSafe_(row.locationName) || CLIENT_FALLBACK;
    var clientKey = toStringSafe_(row.locationKey) || clientName;
    return {
      routeKey: toStringSafe_(row.routeKey),
      routeId: toStringSafe_(row.routeId),
      stopId: toStringSafe_(row.stopId),
      stopIndex: toNumberSafe_(row.stopIndex),
      driverKey: toStringSafe_(row.driverKey) || DRIVER_FALLBACK,
      organizationDescription: toStringSafe_(row['organization.description']) || '',
      clientKey: clientKey,
      clientName: clientName,
      deliveryStatus: toStringSafe_(row.deliveryStatus) || 'UNKNOWN',
      hasSignature: parseBooleanLike_(row.hasSignature),
      actualArrivalDate: actualArrivalDate,
      actualDepartureDate: actualDepartureDate,
      actualServiceDate: actualServiceDate,
      actualServiceTime: toNumberSafe_(row.actualServiceTime),
      plannedSequenceNum: toNumberSafe_(row.plannedSequenceNum),
      actualSequenceNum: toNumberSafe_(row.actualSequenceNum),
      signatureConformity: toStringSafe_(row.signatureConformity),
      eventDateKey: toDateKey_(actualArrivalDate || actualDepartureDate || actualServiceDate),
      dateKey: toDateKey_(actualArrivalDate || actualDepartureDate || actualServiceDate)
    };
  }

  function normalizeOrderRow_(row) {
    var clientName = toStringSafe_(row.locationName) || CLIENT_FALLBACK;
    return {
      routeKey: toStringSafe_(row.routeKey),
      routeId: toStringSafe_(row.routeId),
      stopId: toStringSafe_(row.stopId),
      creationDate: toStringSafe_(row.creationDate),
      creationDateKey: toDateKey_(parseDateSafe_(row.creationDate)),
      driverKey: toStringSafe_(row.driverKey) || DRIVER_FALLBACK,
      organizationDescription: toStringSafe_(row['organization.description']) || '',
      clientKey: toStringSafe_(row.locationKey) || clientName,
      clientName: clientName,
      id: toStringSafe_(row.id),
      number: toStringSafe_(row.number)
    };
  }

  function buildSignatureTrend_(deliveredStops) {
    return buildPeriodTrend_(deliveredStops, function (stop) {
      return stop.eventDateKey || stop.dateKey;
    }, function (bucket, stop) {
      bucket.total += 1;
      if (stop.hasSignature) bucket.signed += 1;
    }, function (key, bucket) {
      return {
        period: key,
        signaturePct: round1_(safePct_(bucket.signed, bucket.total)),
        signedStops: bucket.signed,
        totalStops: bucket.total
      };
    });
  }

  function buildRouteTimeTrend_(routeMetrics) {
    return buildPeriodTrend_(routeMetrics.filter(function (item) {
      return item.hasOperationalWindow;
    }), function (metric) {
      return metric.dateKey;
    }, function (bucket, metric) {
      bucket.values.push(metric.routeDurationMinutes);
    }, function (key, bucket) {
      return {
        period: key,
        avgMinutes: round1_(safeAvgArray_(bucket.values)),
        routeCount: bucket.values.length
      };
    });
  }

  function parseBooleanLike_(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0 || value === '' || value === null || value === undefined) return false;
    var normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === 'verdadeiro' || normalized === 'sim' || normalized === 'yes' || normalized === 'y' || normalized === '1') return true;
    if (normalized === 'false' || normalized === 'falso' || normalized === 'nao' || normalized === 'não' || normalized === 'no' || normalized === 'n' || normalized === '0') return false;
    return false;
  }

  function parseDateSafe_(value) {
    if (!value) return null;
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return isNaN(value.getTime()) ? null : value;
    }
    var normalized = String(value).trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    if (!normalized) return null;
    var date = new Date(normalized);
    return isNaN(date.getTime()) ? null : date;
  }

  function minutesBetween_(start, end) {
    if (!start || !end) return null;
    var diff = (end.getTime() - start.getTime()) / 60000;
    return diff >= 0 ? diff : null;
  }

  function computeCycleDeadline_(creationDate) {
    if (!creationDate) return null;
    return new Date(
      creationDate.getFullYear(),
      creationDate.getMonth(),
      creationDate.getDate() + CYCLE_SLA_DAY_OFFSET,
      23,
      59,
      59,
      999
    );
  }

  function safePct_(num, den) {
    return den ? (num * 100 / den) : 0;
  }

  function safeAvg_(items, accessor) {
    if (!items || !items.length) return 0;
    var total = 0;
    var count = 0;
    items.forEach(function (item) {
      var value = accessor(item);
      if (value === null || value === undefined || isNaN(value)) return;
      total += Number(value);
      count += 1;
    });
    return count ? total / count : 0;
  }

  function safeAvgArray_(values) {
    if (!values || !values.length) return 0;
    var total = values.reduce(function (sum, value) { return sum + value; }, 0);
    return total / values.length;
  }

  function safeMedian_(values) {
    if (!values || !values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function quantile_(values, q) {
    if (!values || !values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    if (sorted.length === 1) return sorted[0];
    var position = (sorted.length - 1) * q;
    var base = Math.floor(position);
    var rest = position - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  }

  function computeIqrBounds_(values) {
    if (!values || values.length < 4) return { low: null, high: null };
    var q1 = quantile_(values, 0.25);
    var q3 = quantile_(values, 0.75);
    var iqr = q3 - q1;
    return {
      low: q1 - 1.5 * iqr,
      high: q3 + 1.5 * iqr
    };
  }

  function applyDriverOutliersAndScores_(drivers) {
    var routeValues = drivers.map(function (item) { return item.avgRouteMinutes; }).filter(function (value) { return value > 0; });
    var signatureValues = drivers.map(function (item) { return item.signaturePct; }).filter(function (value) { return value >= 0; });
    var routeBounds = computeIqrBounds_(routeValues);
    var signatureBounds = computeIqrBounds_(signatureValues);
    var routeMedian = safeMedian_(routeValues);

    drivers.forEach(function (driver) {
      driver.isHighRouteTimeOutlier = routeBounds.high !== null && driver.avgRouteMinutes > routeBounds.high;
      driver.isLowSignatureOutlier = signatureBounds.low !== null && driver.signaturePct < signatureBounds.low;

      var routeScore = 100;
      if (driver.avgRouteMinutes > 0 && routeMedian > 0) {
        routeScore = clamp_(100 - ((driver.avgRouteMinutes - routeMedian) / routeMedian) * 100, 0, 100);
      }

      driver.efficiencyScore = round1_(
        (driver.signaturePct * 0.5) +
        (routeScore * 0.3) +
        (driver.completionRate * 0.2)
      );
    });
  }

  function buildPeriodTrend_(items, keyFn, reducer, mapper) {
    var buckets = {};
    items.forEach(function (item) {
      var key = keyFn(item) || 'SEM_DATA';
      if (!buckets[key]) buckets[key] = { total: 0, signed: 0, values: [] };
      reducer(buckets[key], item);
    });
    return Object.keys(buckets).sort().map(function (key) {
      return mapper(key, buckets[key]);
    });
  }

  function groupBy_(items, keyFn) {
    var map = {};
    (items || []).forEach(function (item) {
      var key = keyFn(item);
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    return map;
  }

  function countBy_(items, keyFn) {
    var map = {};
    (items || []).forEach(function (item) {
      var key = keyFn(item);
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }

  function uniqueValues_(values) {
    var map = {};
    values.forEach(function (value) {
      if (value || value === 0) map[value] = true;
    });
    return Object.keys(map);
  }

  function uniqueCount_(values) {
    return uniqueValues_(values).length;
  }

  function topKeyByValue_(map) {
    var topKey = '';
    var topValue = -1;
    Object.keys(map).forEach(function (key) {
      if (map[key] > topValue) {
        topValue = map[key];
        topKey = key;
      }
    });
    return topKey;
  }

  function sortStopsForTimeline_(a, b) {
    return sortableStopSequence_(a) - sortableStopSequence_(b);
  }

  function sortableStopSequence_(stop) {
    if (stop.actualSequenceNum > 0) return stop.actualSequenceNum;
    if (stop.plannedSequenceNum > 0) return stop.plannedSequenceNum;
    return stop.stopIndex || 0;
  }

  function sortBySignatureAsc_(a, b) {
    if ((a.signaturePct || 0) !== (b.signaturePct || 0)) {
      return (a.signaturePct || 0) - (b.signaturePct || 0);
    }
    if ((b.totalStops || 0) !== (a.totalStops || 0)) {
      return (b.totalStops || 0) - (a.totalStops || 0);
    }
    var labelA = a.clientName || a.driverName || a.routeKey || '';
    var labelB = b.clientName || b.driverName || b.routeKey || '';
    return labelA.localeCompare(labelB);
  }

  function cleanDriverName_(value) {
    var text = toStringSafe_(value).trim();
    if (!text) return '';
    var match = text.match(/^\[[^\]]+\]\s*(.*)$/);
    text = match ? match[1].trim() : text;
    text = text.replace(/jetta/gi, ' ');
    text = text.replace(/[_\-\[\]\(\)\.\/]+/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    text = text.replace(/[^A-Za-zÀ-ÿ0-9 ]+/g, '');
    return text.replace(/\s+/g, ' ').trim();
  }

  function clamp_(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function round1_(value) {
    return Number((value || 0).toFixed(1));
  }

  function formatNumber_(value, decimals) {
    return Number(value || 0).toFixed(decimals === undefined ? 1 : decimals);
  }

  function formatDurationFromMinutes_(value) {
    var totalMinutes = Math.max(0, Math.round(Number(value || 0)));
    var days = Math.floor(totalMinutes / 1440);
    var hours = Math.floor((totalMinutes % 1440) / 60);
    var minutes = totalMinutes % 60;
    var parts = [];
    if (days) parts.push(days + 'd');
    if (hours) parts.push(hours + 'h');
    if (minutes || !parts.length) parts.push(minutes + 'min');
    return parts.join(' ');
  }

  function toDateKey_(date) {
    if (!date) return '';
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function assign_(target) {
    target = target || {};
    for (var i = 1; i < arguments.length; i += 1) {
      var source = arguments[i] || {};
      Object.keys(source).forEach(function (key) {
        target[key] = source[key];
      });
    }
    return target;
  }

  function toStringSafe_(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function toNumberSafe_(value) {
    if (value === '' || value === null || value === undefined) return 0;
    var numeric = Number(value);
    return isNaN(numeric) ? 0 : numeric;
  }

  function logInfo_() {
    if (typeof Logger === 'undefined' || !Logger || typeof Logger.log !== 'function') return;
    Logger.log.apply(Logger, arguments);
  }

  function resolveSpreadsheetId_() {
    var fromProps = PropertiesService.getScriptProperties().getProperty('DASHBOARD_SPREADSHEET_ID');
    return fromProps || DEFAULT_SPREADSHEET_ID;
  }

  function resolveWebAppUrl_() {
    var fromProps = PropertiesService.getScriptProperties().getProperty('DASHBOARD_WEBAPP_URL');
    var serviceUrl = ScriptApp.getService().getUrl();
    return fromProps || serviceUrl || DEFAULT_WEBAPP_URL;
  }

  return {
    render: render,
    include: include,
    getDashboardData: getDashboardData,
    refreshDashboardCache: refreshDashboardCache,
    warmDashboardCache: warmDashboardCache,
    getCycleDashboardData: getCycleDashboardData,
    refreshCycleDashboardCache: refreshCycleDashboardCache
  };
})();

function doGet(e) {
  try {
    var page = e && e.parameter ? e.parameter.page : '';
    return DashboardWebApp.render(page);
  } catch (e) {
    return HtmlService.createHtmlOutput(
      '<h2>Erro ao carregar o Dashboard</h2>' +
      '<pre>' + e.message + '\n' + e.stack + '</pre>'
    );
  }
}

function dashboardGetData(filters) {
  return DashboardWebApp.getDashboardData(filters || {});
}

function dashboardRefreshData(filters) {
  return DashboardWebApp.refreshDashboardCache(filters || {});
}

function dashboardGetCycleData(filters) {
  return DashboardWebApp.getCycleDashboardData(filters || {});
}

function dashboardRefreshCycleData(filters) {
  return DashboardWebApp.refreshCycleDashboardCache(filters || {});
}

function dashboardWarmCache(filters) {
  return DashboardWebApp.warmDashboardCache(filters || {});
}

function logDashboardWebAppUrl() {
  var url = ScriptApp.getService().getUrl();
  Logger.log('WebApp URL: %s', url || 'URL indisponivel (publique como Web App primeiro).');
  return url;
}

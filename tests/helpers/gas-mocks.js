function createCacheStore() {
  const values = new Map();
  const puts = [];
  const removals = [];

  return {
    puts,
    removals,
    values,
    get(key) {
      return values.has(key) ? values.get(key) : null;
    },
    put(key, value, ttl) {
      values.set(key, value);
      puts.push({ key, value, ttl });
    },
    remove(key) {
      values.delete(key);
      removals.push(key);
    }
  };
}

function createPropertiesStore(initialValues = {}) {
  const values = { ...initialValues };

  return {
    values,
    getProperty(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setProperties(entries) {
      Object.assign(values, entries);
    }
  };
}

function createResponse({ status = 200, body = '', headers = {} } = {}) {
  return {
    getResponseCode() {
      return status;
    },
    getContentText() {
      return body;
    },
    getAllHeaders() {
      return headers;
    }
  };
}

function createGasGlobals(options = {}) {
  const cache = createCacheStore();
  const scriptProperties = createPropertiesStore(options.properties);
  const fetchCalls = [];
  const fetchAllCalls = [];
  const sleeps = [];
  const logs = [];
  const fetchQueue = [...(options.fetchQueue || [])];
  const fetchAllQueue = [...(options.fetchAllQueue || [])];

  const globals = {
    CacheService: {
      getScriptCache() {
        return cache;
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return scriptProperties;
      }
    },
    UrlFetchApp: {
      fetch(url, requestOptions) {
        fetchCalls.push({ url, options: requestOptions });

        if (options.fetchImpl) {
          return options.fetchImpl(url, requestOptions, fetchCalls.length - 1);
        }

        if (!fetchQueue.length) {
          throw new Error(`No mocked fetch response for ${url}`);
        }

        const next = fetchQueue.shift();
        if (typeof next === 'function') {
          return next(url, requestOptions, fetchCalls.length - 1);
        }

        return next;
      },
      fetchAll(requests) {
        fetchAllCalls.push(requests);

        if (options.fetchAllImpl) {
          return options.fetchAllImpl(requests, fetchAllCalls.length - 1);
        }

        if (!fetchAllQueue.length) {
          throw new Error('No mocked fetchAll response available');
        }

        const next = fetchAllQueue.shift();
        if (typeof next === 'function') {
          return next(requests, fetchAllCalls.length - 1);
        }

        return next;
      }
    },
    Utilities: {
      sleep(ms) {
        sleeps.push(ms);
      }
    },
    Logger: {
      log(...args) {
        logs.push(args);
      }
    }
  };

  return {
    globals,
    cache,
    scriptProperties,
    fetchCalls,
    fetchAllCalls,
    fetchQueue,
    fetchAllQueue,
    sleeps,
    logs,
    createResponse
  };
}

module.exports = {
  createCacheStore,
  createPropertiesStore,
  createResponse,
  createGasGlobals
};

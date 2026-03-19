const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadGasRuntime(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..', '..');
  const files = options.files || ['src/greenmile-auth.js', 'src/greenmile-api.js'];
  const globals = options.globals || {};

  const context = vm.createContext({
    console,
    JSON,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    ...globals
  });

  files.forEach((file) => {
    const absolutePath = path.resolve(rootDir, file);
    const source = fs.readFileSync(absolutePath, 'utf8');
    vm.runInContext(source, context, { filename: absolutePath });
  });

  return context;
}

module.exports = {
  loadGasRuntime
};

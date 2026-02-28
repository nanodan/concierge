const Module = require('module');
const path = require('path');

function requireWithMocks(targetModulePath, mocks = {}, fromPath = __filename) {
  const callerRequire = Module.createRequire(path.resolve(fromPath));
  const targetResolved = callerRequire.resolve(targetModulePath);
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    let resolvedRequest = null;
    try {
      resolvedRequest = Module._resolveFilename(request, parent, isMain);
    } catch {
      // Fall back to raw request lookup below.
    }

    if (resolvedRequest && Object.prototype.hasOwnProperty.call(mocks, resolvedRequest)) {
      return mocks[resolvedRequest];
    }
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[targetResolved];
  try {
    return require(targetResolved);
  } finally {
    Module._load = originalLoad;
    delete require.cache[targetResolved];
  }
}

module.exports = {
  requireWithMocks,
};

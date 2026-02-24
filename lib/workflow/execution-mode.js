const EXECUTION_MODES = Object.freeze({
  DISCUSS: 'discuss',
  PATCH: 'patch',
  AUTONOMOUS: 'autonomous',
});

const EXECUTION_MODE_VALUES = new Set(Object.values(EXECUTION_MODES));

function normalizeExecutionMode(value, fallback = EXECUTION_MODES.PATCH) {
  const mode = String(value || '').toLowerCase().trim();
  if (EXECUTION_MODE_VALUES.has(mode)) return mode;
  return fallback;
}

function inferExecutionModeFromLegacyAutopilot(autopilot) {
  return autopilot === false ? EXECUTION_MODES.DISCUSS : EXECUTION_MODES.AUTONOMOUS;
}

function resolveConversationExecutionMode(conv) {
  if (conv && EXECUTION_MODE_VALUES.has(conv.executionMode)) {
    return conv.executionMode;
  }
  if (conv && conv.autopilot !== undefined) {
    return inferExecutionModeFromLegacyAutopilot(conv.autopilot);
  }
  return EXECUTION_MODES.PATCH;
}

function modeToLegacyAutopilot(executionMode) {
  return normalizeExecutionMode(executionMode) !== EXECUTION_MODES.DISCUSS;
}

function applyExecutionMode(conv, executionMode) {
  const mode = normalizeExecutionMode(executionMode);
  if (!conv || typeof conv !== 'object') return mode;
  conv.executionMode = mode;
  // Keep legacy field in sync for existing UI/exports.
  conv.autopilot = modeToLegacyAutopilot(mode);
  return mode;
}

function modeAllowsWrites(executionMode) {
  return normalizeExecutionMode(executionMode) === EXECUTION_MODES.AUTONOMOUS;
}

module.exports = {
  EXECUTION_MODES,
  EXECUTION_MODE_VALUES,
  normalizeExecutionMode,
  inferExecutionModeFromLegacyAutopilot,
  resolveConversationExecutionMode,
  modeToLegacyAutopilot,
  applyExecutionMode,
  modeAllowsWrites,
};

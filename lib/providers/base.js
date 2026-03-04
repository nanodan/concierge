/**
 * Base LLM Provider class
 * Defines the interface that all providers must implement
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const CLI_ENV_OVERRIDES = {
  claude: {
    cmd: 'CONCIERGE_CLAUDE_CMD',
    args: 'CONCIERGE_CLAUDE_ARGS',
    envFile: 'CONCIERGE_CLAUDE_ENV_FILE',
    skills: 'CONCIERGE_CLAUDE_SKILLS_DIRS',
  },
  codex: {
    cmd: 'CONCIERGE_CODEX_CMD',
    args: 'CONCIERGE_CODEX_ARGS',
    envFile: 'CONCIERGE_CODEX_ENV_FILE',
    skills: 'CONCIERGE_CODEX_SKILLS_DIRS',
  },
};

const GLOBAL_SKILLS_ENV = 'CONCIERGE_CLI_SKILLS_DIRS';
const GLOBAL_ENV_FILE = 'CONCIERGE_CLI_ENV_FILE';
const GLOBAL_ENV_ALLOWLIST = 'CONCIERGE_CLI_ENV_ALLOWLIST';
const GLOBAL_RUNTIME_DIR = 'CONCIERGE_CLI_RUNTIME_DIR';
const GLOBAL_PREPEND_SKILL_BINS = 'CONCIERGE_CLI_PREPEND_SKILL_BINS';
const CLAUDE_DISABLE_BETAS = 'CONCIERGE_CLAUDE_DISABLE_EXPERIMENTAL_BETAS';
const CLAUDE_DISABLE_AUTO_UPDATE = 'CONCIERGE_CLAUDE_DISABLE_AUTO_UPDATE';
const CLAUDE_DISABLE_UPDATE_NAG = 'CONCIERGE_CLAUDE_DISABLE_UPDATE_NAG';

function parseArgString(value) {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* fall back to tokenizing */ }
  }
  return trimmed
    .match(/(?:[^\s"]+|"[^"]*")+/g)
    ?.map((token) => token.replace(/^"|"$/g, '')) || [];
}

function parseSkillDirs(value) {
  if (!value) return [];
  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseAllowlist(value) {
  if (!value) return null;
  const items = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function loadEnvFile(filePath) {
  if (!filePath) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
    }
  } catch { /* ignore invalid env files */ }
  return null;
}

function filterEnv(env, allowlist) {
  if (!allowlist) return env;
  const filtered = {};
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      filtered[key] = env[key];
    }
  }
  return filtered;
}

function resolveSpawn(cliName) {
  const overrides = CLI_ENV_OVERRIDES[cliName] || {};
  const cmd = process.env[overrides.cmd];
  if (cmd) {
    const args = parseArgString(process.env[overrides.args]);
    return { command: cmd, prefixArgs: args };
  }
  return { command: cliName, prefixArgs: [] };
}

function cliEnv(cliName) {
  const overrides = CLI_ENV_OVERRIDES[cliName] || {};
  const env = { ...process.env };

  const allowlist = parseAllowlist(process.env[GLOBAL_ENV_ALLOWLIST]);
  const globalEnv = loadEnvFile(process.env[GLOBAL_ENV_FILE]);
  if (globalEnv) Object.assign(env, filterEnv(globalEnv, allowlist));

  const providerEnv = loadEnvFile(process.env[overrides.envFile]);
  if (providerEnv) Object.assign(env, filterEnv(providerEnv, allowlist));

  const runtimeDir = process.env[GLOBAL_RUNTIME_DIR];
  if (runtimeDir) {
    const nodeBin = path.join(runtimeDir, 'node', 'bin');
    env.PATH = nodeBin + (env.PATH ? path.delimiter + env.PATH : '');
    env.NODE_PATH = path.join(runtimeDir, 'clis', 'node_modules');
    const libDir = path.join(runtimeDir, 'lib');
    env.LD_LIBRARY_PATH = libDir + (env.LD_LIBRARY_PATH ? path.delimiter + env.LD_LIBRARY_PATH : '');
  }

  if (cliName === 'claude') {
    if (process.env[CLAUDE_DISABLE_BETAS] === '1') {
      env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
    }
    if (process.env[CLAUDE_DISABLE_AUTO_UPDATE] === '1') {
      env.CLAUDE_CODE_DISABLE_AUTO_UPDATE = '1';
    }
    if (process.env[CLAUDE_DISABLE_UPDATE_NAG] === '1') {
      env.CLAUDE_CODE_DISABLE_UPDATE_NAG = '1';
    }
  }

  prependSkillBins(env, cliName);

  return env;
}

function skillAddDirArgs(cliName) {
  const overrides = CLI_ENV_OVERRIDES[cliName] || {};
  const dirs = [
    ...parseSkillDirs(process.env[GLOBAL_SKILLS_ENV]),
    ...parseSkillDirs(process.env[overrides.skills]),
  ].filter((dir) => fs.existsSync(dir));

  const args = [];
  for (const dir of dirs) {
    args.push('--add-dir', dir);
  }
  return args;
}

function prependSkillBins(env, cliName) {
  if (process.env[GLOBAL_PREPEND_SKILL_BINS] !== '1') return;
  const overrides = CLI_ENV_OVERRIDES[cliName] || {};
  const dirs = [
    ...parseSkillDirs(process.env[GLOBAL_SKILLS_ENV]),
    ...parseSkillDirs(process.env[overrides.skills]),
  ].filter((dir) => fs.existsSync(dir));

  const binDirs = [];
  for (const dir of dirs) {
    try {
      const entries = fs.readdirSync(dir);
      for (const name of entries) {
        const binDir = path.join(dir, name, 'bin');
        if (fs.existsSync(binDir)) binDirs.push(binDir);
      }
    } catch { /* ignore */ }
  }

  if (binDirs.length > 0) {
    env.PATH = binDirs.join(path.delimiter) + (env.PATH ? path.delimiter + env.PATH : '');
  }
}

/**
 * Safe WebSocket send - checks connection state before sending
 */
function safeSend(ws, data) {
  if (!ws || !ws.send) return false;
  if (ws.readyState !== undefined && ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  ws.send(JSON.stringify(data));
  return true;
}

class LLMProvider {
  /**
   * Provider ID (e.g., 'claude', 'ollama')
   * @type {string}
   */
  static id = 'base';

  /**
   * Display name for the provider
   * @type {string}
   */
  static name = 'Base Provider';

  /**
   * Get available models for this provider
   * @returns {Promise<Array<{id: string, name: string, context?: number}>>}
   */
  async getModels() {
    throw new Error('getModels() must be implemented by provider');
  }

  /**
   * Send a message and stream the response
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} conversationId - Conversation ID
   * @param {Object} conv - Conversation object with messages, model, cwd, etc.
   * @param {string} text - User message text
   * @param {Array} attachments - File attachments
   * @param {string} uploadDir - Upload directory path
   * @param {Object} callbacks - Callback functions { onSave, broadcastStatus }
   * @param {Array} memories - Active memories to inject
   */
  async chat(ws, conversationId, conv, text, attachments, uploadDir, callbacks, _memories = []) {
    throw new Error('chat() must be implemented by provider');
  }

  /**
   * Cancel an in-progress generation
   * @param {string} conversationId - Conversation ID
   * @returns {boolean} - Whether cancellation was successful
   */
  cancel(_conversationId) {
    return false;
  }

  /**
   * Check if a generation is currently active
   * @param {string} conversationId - Conversation ID
   * @returns {boolean}
   */
  isActive(_conversationId) {
    return false;
  }

  /**
   * Generate a summary of messages (for compression)
   * @param {Array} messages - Messages to summarize
   * @param {string} model - Model to use
   * @param {string} cwd - Working directory
   * @returns {Promise<string>} - Summary text
   */
  async generateSummary(_messages, _model, _cwd) {
    throw new Error('generateSummary() must be implemented by provider');
  }
}

module.exports = {
  LLMProvider,
  safeSend,
  cliEnv,
  resolveSpawn,
  skillAddDirArgs,
};

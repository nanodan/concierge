/**
 * Provider Registry and Factory
 * Manages available LLM providers and creates instances
 */

const { LLMProvider: _LLMProvider } = require('./base');

// Registry of available providers
const providers = new Map();

/**
 * Register a provider class
 * @param {typeof LLMProvider} ProviderClass
 */
function registerProvider(ProviderClass) {
  const instance = new ProviderClass();
  providers.set(ProviderClass.id, instance);
}

/**
 * Get a provider instance by ID
 * @param {string} providerId - Provider ID (e.g., 'claude', 'ollama')
 * @returns {LLMProvider}
 */
function getProvider(providerId) {
  const provider = providers.get(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return provider;
}

/**
 * Get all registered providers
 * @returns {Array<{id: string, name: string}>}
 */
function getAllProviders() {
  return Array.from(providers.values()).map(p => ({
    id: p.constructor.id,
    name: p.constructor.name,
  }));
}

/**
 * Check if a provider is registered
 * @param {string} providerId
 * @returns {boolean}
 */
function hasProvider(providerId) {
  return providers.has(providerId);
}

/**
 * Initialize all providers
 * This should be called at startup
 */
function initProviders() {
  // Import and register providers
  const ClaudeProvider = require('./claude');
  const OllamaProvider = require('./ollama');
  const CodexProvider = require('./codex');

  registerProvider(ClaudeProvider);
  registerProvider(OllamaProvider);
  registerProvider(CodexProvider);

  console.log(`[PROVIDERS] Initialized ${providers.size} providers: ${Array.from(providers.keys()).join(', ')}`);
}

module.exports = {
  registerProvider,
  getProvider,
  getAllProviders,
  hasProvider,
  initProviders,
};

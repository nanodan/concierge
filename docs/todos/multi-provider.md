# Multi-Provider Support TODO

## Overview

The app is currently hardcoded to the Claude CLI. Supporting OpenAI, Google, and other providers requires an abstraction layer that decouples model interaction from the rest of the backend.

**Priority:** Medium
**Effort:** High

---

## Current Coupling Points

| What | Where | Anthropic-specific |
|------|-------|--------------------|
| CLI spawn | `server.js` `spawnClaude()` | `spawn('claude', args)` with Claude-only flags |
| Stream parsing | `server.js` `processStreamEvent()` | Claude's `stream_event`, `content_block_delta`, `text_delta` format |
| Session resume | `server.js` line ~676 | `--resume <sessionId>` — Claude CLI only |
| Autopilot mode | `server.js` line ~672 | `--dangerously-skip-permissions` — Claude CLI only |
| Model list | `server.js` `MODELS` constant | Hardcoded Anthropic models |
| Cost tracking | `server.js` line ~839 | `total_cost_usd` from Claude result events |
| Token tracking | `server.js` line ~842-843 | `total_input_tokens`, `total_output_tokens` from Claude |
| Working directory | `server.js` line ~680 | `--add-dir` — Claude CLI concept, not relevant to API-only providers |

---

## Proposed Architecture

### Provider Interface

Create a common contract that all providers implement:

```js
// providers/base.js
class Provider {
  // Returns an async generator yielding { type: 'delta', text } and finally { type: 'result', text, cost?, inputTokens?, outputTokens?, duration? }
  async *sendMessage(text, history, options) { }

  // Cancel an in-flight request
  cancel() { }

  // Provider-specific capabilities
  get capabilities() {
    return {
      sessionResume: false,   // Can resume sessions (Claude only)
      codeExecution: false,   // Can run tools/code (Claude CLI)
      imageInput: false,      // Supports vision
      streaming: true,        // Supports streaming
    };
  }
}
```

### Provider Implementations

#### Claude Provider (keep current approach)
- Wraps the existing `spawnClaude` / `processStreamEvent` logic
- Only provider with `sessionResume: true` and `codeExecution: true`
- Uses CLI spawn, same as today

#### OpenAI Provider
- Uses `openai` npm package
- Supports: GPT-4o, GPT-4o-mini, o1, o3, etc.
- Streaming via `stream: true` on chat completions
- Message history replay (no session resume)
- Vision support via image URLs or base64 in content blocks
- Requires `OPENAI_API_KEY` env var

#### Google Provider
- Uses `@google/generative-ai` npm package
- Supports: Gemini 2.5 Pro, Flash, etc.
- Streaming via `generateContentStream()`
- Message history replay
- Vision support via inline data
- Requires `GOOGLE_API_KEY` env var

#### Future Providers
- Mistral, Groq, local models via Ollama, etc.
- Same interface, drop-in

### Model Registry

Replace the hardcoded `MODELS` array with a dynamic registry:

```js
// models.js
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    models: [
      { id: 'opus', name: 'Opus 4.6', context: 200000 },
      { id: 'sonnet', name: 'Sonnet 4.5', context: 200000 },
      { id: 'haiku', name: 'Haiku 4.5', context: 200000 },
    ],
    envKey: null, // Uses Claude CLI auth
  },
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', context: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', context: 128000 },
      { id: 'o3', name: 'o3', context: 200000 },
    ],
    envKey: 'OPENAI_API_KEY',
  },
  google: {
    name: 'Google',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', context: 1000000 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', context: 1000000 },
    ],
    envKey: 'GOOGLE_API_KEY',
  },
};
```

Only show providers whose API key is configured (Claude always available via CLI auth).

### Conversation Changes

- Add `provider` field to conversation metadata alongside `model`
- Store as `{ provider: 'openai', model: 'gpt-4o' }`
- Default to `{ provider: 'anthropic', model: 'sonnet' }` for backwards compat
- Non-Claude providers don't get: session resume, autopilot, working directory, tool use

### Message History for Non-Claude Providers

Claude CLI handles history internally via `--resume`. Other providers need the full message history sent with each request:

```js
// For OpenAI/Google, convert stored messages to their format
const history = conv.messages.map(m => ({
  role: m.role,
  content: m.text,
}));
```

---

## Implementation Steps

### Phase 1: Provider abstraction (refactor only, no new providers)
1. Create `providers/` directory
2. Extract current Claude logic into `providers/claude.js`
3. Create `providers/base.js` with the interface
4. Refactor `spawnClaude` / `processStreamEvent` to go through the provider
5. Refactor `MODELS` to use the registry pattern
6. Verify everything still works identically

### Phase 2: OpenAI provider
1. `npm install openai`
2. Create `providers/openai.js`
3. Implement streaming chat completions
4. Handle message history conversion
5. Add OpenAI models to registry (gated on `OPENAI_API_KEY`)
6. Update frontend model picker to show provider groups

### Phase 3: Google provider
1. `npm install @google/generative-ai`
2. Create `providers/google.js`
3. Implement streaming generation
4. Handle message history + image conversion
5. Add Gemini models to registry (gated on `GOOGLE_API_KEY`)

### Phase 4: Frontend updates
1. Model picker grouped by provider with headers
2. Show provider-specific capabilities (e.g. hide autopilot toggle for non-Claude)
3. Provider badge on conversation cards
4. Cost tracking normalization across providers
5. Context bar reads correct token limit per model

---

## Key Decisions to Make

1. **Claude: keep CLI or switch to SDK?** CLI gives tool use/code execution for free. SDK would be more consistent with other providers but loses agentic capabilities.
2. **Image handling per provider:** Claude reads files via tool. OpenAI/Google need base64 or URLs in the message content. Upload pipeline needs provider-aware branching.
3. **Dependencies:** Currently zero runtime deps besides `express`, `ws`, `uuid`. Adding `openai` and `@google/generative-ai` changes that.
4. **API key management:** Env vars? Config file? Settings UI? Need a way to configure keys without exposing them to the frontend.
5. **Streaming format differences:** Each provider's streaming format is different. The provider abstraction must normalize to a common delta/result format before it hits WebSocket code.

---

## Files Affected

| File | Changes |
|------|---------|
| `server.js` | Replace `spawnClaude`/`processStreamEvent` with provider dispatch, update MODELS, add provider to conversation model |
| `providers/base.js` | New — provider interface |
| `providers/claude.js` | New — extracted from current server.js |
| `providers/openai.js` | New |
| `providers/google.js` | New |
| `public/app.js` | Model picker grouped by provider, capability-aware UI |
| `public/style.css` | Provider group headers in model dropdown |
| `package.json` | New dependencies (`openai`, `@google/generative-ai`) |

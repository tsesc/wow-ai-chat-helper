// The AI backends the bridge can use, by the name config.json's "agent" holds. A provider
// is one module with the interface described in docs/PROVIDERS.md; adding one means adding
// its file here (and the checklist in that document).
'use strict';

const PROVIDERS = {
  claude: require('./claude'),
  codex: require('./codex'),
};

const DEFAULT_AGENT = 'claude';

// The provider names, in registry order.
function list() { return Object.keys(PROVIDERS); }

// name ('' / undefined -> the default) -> the provider. An unknown name throws an Error
// that lists the valid ones, so a typo in config.json is reported, not guessed around.
function get(name) {
  const key = String(name || DEFAULT_AGENT).trim().toLowerCase();
  const p = PROVIDERS[key];
  if (!p) throw new Error(`unknown agent "${name}" (available: ${list().join(', ')})`);
  return p;
}

module.exports = { get, list, DEFAULT_AGENT };

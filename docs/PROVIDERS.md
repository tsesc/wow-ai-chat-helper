# AI providers

The bridge does not talk to a model API itself. It drives a **local CLI** that the user has
already installed and logged in to (Claude Code, OpenAI Codex), so the user's own
subscription is the only credential and the project never handles an API key. Each CLI is
wrapped by a **provider**: one file in `bridge/providers/` with a small, fixed interface.
`config.json`'s `"agent"` picks which provider the bridge uses.

This page is for developers who want to add another backend (Gemini CLI, a local model
runner, an HTTP API behind a small CLI, ...). It covers the interface, how the bridge uses
it, how to test a provider without network access, and the checklist for a new one, with
`bridge/providers/codex.js` as the worked example.

## Where things are

| File | What it holds |
| --- | --- |
| `bridge/providers/index.js` | The registry: `get(name)`, `list()`, `DEFAULT_AGENT` (`claude`) |
| `bridge/providers/cli.js` | Shared helpers: `resolveCli` (find an executable), `unwrapShim` (npm `.cmd` shims on Windows), `killTree`, `runCapture` (run a short status command), `oneLine` |
| `bridge/providers/claude.js` | Claude Code: a persistent `stream-json` process per session, one-shot `claude -p` as the fallback |
| `bridge/providers/codex.js` | Codex: one `codex exec --json` run per request |
| `bridge/ai.js` | `AiRunner`: system prompt, batching, validation, retries, link tokens. Provider-independent |

The split matters: **a provider only moves text**. It receives a system prompt and a user
prompt and returns the model's reply as a string. Everything about WoW (the per-language
system prompt, the known-terms block, the JSON schema, validation, retries, restoring
`[I1]` link tokens) lives in `ai.js` and is the same for every provider.

## The interface

A provider module exports an object with these fields.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | The registry key and the value of `"agent"` in `config.json` (lowercase, e.g. `codex`). Also the prefix of error messages (`codex CLI not found: ...`). |
| `displayName` | string | Shown to people: bridge banner (`agent    : Codex, ...`), the login line (`Codex : login ok`), setup's report. |
| `installHint` | string | One sentence on how to install it and where to set the path, used when the CLI is not found. |
| `loginHint` | string | One sentence on how to log in, used when `loginStatus` says no. |
| `pathKey` | string | The `config.json` key that overrides the executable path (`claudePath`, `codexPath`). |
| `defaultModels` | `{ explain, translate, detail }` | Model id per kind of request. `''` means "the CLI's own default" (do not pass a model flag). `config.json`'s `models` overrides per key; a missing or empty key falls back to this. Avoid pinning ids that expire; Codex uses `''` everywhere. |
| `resolveCommand(cfg, opts?)` | → `{ file, args, found, note }` | What to spawn. `cfg` is the bridge config (read your `pathKey` from it). `opts` (`{ platform, env, home }`) exists so tests can simulate Windows. Build it on `cli.resolveCli`, which handles a configured path (a `.js` runs with the bridge's node, a `.cmd` shim is unwrapped), the usual install folders, `PATH`, and npm shims. `note` explains a `found: false`. |
| `loginStatus(cfg)` | → `Promise<{ ok, detail, warning? }>` | Is the CLI logged in? Must not call the model: use the CLI's own status command (`claude auth status`, `codex login status`) through `cli.runCapture`. `cfg` may carry `command` (an already resolved command); otherwise resolve it yourself. `detail` is a short human sentence (`Logged in using ChatGPT`, `Not logged in (run \`codex login\`)`). Optional `warning`: a non-fatal note the bridge window and setup's report show (Codex: a CLI older than the tested version). Never reject. |
| `describeMode(cfg)` | → string | Optional. How requests run, for the banner's `models` line (`persistent mode (Sonnet one-shot)`, ``one `codex exec` per batch``). |
| `createSession(o)` | → session | See below. |

### Sessions

```js
const session = provider.createSession({
  role,          // 'explain' | 'translate' | 'detail' (informational; ai.js picks the model)
  model,         // the model id for this session, '' = the CLI default
  systemPrompt,  // the full per-language system prompt from ai.js
  cfg,           // the bridge config: timeoutMs, workDir, extraArgs, persistent, ... and your pathKey
  log,           // (line) => void, the bridge window
  command,       // optional: the resolved { file, args, found } (AiRunner passes it)
  oneShot,       // true: this session answers exactly one ask() and is closed afterwards
});
session.persistent;                                   // boolean: keeps a process between asks
session.busy;                                         // boolean (getter): an ask is in flight
const text = await session.ask(prompt, { timeoutMs }); // the model's reply text
session.close(why);                                   // stop everything this session started
```

- `ask(prompt, opts)` resolves with the **raw reply text** of the model. `ai.js` extracts
  and validates the JSON, so do not parse or reshape it. `opts.timeoutMs` (optional)
  overrides `cfg.timeoutMs` for this call.
- `ask` **rejects with an `Error` whose message is the short reason** that ends up in the
  game UI (cut to 160 characters): `timeout`, `codex returned an empty reply`,
  `codex exited (1): ...`, `codex not logged in: ...`. Put `not logged in` in the message
  when it is an authentication problem: the startup check looks for that phrase.
- One `ask` at a time per session: `AiRunner` never overlaps them.
- A timeout must kill the whole process tree (`cli.killTree`), and a stuck CLI must never
  hang an `ask` forever.
- `close(why)` kills whatever is running; an `ask` in flight rejects. `AiRunner` closes a
  persistent session that returned an unparseable reply and starts a new one.
- Spawn the CLI with `cwd: cfg.workDir` (an empty temp folder, so no project files,
  `CLAUDE.md` or `AGENTS.md` are near it), `windowsHide: true`, and
  `detached: process.platform !== 'win32'` (so `killTree` can signal the group).
- The model must not be able to use tools. The prompt says chat text is data, but a CLI
  agent that can run shell commands is still the wrong shape for a chat helper: switch
  tools off with the CLI's own flags, and verify it (see the Codex notes below).

### Lifecycle

```
bridge start
  └─ providers.get(cfg.agent)            unknown name -> exit 2: unknown agent "x" (available: claude, codex)
  └─ AiRunner: provider.resolveCommand(cfg)
       banner: "agent    : <displayName>, <file args>"  or  NOT FOUND - <note>
  └─ checkLogin(): provider.loginStatus()  -> not ok: "!! <displayName> CLI is not logged in (...). <loginHint>"
                   then one tiny one-shot ask -> "<displayName> : login ok"
requests
  └─ x / t: queued per (model, language); after batchWindowMs one prompt with up to 8 requests
            goes to the batch session (created once per model+language, kept, closed on
            language change or after a bad reply)
  └─ d and every retry: a new oneShot session, ask once, close
bridge stop
  └─ close() on every session
```

A provider decides itself whether a session is persistent. Claude keeps one process per
session (`persistent: true` unless `oneShot`, `cfg.persistent === false` or the model is
Sonnet); Codex has no long-lived input mode, so its sessions are stateless and every
`ask` spawns one run.

## Worked example: `codex.js`

1. **Command line.** One run per ask, prompt on stdin (`-`), JSON lines on stdout:

   ```
   codex exec --json --ephemeral --sandbox read-only --skip-git-repo-check
              --ignore-user-config --ignore-rules --disable shell_tool --disable unified_exec
              -c web_search="disabled" -c model_reasoning_effort="low"
              -c developer_instructions="<system prompt>"
              [-m <model>] [extraArgs...] -
   ```

   **Tested on codex-cli 0.154.0** (`TESTED_VERSION` in `codex.js`). An older CLI gets a
   warning in the bridge window and in setup's report ("flags may be missing"), not a
   failure.

   Measured on codex-cli 0.154.0: with `--sandbox read-only` alone Codex still ran `ls`;
   with `shell_tool` and `unified_exec` disabled it answers that it cannot run commands.
   Codex has no system-prompt flag; `developer_instructions` (a TOML string, written with
   `tomlString`) ranks above the user turn. `--ignore-user-config` keeps the user's
   `config.toml` (MCP servers, hooks, profiles) out of every run; authentication still
   comes from `CODEX_HOME`. Extra `-c` overrides go in `extraArgs`; for the same key the
   last `-c` wins, so `extraArgs: ["-c", "model_reasoning_effort=\"medium\""]` replaces the
   default `low` (measured: about 8.9 s per run with `low`, 10.4 s with Codex's default,
   average of three runs of a one-line prompt). Verified that `developer_instructions` is
   honoured: "Answer in uppercase only." + "say hello" → `HELLO!`.

2. **Parsing.** `parseExecOutput(stdout, code, stderr)` reads the events:
   `item.completed` with `item.type === "agent_message"` (the reply is the **last** one; a
   short preamble message can come first), `turn.completed` (success), `turn.failed`
   (failure), and `error` events, which can be transient (`Reconnecting... 2/5`) and only
   count when the run ends without `turn.completed`. Empty reply, no JSON at all, non-zero
   exit without events: each has its own message.

3. **Finding it.** `resolveCommand` passes `cli.resolveCli` a spec: command `codex`,
   `pathKey: 'codexPath'`, and `native(script)`, which points from npm's `bin\codex.js`
   launcher to the `codex.exe` the package ships, so on Windows the bridge runs the binary
   directly instead of through `codex.cmd`.

4. **Login.** `codex login status` exits 0 ("Logged in using ChatGPT", printed on
   stderr) or 1 ("Not logged in"). It rejects `--ignore-user-config` (0.154.0: "unexpected
   argument"), so the status check reads the user's `config.toml` while `exec` ignores it.
   The answer comes from the auth stored in `CODEX_HOME`, which both commands share; only
   a `config.toml` that changes the model provider could make the two disagree. The same
   check reads `codex --version` for the version warning.

## Testing a provider without the network

Tests never call a real model. Each CLI has a stand-in in `tests/fakes/` that speaks the
same protocol, shaped like a captured real run:

- `tests/fakes/fake-claude.js`: `-p --output-format json`, the `stream-json` persistent
  mode, `--version`, `auth status`.
- `tests/fakes/fake-codex.js`: `exec --json ... -`, `login status`, `--version`.

A fake reads the prompt, builds a valid JSON reply for the requests in it (the array
after `Requests`), and changes behaviour on markers in the text: `#empty`, `#exit`,
`#notjson`, `#crash`, `#autherr`, `#preamble`, `#reconnect`, `#hang` for Codex. It logs
every run (arguments, cwd, system prompt, prompt) to the file named by an environment
variable (`FAKE_CODEX_LOG`, `FAKE_CLAUDE_LOG`) so tests can assert on what the CLI
received. `FAKE_CODEX_LOGGED_OUT=1` / `FAKE_CLAUDE_LOGGED_OUT=1` make the status
commands say "not logged in".

Point the provider at the fake through its path key: a `.js` path is run with the
bridge's node on every platform.

```js
const codex = require('../bridge/providers/codex');
const s = codex.createSession({ model: '', systemPrompt: 'SP',
  cfg: { codexPath: FAKE_CODEX, workDir: tmp, timeoutMs: 10000 } });
assert.strictEqual(await s.ask('reply with the single word pong'), 'pong');
await assert.rejects(s.ask('x #empty'), { message: 'codex returned an empty reply' });
```

`tests/providers_test.js` is the template: registry, interface shape, path lookup
(including a simulated Windows npm shim), command line, the output parser, `ask` success
and every failure, timeouts killing the process, `loginStatus` both ways, and `AiRunner`
running on the provider. Before you submit, capture one real run of your CLI
(`... --json "reply with the single word pong"`) and make the fake print the same shape.

## Checklist for a new provider

1. **`bridge/providers/<name>.js`**: the interface above. Start the file with a comment
   that says what the CLI is, the exact command line, and why each flag is there. Credit
   any code you adapted.
2. **`bridge/providers/index.js`**: add it to `PROVIDERS`.
3. **Config**: add `<name>Path` to `bridge/config.example.json` and to `CONFIG_DEFAULTS` in
   `bridge/bridge.js`, and to `DEFAULTS` in `bridge/ai.js`.
4. **`setup.js`**: add a `--<name>` path flag in `applyAgentArgs` (the report lists every
   registered provider on its own; `--agent <name>` already works).
5. **Tests**: `tests/fakes/fake-<name>.js` and cases in `tests/providers_test.js`
   (the interface-shape test covers the new entry automatically). `npm test` must pass.
6. **Launchers**: `bridge/start.ps1` (log-in check for `"agent": "<name>"`) and
   `install.ps1` (`-Agent <name>` in the `ValidateSet`, install and log-in steps). Check
   both parse: `pwsh -c "[System.Management.Automation.Language.Parser]::ParseFile('install.ps1', [ref]$null, [ref]$e); $e"`.
7. **Docs**: `README.md` and `README.zh-TW.md` (Requirements, Install, AI backends,
   Troubleshooting), `AGENTS.md` (log-in check), this page (the file table).
8. **Try it live**: `node -e` a `createSession().ask('reply with the single word pong')`,
   a real request through `new AiRunner({ agent: '<name>' })`, and the bridge with
   `"agent": "<name>"` against the game.

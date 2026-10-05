# Claude Code CLI: flags and latency for the chat helper

Measured 2026-10-05 on the Linux dev box (not the Windows game PC), Claude Code
**2.1.289**, logged in with a subscription (OAuth), model alias `haiku` →
`claude-haiku-4-5-20251001`. 15 model calls in total. Reproduce with
`npm run test:live` (`tests/live/claude_live.js`, 8 calls; `--only persistent` for 4).

## TL;DR

- Every flag the spec names works on 2.1.289, including `--tools ""` and
  `--setting-sources ""`. Subscription auth works without `--bare` (which, per
  `claude --help`, reads only `ANTHROPIC_API_KEY`/apiKeyHelper, so it must stay off).
- **Haiku 4.5 thinks by default, and that dominates latency**: 24–82 s per call. Setting
  the env var **`MAX_THINKING_TOKENS=0`** brings it down to **~2–3 s per turn (persistent)**
  and **~4.5 s per call (one-shot)**. `--effort low` does *not* help (6391 thinking tokens,
  59 s). `bridge/ai.js` sets `MAX_THINKING_TOKENS=0` for every claude it starts (config
  `maxThinkingTokens`, default `0`; `null` leaves the environment alone).
- **Persistent stream-json mode works**: 4 turns in one process, all replies valid.
  `persistent: true` stays the default.
- Output validated against spec 3.2 for all samples. One-shot output was sometimes
  wrapped in a ```` ```json ```` fence; `ai.extractJson` strips it.
- Default `timeoutMs` 60000 would have timed out with thinking on; with it off the
  slowest observed call was 4.5 s.

## Flags in ai.js

```
one-shot:   claude -p --output-format json --model <m> --tools "" --system-prompt <SP>
                   --setting-sources "" --strict-mcp-config --no-session-persistence
            (prompt on stdin)
persistent: claude -p --input-format stream-json --output-format stream-json --verbose
                   --model <m> --tools "" --system-prompt <SP> --setting-sources ""
                   --strict-mcp-config --no-session-persistence
            (one {"type":"user","message":{"role":"user","content":[{"type":"text","text":...}]}}
             line per turn on stdin; a turn ends with the {"type":"result",...} event)
env:        MAX_THINKING_TOKENS=0
cwd:        an empty folder, <os tmpdir>/wow-chat-helper-cwd
```

Flag checks (from `claude --help` on 2.1.289 and from the runs below):

| Flag | Result |
|---|---|
| `--tools ""` | Accepted; help text: `Use "" to disable all tools`. Runs completed with no tool use. |
| `--setting-sources ""` | Accepted, no error. The trivial call below used 375 input tokens in total, so the (large) user `~/.claude/CLAUDE.md` was not loaded (inference from the token count). |
| `--strict-mcp-config` | Accepted; no MCP servers started. |
| `--no-session-persistence` | Accepted. |
| `--system-prompt` | Replaces the default system prompt (375 input tokens for a 6-word prompt + "hi"). |
| `--input-format stream-json` + `--output-format stream-json --verbose` | Works; multiple turns in one process. |
| `--bare` | Not used: help says auth is then strictly `ANTHROPIC_API_KEY`/apiKeyHelper, "OAuth and keychain are never read". |
| `--effort low` | Accepted, but thinking stayed on (6391 thinking tokens). Not used. |

## Samples

```
#1 x CHANNEL:LookingForGroup Grimtusk  "LF1M tank HC DM, inv"
#2 x PARTY Lunaria  ctx "Lunaria: nice pull\nGrimtusk: [Cruel Barb] dropped"  "need or greed?"
#3 x WHISPER Thalric  "ty for the run gg"
```

## Run 1: defaults (thinking on), 8 calls

`node tests/live/claude_live.js --show` before `MAX_THINKING_TOKENS=0` was added.

| Call | ms | Valid |
|---|---|---|
| one-shot #1 | 50780 | 1/1 |
| one-shot #2 | 47530 | 1/1 |
| one-shot #3 | 37661 | 1/1 |
| one-shot batch of 3 | 82403 | 3/3 |
| persistent turn 1 #1 (incl. process start) | 38786 | 1/1 |
| persistent turn 2 #2 | 38169 | 1/1 |
| persistent turn 3 #3 | 24377 | 1/1 |
| persistent turn 4 batch of 3 | 12057 | 3/3 |

Process starts in persistent mode: 1. Wall time for the whole script: 5 min 32 s.

## Why so slow: one trivial call

```
cd /tmp/wch-probe && claude -p --output-format json --model haiku --tools "" \
  --system-prompt "Reply with the single word ok." --setting-sources "" \
  --strict-mcp-config --no-session-persistence <<< "hi"
```

Wall 6.24 s; `duration_api_ms` 3905, `usage.input_tokens` 375, `output_tokens` 374 of which
`thinking_tokens` **359**, `ttft_ms` 4161, `time_to_request_ms` 379. So process start-up is
small (~0.4 s to the request); the time is thinking.

## Thinking off vs effort low: sample #1, one-shot, 2 calls

Same command as ai.js one-shot, prompt = `ai.buildPrompt([sample #1])`:

| Variant | Wall | duration_api_ms | output tokens | thinking tokens |
|---|---|---|---|---|
| `MAX_THINKING_TOKENS=0` | **4.51 s** | 2196 | 224 | 0 |
| `--effort low` | 59.40 s | 57710 | 6606 | 6391 |

Both replies validated; the thinking-off one came in a ```` ```json ```` fence.

## Run 2: persistent with `MAX_THINKING_TOKENS=0`, 4 calls

`node tests/live/claude_live.js --only persistent --show` (current ai.js):

| Turn | ms | Valid |
|---|---|---|
| 1 #1 (incl. process start) | 3132 | 1/1 |
| 2 #2 | 2135 | 1/1 |
| 3 #3 | 1850 | 1/1 |
| 4 batch of 3 (ids 11–13) | 3169 | 3/3 |

Process starts: 1. Wall time for the whole script: 10.3 s.

Validated output (after `ai.matchResults`, i.e. exactly what the bridge publishes):

```json
{"id":1,"kind":"x","status":"done","zh":"徵 1 名坦打英雄難度死亡礦坑，想去的密我邀請",
 "terms":[{"term":"LF1M","expansion":"Looking For 1 More","zh":"還缺一人"},
          {"term":"HC","expansion":"Heroic","zh":"英雄難度"},
          {"term":"DM","expansion":"Deadmines","zh":"死亡礦坑"},
          {"term":"inv","expansion":"invite","zh":"邀請（組隊）"}],
 "replies":[{"en":"inv pls, tank here","zh":"請邀我，我是坦","tone":"casual"},
            {"en":"Hi! I can tank, could I get an invite?","zh":"嗨，我可以坦，能邀我嗎？","tone":"polite"},
            {"en":"tank, inv","zh":"坦，邀我","tone":"short"}]}
{"id":2,"kind":"x","status":"done","zh":"需求還是貪婪？",
 "terms":[{"term":"need","expansion":"need (for main spec)","zh":"需求"},
          {"term":"greed","expansion":"greed (for off spec or vendor)","zh":"貪婪"}],
 "replies":[{"en":"need","zh":"需求","tone":"short"},
            {"en":"greed, not my spec","zh":"貪婪，不是我的專精","tone":"casual"},
            {"en":"anyone need? if not i'll greed","zh":"有人需求嗎？沒有的話我貪婪","tone":"polite"}]}
{"id":3,"kind":"x","status":"done","zh":"謝謝帶團，辛苦了",
 "terms":[{"term":"ty","expansion":"thank you","zh":"謝謝"},
          {"term":"gg","expansion":"good game","zh":"打得好/辛苦了"}],
 "replies":[{"en":"ty! gg","zh":"謝謝，你也很棒","tone":"casual"},
            {"en":"thanks for coming, was fun","zh":"謝謝你來，很開心","tone":"polite"},
            {"en":"ty!","zh":"謝謝！","tone":"short"}]}
```

Notes:
- Example #1 is close to the system prompt's built-in example (that sample is used as the example in the prompt), so it shows format compliance more than generalization. #2 and #3 are not in the prompt.
- Between run 1 and run 2 the prompt gained a hint for `gg` (run 1 translated it as 很爽 or left
  it as `gg`); run 2 gives 辛苦了.
- In the persistent batch turn the model repeated its earlier answers for the same texts
  word for word: the conversation is shared across turns. That is fine for this use (ids
  are matched), and `persistentMaxTurns` (40) bounds how much context builds up.

## Not measured

- The Windows game PC (process start-up on Windows, the npm `.cmd` launcher vs the
  native `claude.exe`). The persistent mode avoids start-up per request anyway.
- `sonnet` (detail requests): not called, to stay within the call budget.
- One-shot batch latency with thinking off: not re-run (one single call measured: 4.5 s).

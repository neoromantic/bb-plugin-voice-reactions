# How it works

One message goes through three steps: find it, decide on a reaction, speak. Each step runs in
the background; BB never waits for the plugin, and a failure only writes a log line.

## Which messages count

The plugin reacts to what a person typed, once per message, and to nothing else.

- **Sent right away** (a thread's first prompt, a follow-up, a steer): the thread's event log
  records `client/turn/requested`. The log is read only for a thread BB just announced with
  `experimental_thread.read`, or with the debounced `experimental_thread.events` about a second
  later, and only when the thread's `lastReadAt` moved: BB core stamps it when it records a
  user turn request. Agent output therefore costs no read, and no thread is polled.
- **Queued behind a running turn**: `message.queued` with a wait of `thread-busy`,
  `turn-starting`, `stopping` or `interaction` is handled when it is typed. When BB delivers the
  row later, the turn request with the same text in the same thread is skipped.

A record counts as typed by a person when `initiator` is `user` and it has no sender thread, no
plugin origin, no retry marker and no system label. Agents start child threads with the same
marks, so a thread's first prompt counts only in a root thread; later messages typed into a child
thread count. Agent-only blocks, parts that start with `[bb message from thread:` or
`[bb system]`, and standalone slash commands such as `/compact` are dropped; a prompt that
starts with a path is an ordinary message. Records from before the plugin loaded are ignored,
and each request id and queue row is handled once.

Known gaps:

- A queued message edited before delivery is classified again when it is delivered.
- A queued row that waits for something other than a running turn (an environment, a machine, a
  schedule) is handled at delivery, not when typed.
- A message sent from a terminal with `bb thread tell` outside any thread looks typed.
- If BB stops stamping `lastReadAt` on user turns, messages sent right away stop being seen;
  queued ones still are.

## The decision

The `reactions` setting is one multiple-choice question. Lines shaped `name: description` are
the options, every other line is the question, and `none` means stay silent. The decision model
gets the message (up to 800 characters) and what it replies to: the lines quoted with `>`, or
else the last 300 characters of the thread's previous reply.

The chosen option leads. Up to two other options with a probability of at least 0.2 are mixed
in, so a message can be 60% `grumble` and 30% `tired`. The voice model is told the order, not
the numbers: given "80%" it once announced that 80 percent of a database was gone. A refused question counts as `none`.

| Provider          | Endpoint                                    | Default model                 |
| ----------------- | ------------------------------------------- | ----------------------------- |
| TypeSafe          | `api.typesafe.ai/v1/systemone`              | `jev-latest`                  |
| OpenAI            | `api.openai.com/v1/decisions`               | `gpt-6-luna`                  |
| Vercel AI Gateway | `ai-gateway.vercel.sh/v1/decisions`         | `typesafe-ai/jev`             |
| OpenRouter        | `openrouter.ai/api/alpha/decisions` (alpha) | `openai/gpt-6-luna-decisions` |

With `decisionProvider` on `auto` the first provider in this order that has a key is used. An
OpenAI project without access to `gpt-6-luna` answers HTTP 403; add a TypeSafe key, or set
`decisionProvider` to a provider that works for you.
TypeSafe and OpenRouter take the question as `state` and `criteria`; OpenAI and Vercel take
`input` and `choices`. A decision has 5 seconds.

## The voice

The voice model writes and speaks the line itself; there is no text step in between. Its
instructions are the chosen role, or your own `persona` text ([roles](roles.md)), and it gets
one message:

```text
Reaction to give: grumble (irritation, indignation or swearing: commiserate, soothe). With a touch of: tired (…)
The message: """…"""
It replies to: """…"""
OUTPUT LANGUAGE: English. Every word of your line is in that language; your accent only changes how the words sound.
React now, in English.
```

- **OpenAI** (`gpt-realtime` over the Realtime WebSocket, each role with its own voice): one socket is opened
  when the plugin loads and kept after each line, so the session is ready when a message
  arrives. If OpenAI closes it while idle, nothing reconnects; the next message opens a new one
  while the decision is made. Until a decision says to speak, only the handshake has been sent.
  Each line is a `response.create` with `conversation: "none"` and its own input, so threads
  never share context.
- **OpenRouter** (`openai/gpt-audio` through a streamed chat completion, voice `alloy`): one
  HTTPS request per line. The audio arrives as fragments of one base64 string, so the
  characters left over after each whole group of four are carried into the next fragment. It
  starts slower than the Realtime socket.

Audio is 24 kHz 16-bit mono PCM. The player starts when the decision says to speak, and each
chunk is written to its stdin as it arrives; nothing is buffered or written to disk. One line
plays at a time and nothing queues: a reaction that arrives while a line is still playing is
skipped, and its message is still classified.

Limits: 10 seconds for the handshake and the first audio, 45 seconds for a line, and the player
is stopped 3 seconds after the audio it received should have ended. A failed line closes the
socket, so a late chunk cannot reach the next one.

OpenAI has announced that `gpt-realtime` shuts down on 2027-01-20
([Realtime reference](https://developers.openai.com/api/reference/resources/realtime/server-events));
set `voiceModel` to its successor before then. In one measurement on a warm session in November
2026, first audio came after about 450 ms with `gpt-realtime`, 530–660 ms with
`gpt-realtime-mini` and 910–1020 ms with `gpt-realtime-1.5`.

## Keys and data

Keys are read from the plugin's secret settings first, then from the BB server's environment
(`TYPESAFE_API_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`). When a key
is missing from both and `/bin/zsh` exists, the plugin runs zsh once at load with a fixed
argument that prints those four variables: an app started from the macOS Dock does not inherit
what `~/.zshenv` exports.

Keys travel only in `Authorization` headers. They are never in a command line, and the player
gets the server's environment without any variable whose name looks like a secret. Logs hold
request ids, reaction names, timings and status codes: no message text, no response bodies and
no text of other programs' errors.

What leaves the machine: the message and what it replies to go to the decision provider for
every message a person types, and to the voice provider when a reaction is spoken.

## Tests

`bun test` runs the plugin on BB's fake plugin host with real `fetch`, `ws` and `spawn`. A local
server stands in for every provider, and `test/player-stub.ts` stands in for the player, so no
test needs a key, the network or a sound device. `test/harness.ts` wraps the host's logger so a
test can wait for a log line instead of sleeping.

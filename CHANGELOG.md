# Changelog

## 0.1.1

- Align the SQLite type dependency with the BB SDK peer range so a clean Git install resolves dependencies.

- The `shopkeeper` role now speaks English with a Thai accent for every message. In 0.1.0 a
  message written in Russian could make it answer entirely in Thai.

## 0.1.0

First release.

- Reacts out loud to the messages a person types to their agents: the first prompt of a root
  thread, follow-ups, steers and follow-ups queued behind a running turn. Agent, system, plugin
  and retried messages are ignored, and each message is handled once.
- A decision model picks the reaction from the `reactions` setting, or `none` for silence, and
  can mix close runners-up. Works with TypeSafe, the OpenAI Decisions API, Vercel AI Gateway and
  OpenRouter.
- A voice model speaks one short line in the role you pick: twelve built-in characters, a
  random one per line, or your own `persona` text. OpenAI Realtime over a warm socket, or
  OpenRouter through a streamed chat completion.
- Plays raw PCM through ffplay, SoX `play`, `aplay` or `paplay`, found automatically, or through
  the command in the `player` setting.
- Keys come from the plugin's secret settings or the server's environment.

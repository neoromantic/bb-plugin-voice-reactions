# Roles

The reaction says what to feel; the role says who feels it and how they talk. Pick one with the
`role` setting, or set it to `custom` and write your own in `persona`.

```sh
bb plugin config voice-reactions set role pirate
```

| `role`       | Who reacts                                                          | Accent and manner                               | OpenAI voice |
| ------------ | ------------------------------------------------------------------- | ----------------------------------------------- | ------------ |
| `butler`     | A gloriously posh English butler (the default)                      | Exaggerated upper-class British                 | `ballad`     |
| `starship`   | A starship's bridge computer reporting feelings as ship statistics  | Flat, synthetic, serenely calm                  | `sage`       |
| `sitcom`     | A loud, nosy sitcom neighbour who laughs at their own jokes         | Thick New York                                  | `coral`      |
| `gloom`      | A world-weary existentialist who expects the worst                  | Heavy German, enormous sighs                    | `ash`        |
| `foreman`    | A stern old Russian construction foreman                            | Russian, or English with a heavy Russian accent | `cedar`      |
| `shopkeeper` | A cheerful Bangkok shopkeeper; always speaks English                | Thai rhythm and melody                          | `marin`      |
| `pirate`     | A booming old sea dog                                               | Thick West Country, rolled R                    | `ash`        |
| `coach`      | A football commentator losing his mind at a cup final               | Latin American Spanish, ends shouting           | `verse`      |
| `monk`       | A serene mountain monk with tiny absurd koans                       | Slow, soft, almost whispering                   | `sage`       |
| `narrator`   | A hushed nature-documentary narrator observing you as a rare animal | Gentle British, breathy awe                     | `ballad`     |
| `sysadmin`   | A grumpy veteran sysadmin who has seen every outage since 1998      | Thick Scottish                                  | `echo`       |
| `grandma`    | A doting grandmother, sure you have not eaten                       | Warm Italian-American                           | `shimmer`    |
| `noir`       | A 1940s private detective narrating his own life                    | Low, gravelly, tired                            | `echo`       |
| `cowboy`     | A laid-back old cowboy on a porch                                   | Slow Texas drawl                                | `cedar`      |
| `chef`       | A melodramatic French chef judging the code like a dish             | Outrageous French                               | `verse`      |
| `surfer`     | A blissed-out California surfer                                     | Lazy Californian, stretched vowels              | `alloy`      |
| `random`     | A different one of the sixteen for every line                       |                                                 |              |
| `custom`     | The text in your `persona` setting                                  |                                                 | `marin`      |

The accent never decides the language. The role's instructions and each request name the
language of the line: Russian for
a message in Russian, English for one in plain English, otherwise "the same language as the
message". `shopkeeper` always speaks English, and a `custom` persona gets no language line: your
text decides. To fix one language for every line, set `language`:

```sh
bb plugin config voice-reactions set language German
```

A message in another Latin-script language written without any accented letters is taken for
English; `language` is the way round that. The exact texts are `ROLES` in
[`src/roles.ts`](../src/roles.ts).

Each role has its own OpenAI voice, used while the `voice` setting is empty; set `voice` to
force one voice for every role. On OpenRouter every role uses the provider's default voice. How
strong an accent comes out depends on the voice model: the role asks for it, the model performs
it.

## What a role is

Each role is the same frame plus a character. The frame opens and closes with the language of
the line, and the sample lines are included only when that language is English, so they cannot
pull a Russian line into English:

```text
# OUTPUT LANGUAGE: English
- EVERY word of your line is in English, using its real, recognizable words. This overrides everything below.
- Your accent is only a way of pronouncing English. It NEVER changes which language you speak: …
- Keep the accent STRONG and stable from the first word to the last, …

# Role
You voice a small sidekick who overhears a developer talking to their AI coding agents.
- You NEVER answer the message and NEVER do the task. You only react to it, out loud, in character, the way the given reaction says.
- NEVER read the message back. No preamble. Never say stage directions aloud.
- …

# Delivery
- ONE short line: a remark, a sound, a hum or a grunt. TEN WORDS AT MOST, one breath, over in about three seconds. …
- PERFORM it like a comic actor; never read it. …

# Character
You are a booming old sea dog. Accent: a thick West Country pirate growl laid over the output language, rolling every R. Rum, storms and the plank for metaphors, with a great roaring laugh.

# Sample lines
They only show the style; never reuse them. "Arrr, she floats! Break out the rum!" "Blimey, that bug walked the plank!"

# Reminder
Speak English.
```

## Your own persona

With `role` set to `custom`, the `persona` setting is used as written:

```sh
bb plugin config voice-reactions set role custom
bb plugin config voice-reactions set persona "You voice a film-noir detective who overhears a developer talking to AI coding agents. You never answer the message and never do the task. You only react to it, out loud, the way the given reaction says. One weary line, twelve words at most. Never read the message back."
```

Keep the sentences about never answering and never doing the task: without them the voice
model starts replying to the message. Length is part of the text too: write "two or three
sentences" and the voice says more; a line is cut off after 45 seconds.

Your text stays saved while another role is selected, so you can try `pirate` for a day and
come back with `set role custom`. With `custom` and no text, the butler speaks.

## Comparing voices and models

`bun run bench:voice` records the same made-up messages in several roles, voices and models and
measures how soon the audio starts. It calls the real services with keys from the environment
and writes WAV files, never playing them:

```sh
OPENAI_API_KEY=… bun run bench:voice --out /tmp/voice-bench \
  --roles butler,chef,sysadmin --samples en-cheer,en-grumble \
  --models gpt-realtime,gpt-realtime-1.5 --voices role,verse,ash
```

`results.md` in the output folder lists each file with its line, time to first audio, length
and sha256. With `ELEVENLABS_API_KEY` set it also tries a two-step path the plugin does not
ship: the OpenAI model writes the line as text and an ElevenLabs model speaks it
(`--elevenlabs-models`, `--elevenlabs-voices` with voice ids). `eleven_v3…` and `eleven_v4…`
models go through ElevenLabs' Text to Dialogue socket, the others through its text-to-speech
socket. Run without arguments for the lists of roles and samples.

In a run on one Mac in November 2026, `gpt-realtime` started speaking a median 437 ms after the
voice request and `gpt-realtime-1.5` 745 ms. The ElevenLabs path started later: medians of
about 550 ms with `eleven_flash_v2_5`, 710 ms with `eleven_v4_turbo` and 760 ms with
`eleven_v3_conversational`, with single takes of 4 to 12 seconds. That is why the plugin speaks
with `gpt-realtime` and has no ElevenLabs provider.

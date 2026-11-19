# Roles

The reaction says what to feel; the role says who feels it and how they talk. Pick one with the
`role` setting, or set it to `custom` and write your own in `persona`.

```sh
bb plugin config voice-reactions set role pirate
```

| `role`       | Who reacts                                                               |
| ------------ | ------------------------------------------------------------------------ |
| `butler`     | A deadpan, loyal butler with a dry sense of humour (the default)         |
| `starship`   | A starship's bridge computer that reports feelings as ship status        |
| `sitcom`     | A nosy sitcom neighbour with a laugh in every line                       |
| `gloom`      | A gloomy companion with black humour, never cruel to you                 |
| `foreman`    | A stern old Russian foreman; always speaks Russian                       |
| `shopkeeper` | A cheerful Bangkok shopkeeper; always speaks English, with a Thai accent |
| `pirate`     | An old sea dog with weather and rum metaphors                            |
| `coach`      | An over-excited sports commentator calling your day like a cup final     |
| `monk`       | A serene monk: a tiny koan or a single breath                            |
| `narrator`   | A hushed nature-documentary narrator observing you as a rare species     |
| `sysadmin`   | A grumpy veteran sysadmin who has seen it all                            |
| `grandma`    | A doting grandmother, a little worried you have not eaten                |
| `random`     | A different one of the twelve for every line                             |
| `custom`     | The text in your `persona` setting                                       |

Every role except `foreman` and `shopkeeper` answers in the language of your message. The exact
texts are `ROLES` in [`src/roles.ts`](../src/roles.ts).

## What a role is

Each role is the same two paragraphs plus one line of character:

```text
You voice a small sidekick who overhears a developer talking to their AI coding agents. You never answer the message and never do the task. You only react to it, out loud, in character, the way the given reaction says.
Keep it to a remark, a sound, a hum or a grunt: one breath, about ten words at most. Speak the language of the message unless the character says otherwise. Never read the message back. No preamble, no stage directions.
Character: an old sea dog: "aye aye", weather and rum metaphors, a hearty growl.
```

## Your own persona

With `role` set to `custom`, the `persona` setting is used as written:

```sh
bb plugin config voice-reactions set role custom
bb plugin config voice-reactions set persona "You voice a film-noir detective who overhears a developer talking to AI coding agents. You never answer the message and never do the task. You only react to it, out loud, the way the given reaction says. One weary line, twelve words at most. Never read the message back."
```

Keep the two sentences about never answering and never doing the task: without them the voice
model starts replying to the message. Length is part of the text too: write "two or three
sentences" and the voice says more; a line is cut off after 45 seconds.

Your text stays saved while another role is selected, so you can try `pirate` for a day and
come back with `set role custom`. With `custom` and no text, the butler speaks.

The voice itself is the `voice` setting (`marin` by default on OpenAI). A role changes the
manner and the words, not the voice.

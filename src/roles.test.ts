import { expect, test } from "bun:test";
import { ROLES, ROLE_NAMES, personaFor } from "./roles.js";

const OPENAI_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];
const ENGLISH = "Yes! All the tests are finally green!";
const RUSSIAN = "Ура! Наконец-то все тесты зелёные!";

function persona(
  role: string,
  message: string,
  overrides: { persona?: string; language?: string } = {},
) {
  return personaFor({ role, persona: "", language: "", ...overrides }, message, () => 0);
}

test("every role keeps the voice reacting instead of answering, and brings its character and voice", () => {
  expect(ROLE_NAMES).toEqual([
    "butler",
    "starship",
    "sitcom",
    "gloom",
    "foreman",
    "shopkeeper",
    "pirate",
    "coach",
    "monk",
    "narrator",
    "sysadmin",
    "grandma",
    "noir",
    "cowboy",
    "chef",
    "surfer",
  ]);
  for (const role of ROLE_NAMES) {
    const { instructions, voice } = persona(role, ENGLISH);
    expect(instructions).toContain("You NEVER answer the message and NEVER do the task.");
    expect(instructions).toContain(`# Character\nYou are ${ROLES[role].character}`);
    expect(voice).toBe(ROLES[role].voice);
    expect(OPENAI_VOICES).toContain(ROLES[role].voice);
  }
});

test.each(["coach", "foreman", "chef", "gloom", "grandma", "sysadmin"])(
  "%s is told to speak the language of the message first and last, whatever its accent",
  (role) => {
    const english = persona(role, ENGLISH);
    expect(english.language).toBe("English");
    expect(english.instructions).toStartWith(
      "# OUTPUT LANGUAGE: English\n- EVERY word of your line is in English",
    );
    expect(english.instructions).toContain("# Sample lines");
    expect(english.instructions).toEndWith("# Reminder\nSpeak English.");

    const russian = persona(role, RUSSIAN);
    expect(russian.language).toBe("Russian");
    expect(russian.instructions).toStartWith(
      "# OUTPUT LANGUAGE: Russian\n- EVERY word of your line is in Russian",
    );
    expect(russian.instructions).toContain(
      "Your accent is only a way of pronouncing Russian. It NEVER changes which language you speak",
    );
    expect(russian.instructions).not.toContain("# Sample lines");
    expect(russian.instructions).toEndWith("# Reminder\nSpeak Russian.");
  },
);

test("the shopkeeper always speaks English, in the wording that was checked live", () => {
  const { instructions, language } = persona("shopkeeper", RUSSIAN);
  expect(language).toBe("English");
  expect(instructions).toStartWith("# OUTPUT LANGUAGE: English");
  expect(instructions).toContain(
    "OUTPUT LANGUAGE: English for every message, including messages written in Russian or Thai.",
  );
});

test("other languages follow the message, and the language setting overrides everything", () => {
  const same = "the same language as the message";
  expect(persona("butler", "Großartig, alles läuft!").language).toBe(same);
  expect(persona("butler", "Нарешті всі тести зелені, їй-богу!").language).toBe(same);
  expect(persona("butler", "全部通过了").language).toBe(same);
  expect(persona("butler", "fix PR #12 наконец-то, ура").language).toBe("Russian");
  expect(persona("butler", ENGLISH, { language: " German " }).language).toBe("German");
  expect(persona("shopkeeper", RUSSIAN, { language: "German" }).instructions).toEndWith(
    "Speak German.",
  );
});

test("random draws a role for each line and an unknown role falls back to the butler", () => {
  const settings = { role: "random", persona: "", language: "" };
  expect(personaFor(settings, ENGLISH, () => 0).voice).toBe(ROLES.butler.voice);
  expect(personaFor(settings, ENGLISH, () => 0.999).instructions).toContain(ROLES.surfer.character);
  expect(personaFor(settings, ENGLISH, () => 0.3).instructions).toContain(ROLES.foreman.character);
  expect(persona("jester", ENGLISH).instructions).toContain(ROLES.butler.character);
});

test("your own persona speaks only when the role is custom, untouched, and is kept otherwise", () => {
  const mine = "  You are a starship computer.  ";
  expect(persona("custom", RUSSIAN, { persona: mine })).toEqual({
    instructions: "You are a starship computer.",
    voice: null,
    language: null,
  });
  expect(persona("custom", RUSSIAN, { persona: mine, language: "German" }).language).toBe("German");
  expect(persona("pirate", ENGLISH, { persona: mine }).instructions).toContain(
    ROLES.pirate.character,
  );
  expect(persona("custom", ENGLISH, { persona: " " }).instructions).toContain(
    ROLES.butler.character,
  );
});

import { expect, test } from "bun:test";
import { ROLES, ROLE_NAMES, lineLanguage, personaFor } from "./roles.js";

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
    const persona = personaFor(role, "", () => 0);
    expect(persona.instructions).toContain("You NEVER answer the message and NEVER do the task.");
    expect(persona.instructions).toEndWith(`# Character\nYou are ${ROLES[role].character}`);
    expect(persona.voice).toBe(ROLES[role].voice);
    expect(OPENAI_VOICES).toContain(ROLES[role].voice);
  }
});

test("the shopkeeper keeps the wording that was checked to stay in English", () => {
  expect(ROLES.shopkeeper.character).toContain(
    "OUTPUT LANGUAGE: English for every message, including messages written in Russian or Thai.",
  );
});

test("random draws a role for each line and an unknown role falls back to the butler", () => {
  expect(personaFor("random", "", () => 0).voice).toBe(ROLES.butler.voice);
  expect(personaFor("random", "", () => 0.999).instructions).toEndWith(ROLES.surfer.character);
  expect(personaFor("random", "", () => 0.3).instructions).toEndWith(ROLES.foreman.character);
  expect(personaFor("jester", "", () => 0.3).instructions).toEndWith(ROLES.butler.character);
});

test("your own persona speaks only when the role is custom, and is kept otherwise", () => {
  const mine = "  You are a starship computer.  ";
  expect(personaFor("custom", mine, () => 0)).toEqual({
    instructions: "You are a starship computer.",
    voice: null,
    language: null,
  });
  expect(personaFor("pirate", mine, () => 0).instructions).toEndWith(ROLES.pirate.character);
  expect(personaFor("custom", " ", () => 0).instructions).toEndWith(ROLES.butler.character);
});

test.each(["coach", "foreman", "chef", "gloom", "grandma", "sysadmin"])(
  "%s speaks the language of the message, whatever its accent",
  (role) => {
    const persona = personaFor(role, "", () => 0);
    expect(persona.instructions).toContain(
      "It NEVER changes which language you speak: a French accent on an English line is still English.",
    );
    expect(lineLanguage("Yes! All the tests are finally green!", "", persona.language)).toBe(
      "English",
    );
    expect(lineLanguage("Ура! Наконец-то все тесты зелёные!", "", persona.language)).toBe(
      "Russian",
    );
  },
);

test("the shopkeeper always speaks English and a custom persona sets its own language", () => {
  const shopkeeper = personaFor("shopkeeper", "", () => 0);
  expect(lineLanguage("Ура! Наконец-то все тесты зелёные!", "", shopkeeper.language)).toBe(
    "English",
  );
  const custom = personaFor("custom", "You are a starship computer.", () => 0);
  expect(lineLanguage("Ура! Наконец-то все тесты зелёные!", "", custom.language)).toBeNull();
});

test("other languages follow the message, and the language setting overrides everything", () => {
  const butler = personaFor("butler", "", () => 0);
  const same = "the same language as the message";
  expect(lineLanguage("Großartig, alles läuft!", "", butler.language)).toBe(same);
  expect(lineLanguage("Нарешті всі тести зелені, їй-богу!", "", butler.language)).toBe(same);
  expect(lineLanguage("全部通过了", "", butler.language)).toBe(same);
  expect(lineLanguage("fix PR #12 наконец-то, ура", "", butler.language)).toBe("Russian");
  expect(lineLanguage("Yes!", " German ", butler.language)).toBe("German");
  expect(lineLanguage("Ура!", "German", "English")).toBe("German");
});

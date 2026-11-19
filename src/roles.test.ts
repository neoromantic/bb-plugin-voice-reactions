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
  });
  expect(personaFor("pirate", mine, () => 0).instructions).toEndWith(ROLES.pirate.character);
  expect(personaFor("custom", " ", () => 0).instructions).toEndWith(ROLES.butler.character);
});

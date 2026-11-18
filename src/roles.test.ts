import { expect, test } from "bun:test";
import { ROLES, ROLE_NAMES, personaFor } from "./roles.js";

const KEEPS_IT_A_REACTION = "You never answer the message and never do the task.";

test("every role keeps the voice reacting instead of answering, and adds its own character", () => {
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
  ]);
  for (const role of ROLE_NAMES) {
    const persona = personaFor(role, "", () => 0);
    expect(persona).toContain(KEEPS_IT_A_REACTION);
    expect(persona).toEndWith(`Character: ${ROLES[role]}`);
  }
});

test("random draws a role for each line and an unknown role falls back to the butler", () => {
  expect(personaFor("random", "", () => 0)).toEndWith(ROLES.butler);
  expect(personaFor("random", "", () => 0.999)).toEndWith(ROLES.grandma);
  expect(personaFor("random", "", () => 0.4)).toEndWith(ROLES.foreman);
  expect(personaFor("jester", "", () => 0.4)).toEndWith(ROLES.butler);
});

test("your own persona speaks only when the role is custom, and is kept otherwise", () => {
  const mine = "  You are a starship computer.  ";
  expect(personaFor("custom", mine, () => 0)).toBe("You are a starship computer.");
  expect(personaFor("pirate", mine, () => 0)).toEndWith(ROLES.pirate);
  expect(personaFor("custom", " ", () => 0)).toEndWith(ROLES.butler);
});

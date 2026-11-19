import { expect, test } from "bun:test";
import { linePrompt, mixReactions, parseReactions } from "./reactions.js";

const set = parseReactions(
  "Which reaction?\nnone: nothing\nack: handoff\ngrumble: irritation\ntired: fatigue",
);

test("option lines become the choices and other lines the question", () => {
  expect(set).toEqual({
    question: "Which reaction?",
    criteria: { none: "nothing", ack: "handoff", grumble: "irritation", tired: "fatigue" },
  });
});

test("the defaults replace a setting with fewer than two options and keep ordinary work silent", () => {
  const defaults = parseReactions("just prose\nonly: one option");
  expect(Object.keys(defaults.criteria)).toHaveLength(17);
  expect(defaults.criteria.none).toStartWith("an ordinary work question, technical instruction");
  expect(defaults.criteria.ack).toStartWith("they explicitly hand the work over");
});

test("the choice leads, close runners-up are mixed in, none is silence", () => {
  const probabilities = { none: 0.05, ack: 0.1, grumble: 0.55, tired: 0.3 };
  const mixed = mixReactions("grumble", probabilities, set);
  expect(mixed).toEqual([
    { name: "grumble", share: 0.55 },
    { name: "tired", share: 0.3 },
  ]);
  expect(linePrompt(mixed ?? [], set, "it broke", "the build")).toBe(
    [
      "Reaction to give: grumble 55% (irritation); tired 30% (fatigue)",
      'The message: """it broke"""',
      'It replies to: """the build"""',
      "React now.",
    ].join("\n"),
  );
  expect(mixReactions("none", { none: 0.9 }, set)).toEqual([]);
  expect(mixReactions("dance", {}, set)).toBeNull();
});

import { describe, expect, test } from "bun:test";
import { firstPrompt, queuedEntry, thread, turnRow } from "../test/events.fixture.js";
import { humanTexts, queuedHumanText, splitQuote } from "./messages.js";

const child = thread({ id: "thr_child", parentThreadId: "thr_mgr" });

describe("humanTexts", () => {
  test("accepts a typed first prompt, follow-up and steer, in root, child and hidden threads", () => {
    expect(humanTexts(firstPrompt("hello").data, thread())).toEqual(["hello"]);
    expect(humanTexts(turnRow().data, thread())).toEqual(["fix the tests"]);
    const steer = turnRow({ target: { kind: "steer", expectedTurnId: "t" } });
    expect(humanTexts(steer.data, thread())).toEqual(["fix the tests"]);
    expect(humanTexts(turnRow().data, child)).toEqual(["fix the tests"]);
    expect(humanTexts(turnRow().data, thread({ visibility: "hidden" }))).toEqual(["fix the tests"]);
  });

  test.each([
    ["an agent's message", { initiator: "agent", senderThreadId: "thr_mgr" }],
    ["a core notice", { initiator: "system", systemMessageKind: "child-completed" }],
    ["a labelled notice", { systemMessageKind: "ownership-assigned" }],
    ["a plugin's message", { originPluginId: "account-pool" }],
    ["a message from another thread", { senderThreadId: "thr_other" }],
    ["a retry", { retryOfRequestId: "creq_0", retryAttempt: 2 }],
    ["a slash command", { text: "/compact" }],
    ["a slash command with arguments", { text: "/goal finish it" }],
  ] as const)("rejects %s", (_name, data) => {
    expect(humanTexts(turnRow(data).data, thread())).toEqual([]);
  });

  test("rejects the first prompt of a thread an agent spawned", () => {
    expect(humanTexts(firstPrompt("task", "thr_child").data, child)).toEqual([]);
  });

  test("keeps a prompt that starts with a path and drops agent-only and non-human parts", () => {
    const path = turnRow({ text: "/tmp/notes.md look at this" });
    expect(humanTexts(path.data, thread())).toEqual(["/tmp/notes.md look at this"]);
    const mixed = turnRow({
      inputGroups: [
        [{ type: "text", text: "[bb message from thread:thr_mgr]\n\nagent text", mentions: [] }],
        [{ type: "text", text: "[bb system]\n\n@thread:thr_x completed", mentions: [] }],
        [
          { type: "text", text: "context", visibility: "agent-only", mentions: [] },
          { type: "text", text: "well, well", mentions: [] },
        ],
        [{ type: "text", text: "and one more", mentions: [] }],
      ],
    });
    expect(humanTexts(mixed.data, thread())).toEqual(["well, well", "and one more"]);
  });
});

describe("queuedHumanText", () => {
  test("accepts a follow-up waiting behind a running turn", () => {
    expect(queuedHumanText(queuedEntry())).toBe("one more thing");
    expect(queuedHumanText(queuedEntry({ waitingOn: { kind: "interaction" } }))).toBe(
      "one more thing",
    );
  });

  test.each([
    ["a first prompt waiting for its environment", { waitingOn: { kind: "provisioning" } }],
    ["a scheduled message", { waitingOn: { kind: "time" } }],
    ["an agent's message", { initiator: "agent", senderThreadId: "thr_mgr" }],
    ["a message from another thread", { senderThreadId: "thr_mgr" }],
    ["a plugin's message", { origin: "plugin", originPluginId: "x" }],
    [
      "a retry",
      { payload: { kind: "retry", attempt: 2, reason: "rate", retryOfTurnRequestId: "creq_1" } },
    ],
    ["a core notice", { systemNotice: { kind: "child-completed", subject: null } }],
    ["a slash command", { text: "/compact" }],
  ] as const)("leaves %s alone", (_name, overrides) => {
    expect(queuedHumanText(queuedEntry(overrides))).toBeNull();
  });
});

test("splitQuote separates quoted lines from the reply", () => {
  expect(splitQuote("> all done\nthanks")).toEqual({ text: "thanks", quote: "all done" });
  expect(splitQuote("plain")).toEqual({ text: "plain", quote: null });
});

import { makeQueueEntry, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { QueuedMessage, Thread, TurnRequestRow } from "../src/messages.js";

let counter = 0;

export function turnRow(
  data: Partial<TurnRequestRow["data"]> & { text?: string } = {},
  threadId = "thr_root",
) {
  const { text = "fix the tests", ...rest } = data;
  counter += 1;
  const row = {
    id: `evt_${counter}`,
    scope: { kind: "thread" },
    threadId,
    seq: counter,
    createdAt: Date.now(),
    type: "client/turn/requested",
    data: {
      direction: "outbound",
      requestId: `creq_${counter}`,
      source: "tell",
      initiator: "user",
      senderThreadId: null,
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
      input: [{ type: "text", text, mentions: [] }],
      target: { kind: "new-turn" },
      request: { method: "turn/start", params: {} },
      execution: {
        model: "m",
        serviceTier: "default",
        reasoningLevel: "high",
        permissionMode: "full",
        source: "client/turn/requested",
      },
      ...rest,
    },
  } satisfies TurnRequestRow;
  return row as TurnRequestRow;
}

export function firstPrompt(text: string, threadId = "thr_root") {
  return turnRow({ text, source: "spawn", target: { kind: "thread-start" } }, threadId);
}

export function thread(overrides: Partial<Thread> = {}) {
  return makeThreadResponse({ id: "thr_root", parentThreadId: null, ...overrides });
}

export function queuedEntry(overrides: Partial<QueuedMessage> & { text?: string } = {}) {
  const { text = "one more thing", ...rest } = overrides;
  return makeQueueEntry({
    id: "qm_1",
    threadId: "thr_root",
    initiator: "user",
    senderThreadId: null,
    origin: "app",
    originPluginId: null,
    payload: { kind: "inline" },
    systemNotice: null,
    state: "queued",
    waitingOn: { kind: "thread-busy" },
    createdAt: Date.now(),
    content: [{ type: "text", text, mentions: [] }],
    ...rest,
  });
}

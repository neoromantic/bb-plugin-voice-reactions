import type { PluginBbSdk, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";

export type Thread = PluginThreadEventPayloads["experimental_thread.read"]["thread"];
export type QueuedMessage = PluginThreadEventPayloads["message.queued"]["entry"];
export type TurnRequestRow = Extract<
  Awaited<ReturnType<PluginBbSdk["threads"]["events"]["list"]>>[number],
  { type: "client/turn/requested" }
>;
type TurnRequest = TurnRequestRow["data"];
type Block = TurnRequest["input"][number];

const NOT_HUMAN = /^\[bb (?:message from thread:|system\])/;
const SLASH_COMMAND = /^\/[A-Za-z][\w:.-]*(?:\s|$)/;
const BEHIND_A_TURN = new Set(["thread-busy", "turn-starting", "stopping", "interaction"]);

function typedTexts(groups: readonly (readonly Block[])[]) {
  return groups
    .map((blocks) =>
      blocks
        .flatMap((b) => (b.type === "text" && b.visibility !== "agent-only" ? [b.text.trim()] : []))
        .filter(Boolean)
        .join("\n\n"),
    )
    .filter((text) => text && !NOT_HUMAN.test(text) && !SLASH_COMMAND.test(text));
}

export function humanTexts(d: TurnRequest, thread: Thread) {
  const typed =
    d.initiator === "user" &&
    !d.senderThreadId &&
    !d.originPluginId &&
    !d.retryOfRequestId &&
    d.retryAttempt === undefined &&
    (d.systemMessageKind ?? "unlabeled") === "unlabeled";
  const agentSpawn =
    (d.target?.kind === "thread-start" || d.source === "spawn") && thread.parentThreadId;
  return typed && !agentSpawn ? typedTexts(d.inputGroups?.length ? d.inputGroups : [d.input]) : [];
}

export function queuedHumanText(e: QueuedMessage) {
  const typed =
    e.initiator === "user" &&
    !e.senderThreadId &&
    !e.originPluginId &&
    e.origin !== "plugin" &&
    e.payload.kind === "inline" &&
    (e.systemNotice?.kind ?? "unlabeled") === "unlabeled";
  if (!typed || !BEHIND_A_TURN.has(e.waitingOn?.kind ?? "")) return null;
  return typedTexts([e.content])[0] ?? null;
}

export function splitQuote(raw: string) {
  const lines = raw.split(/\r?\n/);
  const quoted = lines
    .filter((line) => /^\s*>/.test(line))
    .map((line) => line.replace(/^\s*>\s?/, ""));
  const own = lines.filter((line) => !/^\s*>/.test(line));
  return { text: own.join("\n").trim(), quote: quoted.join("\n").trim() || null };
}

export function clip(text: string, max: number, fromEnd = false) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return fromEnd ? `…${flat.slice(-max)}` : `${flat.slice(0, max)}…`;
}

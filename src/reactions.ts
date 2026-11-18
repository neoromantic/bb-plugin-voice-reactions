import { DEFAULT_REACTIONS } from "./prompts.js";

export interface ReactionSet {
  question: string;
  criteria: Record<string, string>;
}

export interface Reaction {
  name: string;
  share: number;
}

const MIX_SHARE = 0.2;
const MAX_MIXED = 3;

function readReactions(text: string) {
  const criteria: Record<string, string> = {};
  const question: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const option = /^\s*([a-z][a-z0-9_-]*)\s*:\s*(\S.*)$/.exec(line);
    if (option?.[1] && option[2]) criteria[option[1]] = option[2].trim();
    else if (line.trim()) question.push(line.trim());
  }
  const set: ReactionSet = {
    question: question.join(" ") || "Which reaction fits this message?",
    criteria,
  };
  return set;
}

export function parseReactions(text: string) {
  const set = readReactions(text);
  return Object.keys(set.criteria).length < 2 ? readReactions(DEFAULT_REACTIONS) : set;
}

export function mixReactions(
  choice: string,
  probabilities: Record<string, number>,
  set: ReactionSet,
) {
  if (!(choice in set.criteria)) return null;
  if (choice === "none") return [];
  const share = (name: string) => probabilities[name] ?? 0;
  const others = Object.keys(set.criteria)
    .filter((name) => name !== choice && name !== "none" && share(name) >= MIX_SHARE)
    .sort((a, b) => share(b) - share(a));
  return [choice, ...others]
    .slice(0, MAX_MIXED)
    .map((name) => ({ name, share: share(name) }) satisfies Reaction);
}

export function describeReactions(reactions: Reaction[], set: ReactionSet) {
  return reactions
    .map((r) => `${r.name} ${Math.round(r.share * 100)}% (${set.criteria[r.name]})`)
    .join("; ");
}

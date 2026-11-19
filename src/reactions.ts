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

function describeReactions(reactions: Reaction[], set: ReactionSet) {
  const [main, ...others] = reactions.map((r) => `${r.name} (${set.criteria[r.name]})`);
  return others.length > 0 ? `${main}. With a touch of: ${others.join("; ")}` : `${main}`;
}

export function linePrompt(
  reactions: Reaction[],
  set: ReactionSet,
  message: string,
  context: string | null,
  language: string | null,
) {
  return [
    `Reaction to give: ${describeReactions(reactions, set)}`,
    `The message: """${message}"""`,
    ...(context ? [`It replies to: """${context}"""`] : []),
    ...(language
      ? [
          `OUTPUT LANGUAGE: ${language}. Every word of your line is in that language; your accent only changes how the words sound.`,
          `React now, in ${language}.`,
        ]
      : ["React now."]),
  ].join("\n");
}

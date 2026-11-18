import { isRecord } from "./json.js";
import { mixReactions, type ReactionSet } from "./reactions.js";

export const DECISION_PROVIDERS = {
  typesafe: {
    env: "TYPESAFE_API_KEY",
    url: "https://api.typesafe.ai/v1/systemone",
    shape: "state",
    model: "jev-latest",
  },
  openai: {
    env: "OPENAI_API_KEY",
    url: "https://api.openai.com/v1/decisions",
    shape: "input",
    model: "gpt-6-luna",
  },
  gateway: {
    env: "AI_GATEWAY_API_KEY",
    url: "https://ai-gateway.vercel.sh/v1/decisions",
    shape: "input",
    model: "openai/gpt-6-luna-decisions",
  },
  openrouter: {
    env: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/alpha/decisions",
    shape: "state",
    model: "openai/gpt-6-luna-decisions",
  },
} as const;

export type DecisionProvider = keyof typeof DECISION_PROVIDERS;
export const DECISION_PROVIDER_NAMES = Object.keys(DECISION_PROVIDERS) as DecisionProvider[];

const QUESTION = "reaction";

interface DecisionRequest {
  provider: DecisionProvider;
  url: string;
  model: string;
  apiKey: string;
  set: ReactionSet;
  message: string;
  context: string | null;
  signal: AbortSignal;
}

function requestBody({ provider, model, set, message, context }: DecisionRequest) {
  const state = { message, ...(context ? { replying_to: context } : {}) };
  if (DECISION_PROVIDERS[provider].shape === "state") {
    const question = { type: "choice", instructions: set.question, criteria: set.criteria };
    return { model, state, questions: { [QUESTION]: question } };
  }
  const choices = Object.entries(set.criteria).map(([value, description]) => ({
    value,
    description,
  }));
  const input = [{ role: "user", content: [{ type: "input_json", data: state }] }];
  const question = { type: "choice", name: QUESTION, instructions: set.question, choices };
  return { model, input, questions: [question] };
}

function readProbabilities(raw: unknown) {
  const pairs = Array.isArray(raw)
    ? raw.flatMap((item) => (isRecord(item) ? [[item.value, item.probability]] : []))
    : isRecord(raw)
      ? Object.entries(raw)
      : [];
  const probabilities: Record<string, number> = {};
  for (const [name, value] of pairs) {
    if (typeof name === "string" && typeof value === "number" && value >= 0 && value <= 1) {
      probabilities[name] = value;
    }
  }
  return probabilities;
}

function readAnswer(body: unknown) {
  if (!isRecord(body)) return null;
  const answers = body.answers;
  const answer = Array.isArray(answers) ? answers[0] : isRecord(answers) ? answers[QUESTION] : null;
  if (!isRecord(answer)) return null;
  if (answer.type === "refusal") return { choice: "none", probabilities: {} };
  if (typeof answer.choice !== "string") return null;
  return { choice: answer.choice, probabilities: readProbabilities(answer.probabilities) };
}

export async function decideReactions(request: DecisionRequest) {
  const response = await fetch(request.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody(request)),
    signal: request.signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const answer = readAnswer(await response.json());
  const reactions = answer && mixReactions(answer.choice, answer.probabilities, request.set);
  if (!reactions) throw new Error("malformed answer");
  return reactions;
}

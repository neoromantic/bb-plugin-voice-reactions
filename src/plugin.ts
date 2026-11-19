import { existsSync } from "node:fs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  DECISION_PROVIDERS,
  DECISION_PROVIDER_NAMES,
  decideReactions,
  type DecisionProvider,
} from "./decisions.js";
import { reason } from "./json.js";
import { KEY_NAMES, environmentKeys, type KeyName, type Keys } from "./keys.js";
import {
  clip,
  humanTexts,
  queuedHumanText,
  splitQuote,
  type QueuedMessage,
  type Thread,
} from "./messages.js";
import { resolvePlayer } from "./player.js";
import { DEFAULT_REACTIONS } from "./prompts.js";
import { linePrompt, parseReactions } from "./reactions.js";
import { CUSTOM_ROLE, RANDOM_ROLE, ROLE_NAMES, personaFor } from "./roles.js";
import {
  VOICE_PROVIDERS,
  VOICE_PROVIDER_NAMES,
  createVoice,
  type VoiceProvider,
  type VoiceRoute,
} from "./voice.js";

export interface VoiceReactionsOptions {
  env: Readonly<Record<string, string | undefined>>;
  platform: string;
  decisionUrls?: Partial<Record<DecisionProvider, string>>;
  voiceUrls?: Partial<Record<VoiceProvider, string>>;
}

interface Message {
  key: string;
  threadId: string;
  text: string;
  createdAt: number;
}

const DECISION_TIMEOUT_MS = 5000;
const MESSAGE_CHARS = 800;
const CONTEXT_CHARS = 300;

const KEY_SETTINGS = {
  TYPESAFE_API_KEY: "typesafeApiKey",
  OPENAI_API_KEY: "openaiApiKey",
  AI_GATEWAY_API_KEY: "aiGatewayApiKey",
  OPENROUTER_API_KEY: "openrouterApiKey",
} as const satisfies Record<KeyName, string>;

export function voiceReactions(options: VoiceReactionsOptions) {
  return async (bb: BbPluginApi) => {
    const loadedAt = Date.now();
    const life = new AbortController();

    const settings = bb.settings.define({
      reactions: {
        type: "string",
        label: "Reactions",
        description:
          "What the decision model chooses from. Lines shaped `name: when it fits: how to react` are the options, `none` means stay silent, any other line is the question.",
        experimental_multiline: true,
        default: DEFAULT_REACTIONS,
      },
      role: {
        type: "select",
        label: "Role",
        description:
          "Who reacts. Random draws a different character for every line; custom uses your own persona.",
        options: [...ROLE_NAMES, RANDOM_ROLE, CUSTOM_ROLE],
        default: "butler",
      },
      persona: {
        type: "string",
        label: "Your own persona",
        description:
          "Used when the role is custom: character, manner, tone and how long a line may be. Kept while another role is selected.",
        experimental_multiline: true,
        default: "",
      },
      voice: {
        type: "string",
        label: "Voice",
        description:
          "Voice name of the voice model. Empty uses the role's own voice on OpenAI, else the provider's default.",
        default: "",
      },
      player: {
        type: "string",
        label: "Audio player",
        description:
          "Command that plays raw 24 kHz 16-bit mono PCM from stdin. Empty finds ffplay, SoX play, aplay or paplay.",
        default: "",
      },
      decisionProvider: {
        type: "select",
        label: "Decision provider",
        description: "Which service picks the reaction. Auto uses the first one with a key.",
        options: ["auto", ...DECISION_PROVIDER_NAMES],
        default: "auto",
      },
      decisionModel: {
        type: "string",
        label: "Decision model",
        description: "Model id for the decision provider. Empty uses its default.",
        default: "",
      },
      voiceProvider: {
        type: "select",
        label: "Voice provider",
        description: "Which service speaks. Auto prefers OpenAI Realtime, then OpenRouter.",
        options: ["auto", ...VOICE_PROVIDER_NAMES],
        default: "auto",
      },
      voiceModel: {
        type: "string",
        label: "Voice model",
        description: "Model id for the voice provider. Empty uses its default.",
        default: "",
      },
      typesafeApiKey: { type: "string", label: "TypeSafe API key", secret: true },
      openaiApiKey: { type: "string", label: "OpenAI API key", secret: true },
      aiGatewayApiKey: { type: "string", label: "Vercel AI Gateway API key", secret: true },
      openrouterApiKey: { type: "string", label: "OpenRouter API key", secret: true },
    });
    let config = await settings.get();
    settings.onChange((next) => {
      config = next;
    });

    const environment = await environmentKeys(options.env);
    if (environment.probeFailed) bb.log.warn("api keys: reading them from zsh failed");

    function keys() {
      const merged: Keys = { ...environment.keys };
      for (const name of KEY_NAMES) {
        const value = config[KEY_SETTINGS[name]]?.trim();
        if (value) merged[name] = value;
      }
      return merged;
    }

    function pick<P extends string>(
      wanted: string,
      names: readonly P[],
      keyName: (name: P) => KeyName,
    ) {
      const available = keys();
      for (const provider of names) {
        const apiKey = available[keyName(provider)];
        if (apiKey && (wanted === "auto" || wanted === provider)) return { provider, apiKey };
      }
      return null;
    }

    function decisionRoute() {
      const found = pick(
        config.decisionProvider,
        DECISION_PROVIDER_NAMES,
        (name) => DECISION_PROVIDERS[name].env,
      );
      if (!found) return null;
      const defaults = DECISION_PROVIDERS[found.provider];
      return {
        ...found,
        url: options.decisionUrls?.[found.provider] ?? defaults.url,
        model: config.decisionModel.trim() || defaults.model,
      };
    }

    function voiceRoute() {
      const found = pick(
        config.voiceProvider,
        VOICE_PROVIDER_NAMES,
        (name) => VOICE_PROVIDERS[name].env,
      );
      if (!found) return null;
      const defaults = VOICE_PROVIDERS[found.provider];
      return {
        ...found,
        url: options.voiceUrls?.[found.provider] ?? defaults.url,
        model: config.voiceModel.trim() || defaults.model,
      } satisfies VoiceRoute;
    }

    function player() {
      return resolvePlayer({
        setting: config.player,
        env: options.env,
        platform: options.platform,
        exists: existsSync,
      });
    }

    const voice = createVoice(bb.log, options.env);

    async function react(message: Message) {
      const decision = decisionRoute();
      const speaker = voiceRoute();
      const { text, quote } = splitQuote(message.text);
      if (!decision || !text || life.signal.aborted) return;
      if (speaker?.provider === "openai") voice.warm(speaker);
      let context = quote && clip(quote, CONTEXT_CHARS);
      if (!context) {
        const previous = await bb.sdk.threads
          .output({ threadId: message.threadId, signal: life.signal })
          .catch(() => null);
        context = previous?.output?.trim() ? clip(previous.output, CONTEXT_CHARS, true) : null;
      }
      const set = parseReactions(config.reactions);
      const askedAt = Date.now();
      const reactions = await decideReactions({
        ...decision,
        set,
        message: clip(text, MESSAGE_CHARS),
        context,
        signal: AbortSignal.any([life.signal, AbortSignal.timeout(DECISION_TIMEOUT_MS)]),
      });
      const summary = reactions.map((r) => `${r.name} ${Math.round(r.share * 100)}%`).join(", ");
      const took = `${decision.provider} ${Date.now() - askedAt}ms`;
      bb.log.info(`${message.key}: ${took} → ${summary || "none"}`);
      if (reactions.length === 0 || life.signal.aborted) return;
      if (!speaker) {
        bb.log.warn(`${message.key}: no voice provider key`);
        return;
      }
      if (voice.busy()) {
        bb.log.info(`${message.key}: voice busy, reaction skipped`);
        return;
      }
      const command = player();
      if (!command) {
        bb.log.warn(`${message.key}: no audio player found, set the player setting`);
        return;
      }
      const persona = personaFor(config.role, config.persona, Math.random);
      const roleVoice = speaker.provider === "openai" ? persona.voice : null;
      voice.speak({
        ...speaker,
        key: message.key,
        createdAt: message.createdAt,
        voice: config.voice.trim() || roleVoice || VOICE_PROVIDERS[speaker.provider].voice,
        instructions: persona.instructions,
        prompt: linePrompt(reactions, set, clip(text, MESSAGE_CHARS), context),
        player: command,
      });
    }

    function classify(message: Message) {
      react(message).catch((error) =>
        bb.log.warn(`${message.key}: decision failed: ${reason(error)}`),
      );
    }

    const lastReadSeen = new Map<string, number>();
    const seen = new Set<string>();
    const queued = new Map<string, string>();

    async function readThread(thread: Thread) {
      const rows = await bb.sdk.threads.events.list({
        threadId: thread.id,
        types: ["client/turn/requested"],
        order: "desc",
        limit: "10",
        signal: life.signal,
      });
      for (const row of [...rows].reverse()) {
        if (row.type !== "client/turn/requested" || row.createdAt < loadedAt) continue;
        if (seen.has(row.data.requestId)) continue;
        seen.add(row.data.requestId);
        const texts = humanTexts(row.data, thread).filter((text) => {
          const delivered = [...queued].find(([, value]) => value === `${thread.id}\n${text}`);
          if (delivered) queued.delete(delivered[0]);
          return !delivered;
        });
        if (texts.length === 0) continue;
        classify({
          key: `turn:${row.data.requestId}`,
          threadId: thread.id,
          text: texts.join("\n\n"),
          createdAt: row.createdAt,
        });
      }
    }

    function onThread({ thread }: { thread: Thread }) {
      const lastReadAt = thread.lastReadAt ?? 0;
      const known = lastReadSeen.get(thread.id) ?? 0;
      if (life.signal.aborted || lastReadAt < loadedAt || lastReadAt <= known) return;
      lastReadSeen.set(thread.id, lastReadAt);
      readThread(thread).catch((error) =>
        bb.log.warn(`thread ${thread.id}: read failed: ${reason(error)}`),
      );
    }

    function onQueued({ entry }: { entry: QueuedMessage }) {
      const text = queuedHumanText(entry);
      if (life.signal.aborted || text === null || entry.createdAt < loadedAt) return;
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      queued.set(entry.id, `${entry.threadId}\n${text}`);
      classify({
        key: `queue:${entry.id}`,
        threadId: entry.threadId,
        text,
        createdAt: entry.createdAt,
      });
    }

    bb.events.on("experimental_thread.read", onThread);
    bb.events.on("experimental_thread.events", onThread);
    bb.events.on("message.queued", onQueued);
    bb.events.on("message.cancelled", ({ entry }) => {
      queued.delete(entry.id);
    });

    bb.onDispose(() => {
      life.abort();
      voice.stop();
    });

    const missing = [
      decisionRoute() ? null : "a decision provider key",
      voiceRoute() ? null : "an OpenAI or OpenRouter key for the voice",
      player() ? null : "an audio player (ffplay)",
    ].filter(Boolean);
    if (missing.length > 0) {
      bb.status.needsConfiguration(
        `Voice reactions needs ${missing.join(", ")}. Set it, then reload the plugin.`,
      );
    }
    const speaker = voiceRoute();
    if (speaker?.provider === "openai") voice.warm(speaker);
  };
}

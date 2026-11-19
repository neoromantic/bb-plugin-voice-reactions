import { spawn, type ChildProcess } from "node:child_process";
import WebSocket from "ws";
import { isRecord, parseJson, reason } from "./json.js";
import { playerEnv } from "./player.js";

export const VOICE_PROVIDERS = {
  openai: {
    env: "OPENAI_API_KEY",
    url: "wss://api.openai.com/v1/realtime",
    model: "gpt-realtime",
    voice: "marin",
  },
  openrouter: {
    env: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "openai/gpt-audio",
    voice: "alloy",
  },
} as const;

export type VoiceProvider = keyof typeof VOICE_PROVIDERS;
export const VOICE_PROVIDER_NAMES = Object.keys(VOICE_PROVIDERS) as VoiceProvider[];

const HANDSHAKE_TIMEOUT_MS = 10_000;
const FIRST_AUDIO_TIMEOUT_MS = 10_000;
const LINE_TIMEOUT_MS = 45_000;
const PLAYER_GRACE_MS = 3000;
const PCM_BYTES_PER_MS = 48;

export interface VoiceRoute {
  provider: VoiceProvider;
  url: string;
  model: string;
  apiKey: string;
}

export interface VoiceLine extends VoiceRoute {
  key: string;
  createdAt: number;
  voice: string;
  instructions: string;
  prompt: string;
  player: { command: string; args: string[] };
}

export function realtimeRequest(
  line: Pick<VoiceLine, "instructions" | "prompt" | "voice">,
  modalities: ["audio"] | ["text"],
) {
  return {
    type: "response.create",
    response: {
      conversation: "none",
      output_modalities: modalities,
      instructions: line.instructions,
      audio: { output: { voice: line.voice, format: { type: "audio/pcm", rate: 24_000 } } },
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: line.prompt }] },
      ],
    },
  };
}

interface Speech {
  line: VoiceLine;
  player: ChildProcess;
  ws: WebSocket | null;
  cancel: () => void;
  chunks: number;
  bytes: number;
  firstAudioMs: number;
  finished: boolean;
  timer: ReturnType<typeof setTimeout>;
}

interface VoiceLog {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
}

export function createVoice(log: VoiceLog, env: Readonly<Record<string, string | undefined>>) {
  let session: { ws: WebSocket; route: string } | null = null;
  let speech: Speech | null = null;

  function end(current: Speech, error: string | null) {
    if (current.finished) return;
    current.finished = true;
    clearTimeout(current.timer);
    if (error) {
      log.warn(`${current.line.key}: voice failed: ${error}`);
      current.cancel();
      current.player.kill();
      if (speech === current) speech = null;
      return;
    }
    const size = `${current.chunks} chunks, ${current.bytes} bytes`;
    const delay = `first audio ${current.firstAudioMs}ms after the message`;
    log.info(`${current.line.key}: spoken, ${size}, ${delay}`);
    if (current.ws && session?.ws !== current.ws) current.ws.close();
    current.player.stdin?.end();
    current.timer = setTimeout(
      () => current.player.kill(),
      current.bytes / PCM_BYTES_PER_MS + PLAYER_GRACE_MS,
    );
  }

  function play(current: Speech, base64: string) {
    const chunk = Buffer.from(base64, "base64");
    if (current.chunks === 0) {
      current.firstAudioMs = Date.now() - current.line.createdAt;
      clearTimeout(current.timer);
      current.timer = setTimeout(() => end(current, "timeout"), LINE_TIMEOUT_MS);
    }
    current.chunks += 1;
    current.bytes += chunk.length;
    current.player.stdin?.write(chunk);
  }

  function onRealtimeEvent(ws: WebSocket, raw: string) {
    const current = speech;
    const event = parseJson(raw);
    if (!current || current.ws !== ws || current.finished || !isRecord(event)) return;
    if (event.type === "response.output_audio.delta" && typeof event.delta === "string") {
      play(current, event.delta);
    } else if (event.type === "response.done") {
      end(current, current.chunks > 0 ? null : "empty response");
    } else if (event.type === "error") {
      const code = isRecord(event.error) ? event.error.code : null;
      end(current, `server error ${typeof code === "string" ? code : "unknown"}`);
    }
  }

  function warm(route: VoiceRoute) {
    const id = `${route.url}?model=${encodeURIComponent(route.model)}\n${route.apiKey}`;
    if (session && session.route === id && session.ws.readyState <= WebSocket.OPEN) {
      return session.ws;
    }
    if (session && speech?.ws !== session.ws) session.ws.terminate();
    const ws = new WebSocket(`${route.url}?model=${encodeURIComponent(route.model)}`, {
      headers: { Authorization: `Bearer ${route.apiKey}` },
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
      perMessageDeflate: false,
    });
    session = { ws, route: id };
    ws.on("message", (data) => onRealtimeEvent(ws, String(data)));
    ws.on("unexpected-response", (_request, response) => {
      log.warn(`realtime: handshake HTTP ${response.statusCode}`);
      ws.terminate();
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      if (session?.ws === ws) session = null;
      if (speech?.ws === ws) end(speech, "socket closed");
    });
    return ws;
  }

  function speakRealtime(current: Speech) {
    const { line } = current;
    const ws = warm(line);
    current.ws = ws;
    current.cancel = () => ws.terminate();
    const request = JSON.stringify(realtimeRequest(line, ["audio"]));
    if (ws.readyState === WebSocket.OPEN) ws.send(request);
    else ws.once("open", () => ws.send(request));
  }

  async function speakStream(current: Speech) {
    const { line } = current;
    const controller = new AbortController();
    current.cancel = () => controller.abort();
    const response = await fetch(line.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${line.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: line.model,
        modalities: ["text", "audio"],
        audio: { voice: line.voice, format: "pcm16" },
        stream: true,
        messages: [
          { role: "system", content: line.instructions },
          { role: "user", content: line.prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return end(current, `HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let base64 = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = (pending + decoder.decode(value, { stream: true })).split("\n");
      pending = lines.pop() ?? "";
      for (const text of lines) {
        const event = text.startsWith("data:") ? parseJson(text.slice(5)) : null;
        const choice = isRecord(event) && Array.isArray(event.choices) ? event.choices[0] : null;
        const delta = isRecord(choice) && isRecord(choice.delta) ? choice.delta.audio : null;
        if (!isRecord(delta) || typeof delta.data !== "string") continue;
        base64 += delta.data;
        const whole = base64.length - (base64.length % 4);
        if (whole > 0) play(current, base64.slice(0, whole));
        base64 = base64.slice(whole);
      }
    }
    if (base64) play(current, base64);
    return end(current, current.chunks > 0 ? null : "empty response");
  }

  function speak(line: VoiceLine) {
    const player = spawn(line.player.command, line.player.args, {
      stdio: ["pipe", "ignore", "pipe"],
      env: playerEnv(env),
    });
    const current: Speech = {
      line,
      player,
      ws: null,
      cancel: () => {},
      chunks: 0,
      bytes: 0,
      firstAudioMs: 0,
      finished: false,
      timer: setTimeout(() => end(current, "no audio in time"), FIRST_AUDIO_TIMEOUT_MS),
    };
    speech = current;
    const release = () => {
      clearTimeout(current.timer);
      if (speech === current) speech = null;
    };
    player.stdin.on("error", () => {});
    player.stderr.on("data", (data) => log.debug(`player: ${String(data).trim().slice(0, 500)}`));
    player.on("exit", () => {
      log.debug(`${line.key}: player exited`);
      release();
    });
    player.on("error", (error: NodeJS.ErrnoException) => {
      end(current, `player ${error.code ?? error.name}`);
      release();
    });
    if (line.provider === "openai") speakRealtime(current);
    else speakStream(current).catch((error) => end(current, reason(error)));
  }

  function stop() {
    const current = speech;
    if (current) end(current, "plugin unloaded");
    current?.player.kill();
    session?.ws.terminate();
  }

  return { busy: () => speech !== null, warm, speak, stop };
}

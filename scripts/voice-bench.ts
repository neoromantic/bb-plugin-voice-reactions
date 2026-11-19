import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import WebSocket from "ws";
import packageJson from "../package.json" with { type: "json" };
import { isRecord, parseJson } from "../src/json.js";
import { DEFAULT_REACTIONS } from "../src/prompts.js";
import { linePrompt, parseReactions, type Reaction } from "../src/reactions.js";
import { ROLE_NAMES, personaFor } from "../src/roles.js";
import { realtimeRequest } from "../src/voice.js";

const SAMPLES: Record<string, { message: string; reactions: Reaction[] }> = {
  "en-cheer": {
    message: "Yes! All the tests are finally green!",
    reactions: [{ name: "cheer", share: 0.9 }],
  },
  "en-grumble": {
    message: "Everything broke again. I'm done, going to bed.",
    reactions: [
      { name: "grumble", share: 0.6 },
      { name: "tired", share: 0.3 },
    ],
  },
  "en-ack": {
    message: "Looks right. Go ahead and ship it.",
    reactions: [{ name: "ack", share: 0.85 }],
  },
  "en-wow": {
    message: "Wait, it deleted the whole staging database?!",
    reactions: [{ name: "wow", share: 0.8 }],
  },
  "en-thanks": {
    message: "Thanks, that was exactly what I needed.",
    reactions: [{ name: "thanks", share: 0.9 }],
  },
  "ru-cheer": {
    message: "Ура! Наконец-то все тесты зелёные!",
    reactions: [{ name: "cheer", share: 0.9 }],
  },
  "ru-grumble": {
    message: "Опять всё сломалось. Всё, я спать.",
    reactions: [
      { name: "grumble", share: 0.6 },
      { name: "tired", share: 0.3 },
    ],
  },
  "ru-ack": {
    message: "Всё верно. Давай, выкатывай.",
    reactions: [{ name: "ack", share: 0.85 }],
  },
  "ru-wow": {
    message: "Стоп, оно удалило всю тестовую базу?!",
    reactions: [{ name: "wow", share: 0.8 }],
  },
};

const LINE_TIMEOUT_MS = 30_000;
const PCM_BYTES_PER_SECOND = 48_000;
const WRITER_RULES = `

# Output
Write ONLY the words to be spoken, as text. You may add delivery tags in square brackets, such as [laughs], [sighs], [gasps], [whispers], [shouting] or [excited].`;

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    roles: { type: "string", default: "butler,starship,sitcom,foreman,chef,sysadmin" },
    samples: { type: "string", default: "en-cheer,en-grumble" },
    models: { type: "string", default: "gpt-realtime" },
    voices: { type: "string", default: "role" },
    "writer-model": { type: "string", default: "gpt-realtime" },
    "elevenlabs-models": {
      type: "string",
      default: "eleven_v4_turbo,eleven_v3_conversational,eleven_flash_v2_5",
    },
    "elevenlabs-voices": { type: "string", default: "JBFqnCBsd6RMkjVDRZzb" },
    takes: { type: "string", default: "1" },
    "realtime-url": { type: "string", default: "wss://api.openai.com/v1/realtime" },
    "elevenlabs-url": { type: "string", default: "wss://api.elevenlabs.io/v1" },
  },
});
const REALTIME_URL = values["realtime-url"];
const ELEVENLABS_URL = values["elevenlabs-url"];

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const openaiKey = process.env.OPENAI_API_KEY?.trim();
const elevenlabsKey = process.env.ELEVENLABS_API_KEY?.trim();
if (!values.out || !openaiKey) {
  console.error("usage: OPENAI_API_KEY=… [ELEVENLABS_API_KEY=…] bun run bench:voice --out <dir>");
  console.error(`roles: ${ROLE_NAMES.join(", ")}`);
  console.error(`samples: ${Object.keys(SAMPLES).join(", ")}`);
  process.exit(2);
}
const outDir = values.out;
const set = parseReactions(DEFAULT_REACTIONS);
const takes = Math.max(1, Number.parseInt(values.takes, 10) || 1);

interface Result {
  file: string | null;
  sample: string;
  role: string;
  provider: string;
  model: string;
  voice: string;
  take: number;
  handshakeMs: number | null;
  firstTextMs: number | null;
  firstAudioMs: number | null;
  totalMs: number;
  seconds: number;
  sha256: string | null;
  transcript: string;
  error: string | null;
}

function openSocket(url: string, headers: Record<string, string>) {
  const startedAt = Date.now();
  const opened = Promise.withResolvers<number>();
  const ws = new WebSocket(url, { headers, handshakeTimeout: 10_000, perMessageDeflate: false });
  ws.on("open", () => opened.resolve(Date.now() - startedAt));
  ws.on("unexpected-response", (_request, response) => {
    opened.reject(new Error(`handshake HTTP ${response.statusCode}`));
    ws.terminate();
  });
  ws.on("error", (error) => opened.reject(error));
  return { ws, opened: opened.promise };
}

async function saveWav(name: string, chunks: Buffer[]) {
  const pcm = Buffer.concat(chunks);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(PCM_BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  const wav = Buffer.concat([header, pcm]);
  await writeFile(join(outDir, name), wav);
  return {
    seconds: Math.round((pcm.length / PCM_BYTES_PER_SECOND) * 100) / 100,
    sha256: createHash("sha256").update(wav).digest("hex"),
  };
}

function realtimeTurn(ws: WebSocket, request: object, onText: (delta: string) => void) {
  const startedAt = Date.now();
  const done = Promise.withResolvers<{
    audio: Buffer[];
    transcript: string;
    firstTextMs: number | null;
    firstAudioMs: number | null;
    error: string | null;
  }>();
  const audio: Buffer[] = [];
  let transcript = "";
  let firstTextMs: number | null = null;
  let firstAudioMs: number | null = null;
  const finish = (error: string | null) => {
    clearTimeout(timer);
    ws.off("message", onMessage);
    done.resolve({ audio, transcript, firstTextMs, firstAudioMs, error });
  };
  const timer = setTimeout(() => finish("timeout"), LINE_TIMEOUT_MS);
  const onMessage = (raw: WebSocket.RawData) => {
    const event = parseJson(String(raw));
    if (!isRecord(event)) return;
    const delta = typeof event.delta === "string" ? event.delta : "";
    if (event.type === "response.output_audio.delta" && delta) {
      firstAudioMs ??= Date.now() - startedAt;
      audio.push(Buffer.from(delta, "base64"));
    } else if (
      event.type === "response.output_audio_transcript.delta" ||
      event.type === "response.output_text.delta"
    ) {
      firstTextMs ??= Date.now() - startedAt;
      transcript += delta;
      onText(delta);
    } else if (event.type === "response.done") {
      finish(null);
    } else if (event.type === "error") {
      const code = isRecord(event.error) ? String(event.error.code ?? event.error.type) : "?";
      finish(`server error ${code}`);
    }
  };
  ws.on("message", onMessage);
  ws.send(JSON.stringify(request));
  return done.promise;
}

function elevenlabsSpeech(model: string, voiceId: string) {
  const startedAt = Date.now();
  const dialogue = /^eleven_v[34]/.test(model);
  const query = `model_id=${model}&output_format=pcm_24000`;
  const url = dialogue
    ? `${ELEVENLABS_URL}/text-to-dialogue/stream-input?${query}`
    : `${ELEVENLABS_URL}/text-to-speech/${voiceId}/stream-input?${query}&auto_mode=true&inactivity_timeout=20`;
  const first = dialogue ? { voices: [voiceId] } : { text: " " };
  const last = dialogue ? { close_socket: true } : { text: "" };
  const part = (text: string) =>
    dialogue ? { inputs: [{ text, voice_id: voiceId, new_turn: false }] } : { text };
  const { ws, opened } = openSocket(url, { "xi-api-key": elevenlabsKey ?? "" });
  const done = Promise.withResolvers<{
    audio: Buffer[];
    firstAudioMs: number | null;
    error: string | null;
  }>();
  const audio: Buffer[] = [];
  let firstAudioMs: number | null = null;
  let error: string | null = null;
  const timer = setTimeout(() => ws.terminate(), LINE_TIMEOUT_MS);
  ws.on("message", (raw) => {
    const event = parseJson(String(raw));
    if (!isRecord(event)) return;
    if (typeof event.audio === "string" && event.audio) {
      firstAudioMs ??= Date.now() - startedAt;
      audio.push(Buffer.from(event.audio, "base64"));
    }
    if (event.error) error = JSON.stringify(event).slice(0, 300);
    if (event.isFinal === true || event.is_final === true) ws.close();
  });
  ws.on("close", (code, reasonText) => {
    clearTimeout(timer);
    const closed = audio.length > 0 ? null : `closed ${code} ${String(reasonText)}`.trim();
    done.resolve({ audio, firstAudioMs, error: error ?? closed });
  });
  const ready = opened.then(
    (ms) => {
      ws.send(JSON.stringify(first));
      return ms;
    },
    (failure: Error) => {
      clearTimeout(timer);
      done.resolve({ audio, firstAudioMs, error: failure.message });
      return null;
    },
  );
  const sendWhenOpen = (message: object) => {
    ready.then((ms) => {
      if (ms !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    });
  };
  return {
    send: (text: string) => sendWhenOpen(part(text)),
    end: () => sendWhenOpen(last),
    ready,
    done: done.promise,
  };
}

const results: Result[] = [];

async function record(result: Omit<Result, "file" | "seconds" | "sha256">, audio: Buffer[]) {
  const name = `${result.sample}-${result.role}-${result.model}-${result.voice}-${result.take}.wav`;
  const saved = audio.length > 0 ? await saveWav(name, audio) : null;
  results.push({
    ...result,
    file: saved ? name : null,
    seconds: saved?.seconds ?? 0,
    sha256: saved?.sha256 ?? null,
  });
  const timing = `first audio ${result.firstAudioMs ?? "–"}ms`;
  console.log(`${name}: ${result.error ?? timing} | ${result.transcript}`);
}

function linesToRun() {
  const lines = [];
  for (const sample of list(values.samples)) {
    const data = SAMPLES[sample];
    if (!data) throw new Error(`unknown sample ${sample}`);
    for (const role of list(values.roles)) {
      if (!ROLE_NAMES.some((name) => name === role)) throw new Error(`unknown role ${role}`);
      const persona = personaFor({ role, persona: "", language: "" }, data.message, () => 0);
      const prompt = linePrompt(data.reactions, set, data.message, null, persona.language);
      for (let take = 1; take <= takes; take += 1) {
        lines.push({ sample, role, take, persona, prompt });
      }
    }
  }
  return lines;
}

async function benchOpenai(model: string) {
  const { ws, opened } = openSocket(`${REALTIME_URL}?model=${encodeURIComponent(model)}`, {
    Authorization: `Bearer ${openaiKey}`,
  });
  const handshakeMs = await opened;
  for (const line of linesToRun()) {
    const voices = list(values.voices).map((wanted) =>
      wanted === "role" ? (line.persona.voice ?? "marin") : wanted,
    );
    for (const voice of new Set(voices)) {
      const request = realtimeRequest(
        { instructions: line.persona.instructions, prompt: line.prompt, voice },
        ["audio"],
      );
      const startedAt = Date.now();
      const turn = await realtimeTurn(ws, request, () => {});
      await record(
        {
          sample: line.sample,
          role: line.role,
          provider: "openai",
          model,
          voice,
          take: line.take,
          handshakeMs,
          firstTextMs: null,
          firstAudioMs: turn.firstAudioMs,
          totalMs: Date.now() - startedAt,
          transcript: turn.transcript,
          error: turn.error,
        },
        turn.audio,
      );
    }
  }
  ws.close();
}

async function benchElevenlabs(model: string, voiceId: string) {
  const writerModel = values["writer-model"];
  const { ws, opened } = openSocket(`${REALTIME_URL}?model=${encodeURIComponent(writerModel)}`, {
    Authorization: `Bearer ${openaiKey}`,
  });
  await opened;
  for (const line of linesToRun()) {
    const request = realtimeRequest(
      {
        instructions: line.persona.instructions + WRITER_RULES,
        prompt: line.prompt,
        voice: "marin",
      },
      ["text"],
    );
    const startedAt = Date.now();
    const speech = elevenlabsSpeech(model, voiceId);
    const written = await realtimeTurn(ws, request, (delta) => speech.send(delta));
    speech.end();
    const [handshakeMs, spoken] = await Promise.all([speech.ready, speech.done]);
    await record(
      {
        sample: line.sample,
        role: line.role,
        provider: `elevenlabs+${writerModel}`,
        model,
        voice: voiceId,
        take: line.take,
        handshakeMs,
        firstTextMs: written.firstTextMs,
        firstAudioMs: spoken.firstAudioMs,
        totalMs: Date.now() - startedAt,
        transcript: written.transcript,
        error: written.error ?? spoken.error,
      },
      spoken.audio,
    );
  }
  ws.close();
}

await mkdir(outDir, { recursive: true });
for (const model of list(values.models)) {
  await benchOpenai(model).catch((error: Error) => console.error(`${model}: ${error.message}`));
}
if (elevenlabsKey) {
  for (const model of list(values["elevenlabs-models"])) {
    for (const voiceId of list(values["elevenlabs-voices"])) {
      await benchElevenlabs(model, voiceId).catch((error: Error) =>
        console.error(`${model}: ${error.message}`),
      );
    }
  }
}

const cell = (value: unknown) => String(value ?? "–").replaceAll("|", "/");
const table = [
  "| File | Sample | Role | Provider | Model | Voice | Handshake ms | First text ms | First audio ms | Seconds | sha256 | Line | Error |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...results.map((r) =>
    [
      "",
      r.file,
      r.sample,
      r.role,
      r.provider,
      r.model,
      r.voice,
      r.handshakeMs,
      r.firstTextMs,
      r.firstAudioMs,
      r.seconds,
      r.sha256,
      r.transcript,
      r.error,
      "",
    ]
      .map(cell)
      .join(" | ")
      .trim(),
  ),
];
const meta = { plugin: packageJson.version, recordedAt: new Date().toISOString() };
const note =
  "First audio is counted from the voice request on an already open OpenAI socket; the decision step is not included. For ElevenLabs the count starts when its socket starts to open, together with the writer's request.";
await writeFile(join(outDir, "results.json"), JSON.stringify({ ...meta, results }, null, 2));
await writeFile(
  join(outDir, "results.md"),
  `# Voice bench\n\nPlugin ${meta.plugin}, ${meta.recordedAt}. ${note}\n\n${table.join("\n")}\n`,
);
console.log(`${results.length} lines → ${outDir}/results.md`);

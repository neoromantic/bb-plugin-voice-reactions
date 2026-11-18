import { fileURLToPath } from "node:url";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { TurnRequestRow } from "../src/messages.js";
import { voiceReactions } from "../src/plugin.js";
import { thread } from "./events.fixture.js";

export const PLAYER_STUB = fileURLToPath(new URL("player-stub.ts", import.meta.url));

function queue<T>() {
  const items: T[] = [];
  const waiters: ((item: T) => void)[] = [];
  return {
    items,
    push(item: T) {
      const waiter = waiters.shift();
      if (waiter) waiter(item);
      else items.push(item);
    },
    next() {
      const { promise, resolve } = Promise.withResolvers<T>();
      const item = items.shift();
      if (item === undefined) waiters.push(resolve);
      else resolve(item);
      return promise;
    },
  };
}

function recordingLog() {
  const lines: string[] = [];
  const waiters: { pattern: RegExp; times: number; resolve: () => void }[] = [];
  const count = (pattern: RegExp) => lines.filter((line) => pattern.test(line)).length;
  const write = (level: string) => (message: string) => {
    lines.push(`${level} ${message}`);
    for (const waiter of waiters.filter((w) => count(w.pattern) >= w.times)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  };
  return {
    lines,
    text: () => lines.join("\n"),
    until(pattern: RegExp, times = 1) {
      const { promise, resolve } = Promise.withResolvers<void>();
      if (count(pattern) >= times) resolve();
      else waiters.push({ pattern, times, resolve });
      return promise;
    },
    sink: {
      debug: write("debug"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
    },
  };
}

interface Answer {
  choice: string;
  probabilities?: Record<string, number>;
  status?: number;
  refusal?: boolean;
}

interface DecisionCall {
  path: string;
  authorization: string | null;
  body: Record<string, unknown>;
}

interface RealtimeSession {
  authorization: string | null;
  url: string;
  requests: ReturnType<typeof queue<Record<string, unknown>>>;
  closed: Promise<void>;
  send: (event: unknown) => void;
}

interface SpeechCall {
  authorization: string | null;
  body: Record<string, unknown>;
  send: (line: string) => void;
  close: () => void;
}

function decisionResponse(path: string, answer: Answer) {
  if (answer.status) return new Response(`denied ${path}`, { status: answer.status });
  const probabilities = answer.probabilities ?? { [answer.choice]: 0.9 };
  if (path.startsWith("/state")) {
    const reaction = answer.refusal
      ? { type: "refusal" }
      : { type: "choice", choice: answer.choice, confidence: 0.9, probabilities };
    return Response.json({ model: "test", answers: { reaction } });
  }
  const pairs = Object.entries(probabilities).map(([value, probability]) => ({
    value,
    probability,
  }));
  const reaction = answer.refusal
    ? { type: "refusal", name: "reaction" }
    : { type: "choice", name: "reaction", choice: answer.choice, probabilities: pairs };
  return Response.json({ model: "test", answers: [reaction] });
}

function startProviders() {
  const decisions = queue<DecisionCall>();
  const sessions = queue<RealtimeSession>();
  const speeches = queue<SpeechCall>();
  const state = { answer: { choice: "ack" } as Answer };
  const server = Bun.serve<{ session: RealtimeSession; markClosed: () => void }>({
    port: 0,
    async fetch(request, bun) {
      const url = new URL(request.url);
      const authorization = request.headers.get("authorization");
      if (url.pathname === "/realtime") {
        const closed = Promise.withResolvers<void>();
        const session: RealtimeSession = {
          authorization,
          url: request.url,
          requests: queue(),
          closed: closed.promise,
          send: () => {},
        };
        const upgraded = bun.upgrade(request, { data: { session, markClosed: closed.resolve } });
        return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
      }
      if (url.pathname === "/refuse") return new Response("no", { status: 401 });
      const body = (await request.json()) as Record<string, unknown>;
      if (url.pathname === "/speech") {
        const encoder = new TextEncoder();
        const controller = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
        const stream = new ReadableStream<Uint8Array>({ start: (c) => controller.resolve(c) });
        const sink = await controller.promise;
        speeches.push({
          authorization,
          body,
          send: (line) => sink.enqueue(encoder.encode(line)),
          close: () => sink.close(),
        });
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      }
      decisions.push({ path: url.pathname, authorization, body });
      return decisionResponse(url.pathname, state.answer);
    },
    websocket: {
      open(ws) {
        ws.data.session.send = (event) => ws.send(JSON.stringify(event));
        sessions.push(ws.data.session);
      },
      message(ws, raw) {
        ws.data.session.requests.push(JSON.parse(String(raw)) as Record<string, unknown>);
      },
      close(ws) {
        ws.data.markClosed();
      },
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  return {
    state,
    decisions,
    sessions,
    speeches,
    stop: () => server.stop(true),
    decisionUrls: {
      typesafe: `${base}/state/typesafe`,
      openrouter: `${base}/state/openrouter`,
      openai: `${base}/input/openai`,
      gateway: `${base}/input/gateway`,
    },
    voiceUrls: { openai: `ws://127.0.0.1:${server.port}/realtime`, openrouter: `${base}/speech` },
    refuseUrl: `ws://127.0.0.1:${server.port}/refuse`,
  };
}

export async function startPlugin(
  options: {
    env?: Record<string, string>;
    settings?: Record<string, string>;
    voiceUrls?: { openai: "refuse" };
  } = {},
) {
  const providers = startProviders();
  const log = recordingLog();
  const host = createFakePluginHost({
    pluginId: "voice-reactions",
    settings: { player: PLAYER_STUB, ...options.settings },
  });
  const rows: Record<string, TurnRequestRow[]> = {};
  host.harness.sdk.stub("threads.events.list", async (args: { threadId: string }) =>
    [...(rows[args.threadId] ?? [])].reverse(),
  );
  host.harness.sdk.stub("threads.output", async () => ({ output: "All done, tests are green." }));
  const bb = new Proxy(host.bb, {
    get: (target, property, receiver) =>
      property === "log" ? log.sink : Reflect.get(target, property, receiver),
  });
  await voiceReactions({
    env: {
      PATH: process.env.PATH,
      ...(options.env ?? { TYPESAFE_API_KEY: "test-typesafe", OPENAI_API_KEY: "test-openai" }),
    },
    platform: process.platform,
    decisionUrls: providers.decisionUrls,
    voiceUrls: {
      ...providers.voiceUrls,
      ...(options.voiceUrls?.openai === "refuse" ? { openai: providers.refuseUrl } : {}),
    },
  })(bb);

  let lastReadAt = Date.now();
  const announce = (
    threadId: string,
    event: "experimental_thread.read" | "experimental_thread.events" = "experimental_thread.read",
  ) =>
    host.harness.emitThreadEvent(event, {
      thread: thread({ id: threadId, lastReadAt }),
      sequence: 1,
    });
  return {
    ...providers,
    host,
    log,
    rows,
    announce,
    say(row: TurnRequestRow) {
      (rows[row.threadId] ??= []).push(row);
      lastReadAt += 1;
      return announce(row.threadId);
    },
    async dispose() {
      await host.harness.lifecycle.dispose();
      providers.stop();
    },
  };
}

export function audio(bytes: number) {
  return {
    type: "response.output_audio.delta",
    delta: Buffer.alloc(bytes).toString("base64"),
  };
}

export const DONE = { type: "response.done", response: { status: "completed" } };

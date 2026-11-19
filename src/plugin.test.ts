import { afterEach, describe, expect, test } from "bun:test";
import { firstPrompt, queuedEntry, thread, turnRow } from "../test/events.fixture.js";
import { DONE, audio, startPlugin } from "../test/harness.js";

type Plugin = Awaited<ReturnType<typeof startPlugin>>;

const started: Plugin[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((plugin) => plugin.dispose()));
});

async function start(options: Parameters<typeof startPlugin>[0] = {}) {
  const plugin = await startPlugin(options);
  started.push(plugin);
  return plugin;
}

function promptOf(request: Record<string, unknown>) {
  return JSON.stringify(request);
}

describe("voice", () => {
  test("each audio chunk reaches the player as it arrives, and the warm session serves the next thread", async () => {
    const t = await start();
    t.state.answer = { choice: "grumble", probabilities: { grumble: 0.6, tired: 0.3, ack: 0.1 } };
    const session = await t.sessions.next();
    expect(session.authorization).toBe("Bearer test-openai");
    expect(session.url).toEndWith("/realtime?model=gpt-realtime");

    await t.say(firstPrompt("> the build failed\neverything broke again", "thr_a"));
    const decision = await t.decisions.next();
    expect(decision.authorization).toBe("Bearer test-typesafe");
    expect(decision.body.state).toEqual({
      message: "everything broke again",
      replying_to: "the build failed",
    });

    const request = await session.requests.next();
    expect(request).toMatchObject({
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["audio"],
        audio: { output: { voice: "ballad", format: { type: "audio/pcm", rate: 24000 } } },
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  'Reaction to give: grumble 60% (irritation, indignation or swearing: commiserate, soothe); tired 30% (fatigue, a late hour, "enough for today": a sympathetic sigh)',
                  'The message: """everything broke again"""',
                  'It replies to: """the build failed"""',
                  "OUTPUT LANGUAGE: English. Every word of your line is in that language; your accent only changes how the words sound.",
                  "React now, in English.",
                ].join("\n"),
              },
            ],
          },
        ],
      },
    });
    expect(promptOf(request)).toContain("gloriously posh English butler");

    session.send(audio(480));
    await t.log.until(/stub got 480/);
    session.send(audio(960));
    await t.log.until(/stub got 1440/);
    expect(t.log.text()).not.toContain("spoken");
    session.send(DONE);
    await t.log.until(/spoken, 2 chunks, 1440 bytes, first audio \d+ms after the message/);
    await t.log.until(/stub done 1440/);
    expect(t.log.text()).toContain(
      "stub args -nodisp -autoexit -loglevel error -probesize 32 -analyzeduration 1 -f s16le -sample_rate 24000 -ch_layout mono -i pipe:0",
    );

    await t.log.until(/player exited/);
    await t.say(firstPrompt("it finally works", "thr_b"));
    const second = await session.requests.next();
    expect(promptOf(second)).toContain("it finally works");
    expect(promptOf(second)).not.toContain("everything broke again");
    expect(t.sessions.items).toHaveLength(0);
    session.send(DONE);
  });

  test("every message is classified while a line is playing, but no second line is queued", async () => {
    const t = await start();
    const session = await t.sessions.next();
    for (const id of ["thr_a", "thr_b", "thr_c"]) await t.say(firstPrompt(`go ahead ${id}`, id));
    await session.requests.next();
    await t.log.until(/voice busy, reaction skipped/, 2);
    expect(t.decisions.items).toHaveLength(3);
    expect(session.requests.items).toHaveLength(0);

    await t.host.harness.lifecycle.dispose();
    await session.closed;
    expect(t.log.text()).toContain("voice failed: plugin unloaded");
  });

  test("none is silence: the decision is asked for and nothing is sent to the voice model", async () => {
    const t = await start();
    const session = await t.sessions.next();
    t.state.answer = { choice: "none" };
    await t.say(turnRow({ text: "why does this test fail?" }));
    const decision = await t.decisions.next();
    expect(decision.body.state).toEqual({
      message: "why does this test fail?",
      replying_to: "All done, tests are green.",
    });
    await t.log.until(/typesafe \d+ms → none/);

    t.state.answer = { choice: "ack" };
    await t.say(turnRow({ text: "go ahead" }));
    expect(promptOf(await session.requests.next())).toContain("go ahead");
  });

  test("OpenRouter speaks through a streamed chat completion when there is no OpenAI key", async () => {
    const t = await start({ env: { OPENROUTER_API_KEY: "test-openrouter" } });
    await t.say(turnRow({ text: "go ahead" }));
    expect((await t.decisions.next()).path).toBe("/state/openrouter");
    const speech = await t.speeches.next();
    expect(speech.authorization).toBe("Bearer test-openrouter");
    expect(speech.body).toMatchObject({
      model: "openai/gpt-audio",
      modalities: ["text", "audio"],
      audio: { voice: "alloy", format: "pcm16" },
      stream: true,
    });
    expect(promptOf(speech.body)).toContain('The message: \\"\\"\\"go ahead\\"\\"\\"');

    const whole = Buffer.from(Array.from({ length: 10 }, (_, index) => index)).toString("base64");
    const fragment = (data: string) =>
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data } } }] })}\n\n`;
    const first = fragment(whole.slice(0, 3));
    speech.send(first.slice(0, 40));
    speech.send(first.slice(40));
    speech.send(fragment(whole.slice(3, 9)));
    await t.log.until(/stub got 6/);
    speech.send(`data: {"choices":[{"delta":{"audio":{"transcript":"Very good."}}}]}\n\n`);
    speech.send(fragment(whole.slice(9)));
    speech.send("data: [DONE]\n\n");
    speech.close();
    await t.log.until(/spoken, 2 chunks, 10 bytes/);
    await t.log.until(/stub done 10/);
    expect(t.sessions.items).toHaveLength(0);
  });
});

describe("decisions", () => {
  test.each([
    ["typesafe", "TYPESAFE_API_KEY", "/state/typesafe", "jev-latest"],
    ["openrouter", "OPENROUTER_API_KEY", "/state/openrouter", "openai/gpt-6-luna-decisions"],
  ] as const)("%s gets the question in the state shape", async (provider, env, path, model) => {
    const t = await start({ env: { [env]: "test-key" } });
    t.state.answer = { choice: "none" };
    await t.say(turnRow({ text: "thanks a lot" }));
    const call = await t.decisions.next();
    expect(call).toMatchObject({ path, authorization: "Bearer test-key" });
    expect(call.body).toMatchObject({
      model,
      state: { message: "thanks a lot" },
      questions: {
        reaction: {
          type: "choice",
          instructions: expect.stringContaining("Which short spoken reaction"),
          criteria: { none: expect.any(String), thanks: expect.any(String) },
        },
      },
    });
    await t.log.until(new RegExp(`${provider} \\d+ms → none`));
  });

  test.each([
    ["openai", "OPENAI_API_KEY", "/input/openai", "gpt-6-luna"],
    ["gateway", "AI_GATEWAY_API_KEY", "/input/gateway", "typesafe-ai/jev"],
  ] as const)(
    "%s gets the question in the Decisions API shape",
    async (provider, env, path, model) => {
      const t = await start({ env: { [env]: "test-key" } });
      t.state.answer = { choice: "none", probabilities: { none: 0.9, thanks: 0.1 } };
      await t.say(turnRow({ text: "thanks a lot" }));
      const call = await t.decisions.next();
      expect(call).toMatchObject({ path, authorization: "Bearer test-key" });
      expect(call.body).toMatchObject({
        model,
        input: [
          {
            role: "user",
            content: [{ type: "input_json", data: { message: "thanks a lot" } }],
          },
        ],
        questions: [
          {
            type: "choice",
            name: "reaction",
            instructions: expect.stringContaining("Which short spoken reaction"),
          },
        ],
      });
      const [question] = call.body.questions as { choices: { value: string }[] }[];
      expect(question?.choices.map((choice) => choice.value)).toContain("thanks");
      await t.log.until(new RegExp(`${provider} \\d+ms → none`));
    },
  );

  test("a refused question is silence, and a Vercel key alone decides but cannot speak", async () => {
    const t = await start({ env: { AI_GATEWAY_API_KEY: "test-gateway" } });
    expect(t.host.harness.inspection.needsConfigurationMessages.join()).toContain(
      "an OpenAI or OpenRouter key for the voice",
    );
    t.state.answer = { choice: "none", refusal: true };
    await t.say(turnRow({ text: "something odd" }));
    await t.log.until(/gateway \d+ms → none/);
    t.state.answer = { choice: "ack" };
    await t.say(turnRow({ text: "go ahead" }));
    await t.log.until(/no voice provider key/);
  });
});

describe("messages", () => {
  test("agent, system, retry, child-spawn and earlier records are ignored, and one message is read once", async () => {
    const t = await start();
    t.state.answer = { choice: "none" };
    await t.say(turnRow({ initiator: "agent", senderThreadId: "thr_mgr" }));
    await t.say(turnRow({ initiator: "system", systemMessageKind: "child-completed" }));
    await t.say(turnRow({ retryOfRequestId: "creq_0", retryAttempt: 2 }));
    t.rows.thr_child = [firstPrompt("task from the manager", "thr_child")];
    await t.host.harness.emitThreadEvent("experimental_thread.read", {
      thread: thread({ id: "thr_child", parentThreadId: "thr_mgr", lastReadAt: Date.now() + 60 }),
    });
    await t.say({ ...turnRow({ text: "written before load" }), createdAt: Date.now() - 600_000 });

    await t.say(turnRow({ text: "the real one" }, "thr_once"));
    const call = await t.decisions.next();
    expect(call.body.state).toMatchObject({ message: "the real one" });
    const reads = t.host.harness.sdk.callsTo("threads.events.list").length;
    await t.announce("thr_once", "experimental_thread.events");
    await t.announce("thr_once");
    expect(t.host.harness.sdk.callsTo("threads.events.list")).toHaveLength(reads);
    await t.log.until(/typesafe \d+ms → none/);
    expect(t.decisions.items).toHaveLength(0);
  });

  test("a queued follow-up is handled when typed and not again when it is delivered", async () => {
    const t = await start();
    t.state.answer = { choice: "none" };
    const entry = queuedEntry({ text: "and fix the README" });
    await t.host.harness.emitThreadEvent("message.queued", { entry });
    await t.host.harness.emitThreadEvent("message.queued", {
      entry: { ...entry, waitingOn: { kind: "interaction" } },
    });
    await t.host.harness.emitThreadEvent("message.queued", {
      entry: queuedEntry({ id: "qm_agent", initiator: "agent", senderThreadId: "thr_mgr" }),
    });
    expect((await t.decisions.next()).body.state).toMatchObject({ message: "and fix the README" });
    await t.log.until(/queue:qm_1: typesafe \d+ms → none/);

    await t.say(turnRow({ text: "and fix the README" }));
    await t.say(turnRow({ text: "and fix the README" }));
    await t.log.until(/turn:creq_\d+: typesafe \d+ms → none/);
    expect(t.log.lines.filter((line) => /→ none/.test(line))).toHaveLength(2);
  });
});

describe("settings", () => {
  test("the line's language is named for each message: English, Russian, or the role's own", async () => {
    const t = await start({ settings: { role: "coach" } });
    const session = await t.sessions.next();
    let exits = 0;
    const lineFor = async (text: string) => {
      await t.say(turnRow({ text }));
      const request = promptOf(await session.requests.next());
      session.send(audio(48));
      session.send(DONE);
      exits += 1;
      await t.log.until(/player exited/, exits);
      return request;
    };
    expect(await lineFor("Yes! All the tests are finally green!")).toContain(
      "React now, in English.",
    );
    expect(await lineFor("Ура! Наконец-то все тесты зелёные!")).toContain("React now, in Russian.");
    await t.host.harness.behavior.setSettings({ role: "shopkeeper" });
    expect(await lineFor("Ура! Опять зелёные!")).toContain("React now, in English.");
    await t.host.harness.behavior.setSettings({ role: "custom", persona: "You are a robot." });
    expect(await lineFor("Ура! И снова зелёные!")).toContain("React now.");
    await t.host.harness.behavior.setSettings({ language: "German" });
    expect(await lineFor("Ура! И в третий раз!")).toContain("React now, in German.");
  });

  test("the chosen role speaks, and it can change between lines", async () => {
    const t = await start({ settings: { role: "foreman" } });
    const session = await t.sessions.next();
    await t.say(turnRow({ text: "go ahead" }));
    expect(await session.requests.next()).toMatchObject({
      response: {
        instructions: expect.stringContaining("stern old Russian construction foreman"),
        audio: { output: { voice: "cedar" } },
      },
    });
    session.send(audio(48));
    session.send(DONE);
    await t.log.until(/player exited/);

    await t.host.harness.behavior.setSettings({ role: "narrator" });
    await t.say(turnRow({ text: "go on then" }));
    expect(promptOf(await session.requests.next())).toContain("nature-documentary narrator");
  });

  test("prompts, voice, models and keys from settings take effect without a reload", async () => {
    const t = await start({
      env: { OPENAI_API_KEY: "test-openai" },
      settings: { decisionProvider: "openrouter", openrouterApiKey: "test-openrouter-setting" },
    });
    const first = await t.sessions.next();
    await t.host.harness.behavior.setSettings({
      reactions: "Pick one.\nnone: stay quiet\nbeep: anything at all: beep",
      role: "custom",
      persona: "You are a starship computer.",
      voice: "cedar",
      voiceModel: "gpt-realtime-mini",
      decisionModel: "typesafe/jev-1.13",
      openaiApiKey: "test-openai-setting",
    });
    t.state.answer = { choice: "beep" };
    await t.say(turnRow({ text: "status report" }));

    const call = await t.decisions.next();
    expect(call).toMatchObject({
      path: "/state/openrouter",
      authorization: "Bearer test-openrouter-setting",
      body: {
        model: "typesafe/jev-1.13",
        questions: {
          reaction: {
            instructions: "Pick one.",
            criteria: { none: "stay quiet", beep: "anything at all: beep" },
          },
        },
      },
    });
    const session = await t.sessions.next();
    expect(session.authorization).toBe("Bearer test-openai-setting");
    expect(session.url).toEndWith("/realtime?model=gpt-realtime-mini");
    await first.closed;
    expect(await session.requests.next()).toMatchObject({
      response: {
        instructions: "You are a starship computer.",
        audio: { output: { voice: "cedar" } },
      },
    });
  });

  test("without keys the plugin says what to configure and stays quiet", async () => {
    const t = await start({ env: {}, settings: { player: "" } });
    const [message] = t.host.harness.inspection.needsConfigurationMessages;
    expect(message).toContain("a decision provider key");
    expect(message).toContain("an OpenAI or OpenRouter key for the voice");
    const { errors } = await t.say(turnRow({ text: "go ahead" }));
    expect(errors).toEqual([]);
  });
});

describe("failures", () => {
  test("they stay in the log without keys or message text and never reach BB", async () => {
    const t = await start();
    const session = await t.sessions.next();
    t.state.answer = { choice: "ack", status: 401 };
    const { errors } = await t.say(turnRow({ text: "a private note" }));
    expect(errors).toEqual([]);
    await t.log.until(/decision failed: HTTP 401/);

    t.state.answer = { choice: "ack" };
    await t.say(turnRow({ text: "go ahead" }));
    await session.requests.next();
    session.send({
      type: "error",
      error: { code: "invalid_api_key", message: "Incorrect key test-openai" },
    });
    await t.log.until(/voice failed: server error invalid_api_key/);
    await session.closed;

    await t.say(turnRow({ text: "go on then" }));
    const replacement = await t.sessions.next();
    await replacement.requests.next();
    for (const secret of ["test-typesafe", "test-openai", "a private note", "go ahead"]) {
      expect(t.log.text()).not.toContain(secret);
    }
  });

  test("a refused handshake is reported with its status only", async () => {
    const t = await start({ voiceUrls: { openai: "refuse" } });
    await t.log.until(/realtime: handshake HTTP 401/);
    expect(t.log.text()).not.toContain("test-openai");
  });
});

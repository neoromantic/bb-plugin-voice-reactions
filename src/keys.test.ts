import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environmentKeys } from "./keys.js";

test("keys come from the environment, trimmed, and nothing else is read when all are set", async () => {
  const keys = {
    TYPESAFE_API_KEY: "test-typesafe",
    OPENAI_API_KEY: "test-openai",
    AI_GATEWAY_API_KEY: "test-gateway",
    OPENROUTER_API_KEY: "test-openrouter",
  };
  const env = { ...keys, TYPESAFE_API_KEY: " test-typesafe ", HOME: "/nonexistent" };
  expect(await environmentKeys(env)).toEqual({ keys, probeFailed: false });
});

test.skipIf(!existsSync("/bin/zsh"))(
  "missing keys are read from what ~/.zshenv exports, without overriding the environment",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "voice-reactions-home-"));
    await writeFile(
      join(home, ".zshenv"),
      "export OPENROUTER_API_KEY=test-openrouter\nexport OPENAI_API_KEY=from-zsh\n",
    );
    const found = await environmentKeys({ HOME: home, OPENAI_API_KEY: "test-openai" });
    expect(found).toEqual({
      keys: { OPENAI_API_KEY: "test-openai", OPENROUTER_API_KEY: "test-openrouter" },
      probeFailed: false,
    });
  },
);

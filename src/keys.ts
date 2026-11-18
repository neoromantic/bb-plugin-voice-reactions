import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

export const KEY_NAMES = [
  "TYPESAFE_API_KEY",
  "OPENAI_API_KEY",
  "AI_GATEWAY_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

export type KeyName = (typeof KEY_NAMES)[number];
export type Keys = Partial<Record<KeyName, string>>;

const ZSH = "/bin/zsh";
const ZSH_PROBE = `printf '%s\\0' ${KEY_NAMES.map((name) => `"\${${name}-}"`).join(" ")}`;

export async function environmentKeys(env: Readonly<Record<string, string | undefined>>) {
  const keys: Keys = {};
  for (const name of KEY_NAMES) {
    const value = env[name]?.trim();
    if (value) keys[name] = value;
  }
  if (KEY_NAMES.every((name) => keys[name]) || !env.HOME || !existsSync(ZSH)) {
    return { keys, probeFailed: false };
  }
  const shellEnv = { HOME: env.HOME, USER: env.USER ?? "", PATH: "/usr/bin:/bin" };
  try {
    const { stdout } = await promisify(execFile)(ZSH, ["-c", ZSH_PROBE], {
      env: shellEnv,
      timeout: 5000,
    });
    const values = stdout.split("\0");
    KEY_NAMES.forEach((name, index) => {
      const value = values[index]?.trim();
      if (value && !keys[name]) keys[name] = value;
    });
    return { keys, probeFailed: false };
  } catch {
    return { keys, probeFailed: true };
  }
}

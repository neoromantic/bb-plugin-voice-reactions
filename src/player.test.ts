import { expect, test } from "bun:test";
import { playerEnv, resolvePlayer } from "./player.js";

const FFPLAY_ARGS =
  "-nodisp -autoexit -loglevel error -probesize 32 -analyzeduration 1 -f s16le -sample_rate 24000 -ch_layout mono -i pipe:0";

function lookup(setting: string, files: string[], platform = "linux", path = "/usr/bin:/bin") {
  return resolvePlayer({
    setting,
    env: { PATH: path },
    platform,
    exists: (candidate) => files.includes(candidate),
  });
}

test("finds ffplay first, then the players a Linux machine usually has", () => {
  expect(lookup("", ["/usr/bin/aplay", "/usr/bin/ffplay"])).toEqual({
    command: "/usr/bin/ffplay",
    args: FFPLAY_ARGS.split(" "),
  });
  expect(lookup("", ["/usr/bin/aplay", "/usr/bin/paplay"])).toEqual({
    command: "/usr/bin/aplay",
    args: "-q -t raw -f S16_LE -r 24000 -c 1 -".split(" "),
  });
  expect(lookup("", [])).toBeNull();
});

test("looks in Homebrew's directory even when PATH lacks it, and for .exe on Windows", () => {
  expect(lookup("", ["/opt/homebrew/bin/ffplay"], "darwin")?.command).toBe(
    "/opt/homebrew/bin/ffplay",
  );
  const windows = lookup("", ["C:\\tools\\ffplay.exe"], "win32", "C:\\tools");
  expect(windows?.command).toEndWith("ffplay.exe");
  expect(windows?.args).toEqual(FFPLAY_ARGS.split(" "));
});

test("a configured path gets the known arguments, a full command is used as written", () => {
  const spaced = "/opt/My Tools/ffplay";
  expect(lookup(spaced, [spaced])).toEqual({ command: spaced, args: FFPLAY_ARGS.split(" ") });
  expect(lookup("/usr/bin/paplay", [])).toEqual({
    command: "/usr/bin/paplay",
    args: ["--raw", "--format=s16le", "--rate=24000", "--channels=1"],
  });
  expect(lookup("mpv --no-video -", [])).toEqual({ command: "mpv", args: ["--no-video", "-"] });
});

test("the player's environment keeps what audio needs and drops secrets", () => {
  const env = playerEnv({
    PATH: "/usr/bin",
    XDG_RUNTIME_DIR: "/run/user/1000",
    OPENAI_API_KEY: "test-openai",
    AI_GATEWAY_API_KEY: "test-gateway",
    GITHUB_TOKEN: "test-token",
    UNSET: undefined,
  });
  expect(env).toEqual({ PATH: "/usr/bin", XDG_RUNTIME_DIR: "/run/user/1000" });
});

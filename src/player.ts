import { posix, win32 } from "node:path";

const FFPLAY_ARGS =
  "-nodisp -autoexit -loglevel error -probesize 32 -analyzeduration 1 -f s16le -sample_rate 24000 -ch_layout mono -i pipe:0";

const KNOWN_PLAYERS: Record<string, string> = {
  ffplay: FFPLAY_ARGS,
  play: "-q -t raw -r 24000 -e signed-integer -b 16 -c 1 -",
  aplay: "-q -t raw -f S16_LE -r 24000 -c 1 -",
  paplay: "--raw --format=s16le --rate=24000 --channels=1",
};

const EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;

type Env = Readonly<Record<string, string | undefined>>;

interface PlayerLookup {
  setting: string;
  env: Env;
  platform: string;
  exists: (path: string) => boolean;
}

function knownArgs(command: string) {
  const name = (command.split(/[\\/]/).pop() ?? command).replace(/\.exe$/i, "");
  return (KNOWN_PLAYERS[name] ?? FFPLAY_ARGS).split(" ");
}

export function resolvePlayer({ setting, env, platform, exists }: PlayerLookup) {
  const configured = setting.trim();
  if (configured) {
    if (exists(configured)) return { command: configured, args: knownArgs(configured) };
    const [command = configured, ...args] = configured.split(/\s+/);
    return { command, args: args.length > 0 ? args : knownArgs(command) };
  }
  const path = platform === "win32" ? win32 : posix;
  const suffix = platform === "win32" ? ".exe" : "";
  const listed = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  for (const name of Object.keys(KNOWN_PLAYERS)) {
    for (const dir of [...listed, ...EXTRA_DIRS]) {
      const command = path.join(dir, name + suffix);
      if (exists(command)) return { command, args: knownArgs(command) };
    }
  }
  return null;
}

export function playerEnv(env: Env) {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !SECRET_NAME.test(name)) safe[name] = value;
  }
  return safe;
}

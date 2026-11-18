#!/usr/bin/env bun
process.stderr.write(`stub args ${process.argv.slice(2).join(" ")}\n`);
let bytes = 0;
process.stdin.on("data", (chunk) => {
  bytes += chunk.length;
  process.stderr.write(`stub got ${bytes}\n`);
});
process.stdin.on("end", () => {
  process.stderr.write(`stub done ${bytes}\n`);
  process.exit(0);
});

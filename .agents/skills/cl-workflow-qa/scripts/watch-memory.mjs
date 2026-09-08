#!/usr/bin/env node
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { totalmem, freemem } from "node:os";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import dayjs from "dayjs";

const args = process.argv.slice(2);
const once = args.includes("--once");
const logPath = ".context/qa/memory.jsonl";
const gib = 1024 ** 3;
await mkdir(dirname(logPath), { recursive: true });

async function sample() {
  let available = freemem();
  if (process.platform === "linux") {
    const info = await readFile("/proc/meminfo", "utf8");
    const match = info.match(/^MemAvailable:\s+(\d+) kB$/m);
    if (match) available = Number(match[1]) * 1024;
  }
  const availableGiB = Math.round((available / gib) * 100) / 100;
  const level = availableGiB < 2 ? "critical" : availableGiB < 4 ? "pause" : "okay";
  const record = {
    at: dayjs().toISOString(),
    totalGiB: Math.round((totalmem() / gib) * 100) / 100,
    availableGiB,
    level,
  };
  await appendFile(logPath, `${JSON.stringify(record)}\n`);
  console.log(`${record.at} ${level.toUpperCase()}: ${availableGiB} GiB available`);
}

do {
  await sample();
  if (!once) await setTimeout(15_000);
} while (!once);

#!/usr/bin/env node
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storage } from '../src/storage.mjs';
import { companion } from '../src/companion.mjs';
import { cloudProfile } from '../src/cloud-profile.mjs';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'SHERIFF CAT Companion\nnode bin/companion.mjs [--demo] [--port 4177] [--data-dir PATH]\nOpen the private local URL printed below. No dependencies, wallet signatures or AI.\nOwner configuration: SHERIFF_TOKEN_CONTRACT and SHERIFF_TOKEN_THRESHOLDS=10000,100000,1000000 (example quantities, configure before release).',
  );
  process.exit(0);
}
for (let i = 0; i < args.length; i++) {
  if (['--port', '--data-dir'].includes(args[i])) {
    if (!args[++i]) throw Error('Option requires a value');
  } else if (args[i] !== '--demo') throw Error('Unknown option');
}
const option = (k, fallback) =>
  args.includes(k) ? args[args.indexOf(k) + 1] : fallback;
const port = Number(option('--port', '4177'));
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error('Choose a port from 1024 to 65535');
const { startCompanion } = await import('../src/local-server.mjs');
const server = await startCompanion({
  port,
  demo: args.includes('--demo'),
  dataDir: option('--data-dir', join(homedir(), '.sheriff-cat', 'companion')),
});
console.log(
  `\nSHERIFF CAT / COMPANION\n${args.includes('--demo') ? 'DEMO - simulated data' : 'LIVE - personal API key required'}\n\n${server.url}\n`,
);
async function stop() {
  await server.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

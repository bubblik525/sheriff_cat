import { validateState } from './validate.mjs';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
export const blank = (demo) => ({
  version: 1,
  demo,
  tokens: [],
  watch: {},
  games: [],
  cursor: null,
  start: null,
  lastScan: null,
});
export async function storage(dir, demo = false) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, demo ? 'demo.json' : 'state.json'),
    lock = file + '.lock';
  let handle;
  try {
    handle = await open(lock, 'wx', 0o600);
    await handle.writeFile(String(process.pid));
  } catch (e) {
    if (e.code === 'EEXIST')
      throw Error(
        `Another terminal owns this data directory. If it crashed, remove ${lock} after checking the old process has stopped.`,
      );
    throw e;
  }
  let state;
  try {
    state = JSON.parse(await readFile(file, 'utf8'));
    if (!validateState(state,demo))
      throw Error('Unsupported or damaged state file');
  } catch (e) {
    if (e.code === 'ENOENT') state = blank(demo);
    else {
      await handle.close();
      await unlink(lock);
      throw Error(`Cannot read ${file}. Back it up before resetting it.`);
    }
  }
  let pending = Promise.resolve();
  const save = (value) => {
    const payload = JSON.stringify(value);
    pending = pending
      .catch(() => {})
      .then(async () => {
        await writeFile(file + '.tmp', payload, { mode: 0o600 });
        await rename(file + '.tmp', file);
      });
    return pending;
  };
  return {
    state,
    save,
    async close() {
      await pending.catch(() => {});
      await handle.close();
      await unlink(lock);
    },
    dir,
  };
}

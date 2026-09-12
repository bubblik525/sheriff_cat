import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function cloudProfile(url, dir) {
  const base = new URL(url);
  if (
    base.protocol !== 'https:' &&
    !(
      base.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(base.hostname)
    )
  )
    throw Error('Cloud profile requires HTTPS');
  if (base.username || base.password || base.search || base.hash)
    throw Error('Use a plain cloud service URL');
  const file = join(dir, 'cloud-profile-key');
  let key;
  try {
    key = (await readFile(file, 'utf8')).trim();
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    key = randomBytes(32).toString('hex');
    await writeFile(file, key, { mode: 0o600, flag: 'wx' });
  }
  if (!/^[a-f0-9]{64}$/.test(key))
    throw Error('Invalid local cloud profile credential');
  return {
    async request(action) {
      const response = await fetch(
        new URL(action ? '/action' : '/profile', base),
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + key,
          },
          body: JSON.stringify(action || {}),
          signal: AbortSignal.timeout(15000),
        },
      );
      const value = await response.json();
      if (!response.ok) throw Error(value.error || 'Cloud profile unavailable');
      return value;
    },
  };
}

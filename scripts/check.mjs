import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const modules = (await readdir(new URL('../lib/ai/', import.meta.url))).filter(x => x.endsWith('.mjs')).map(x => `lib/ai/${x}`);
for (const file of ['server.mjs', 'public/config.js', ...modules]) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!inline.length) throw new Error('Missing frontend script');
for (const [, script] of inline) new vm.Script(script);
console.log('Server, adapters, public config and inline JavaScript syntax passed.');

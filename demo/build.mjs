import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, '..', 'site');
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { app: join(here, 'src', 'main.ts') },
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'iife',
  target: ['es2022'],
  platform: 'browser',
  outdir: out,
  logLevel: 'info',
});

for (const f of ['index.html', 'base.css', 'styles.css']) cpSync(join(here, f), join(out, f));

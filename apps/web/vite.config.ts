import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { MAX_SFX_DELAY_MS, SFX_CUES, sfxCue, takeFile, type SfxManifest } from './src/audio/sfxCues.js';

/** The most takes of one cue, and the most bytes in one request, the booth may save. */
const MAX_TAKES = 8;
const MAX_BODY = 16 * 1024 * 1024;

/**
 * Dev server only: where the recording booth (`?dev=1&record`) saves its takes.
 * `PUT /__sfx/<cue>` with `{ takes: [base64 WAV, ...] }` replaces that cue's
 * files in `public/sfx/` (an empty list removes them); with `{ delayMs }` it
 * sets how late that cue plays against the board. Either way it rewrites
 * `manifest.json`, which it answers with. Only cues from the game's own list
 * are accepted, and only from the app's own page.
 */
function sfxRecorder(): Plugin {
  return {
    name: 'fansong-sfx-recorder',
    apply: 'serve',
    configureServer(server) {
      const dir = path.resolve(server.config.publicDir, 'sfx');
      const savedDelays = (): Record<string, number> => {
        try {
          return (JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Partial<SfxManifest>).delays ?? {};
        } catch {
          return {};
        }
      };
      /** Rewrite the manifest from the files on disk, keeping the delays but for `delay`'s cue (0 clears it). */
      const writeManifest = (delay?: { name: string; ms: number }): SfxManifest => {
        mkdirSync(dir, { recursive: true });
        const delays = savedDelays();
        if (delay) delays[delay.name] = delay.ms;
        for (const name of Object.keys(delays)) if (!sfxCue(name) || !delays[name]) delete delays[name];
        const files = new Set(readdirSync(dir));
        const takes: Record<string, number> = {};
        for (const cue of SFX_CUES) {
          let n = 0;
          while (files.has(takeFile(cue.name, n + 1))) n++;
          if (n > 0) takes[cue.name] = n;
        }
        const manifest: SfxManifest = { version: Date.now(), takes, delays };
        writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        return manifest;
      };
      server.middlewares.use('/__sfx', (req, res) => {
        const fail = (status: number, message: string) => {
          res.statusCode = status;
          res.end(message);
        };
        const name = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\//, ''));
        if (req.method !== 'PUT') return fail(405, 'PUT only');
        if (!sfxCue(name)) return fail(404, `No sound cue '${name}'.`);
        const site = req.headers['sec-fetch-site'];
        if ((site && site !== 'same-origin') || !`${req.headers['content-type']}`.startsWith('application/json')) {
          return fail(403, 'Only the recording booth saves sounds.');
        }
        const parts: Buffer[] = [];
        let size = 0;
        req.on('data', (part: Buffer) => {
          size += part.length;
          if (size <= MAX_BODY) parts.push(part);
        });
        req.on('end', () => {
          try {
            if (size > MAX_BODY) return fail(413, 'Too long a recording.');
            const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as { takes?: unknown; delayMs?: unknown };
            if (body.takes === undefined && typeof body.delayMs === 'number' && Number.isFinite(body.delayMs)) {
              const ms = Math.round(Math.max(-MAX_SFX_DELAY_MS, Math.min(MAX_SFX_DELAY_MS, body.delayMs)));
              res.setHeader('content-type', 'application/json');
              return res.end(JSON.stringify(writeManifest({ name, ms })));
            }
            const takes = Array.isArray(body.takes) ? body.takes.map((t) => Buffer.from(String(t), 'base64')) : null;
            if (!takes || takes.length > MAX_TAKES) return fail(400, 'Expected up to eight takes.');
            const wav = (b: Buffer) => b.length > 44 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE';
            if (!takes.every(wav)) return fail(400, 'Takes must be WAV files.');
            mkdirSync(dir, { recursive: true });
            for (const file of readdirSync(dir)) {
              const m = /^(.+)-(\d+)\.wav$/.exec(file);
              if (m && m[1] === name) rmSync(path.join(dir, file));
            }
            takes.forEach((take, i) => writeFileSync(path.join(dir, takeFile(name, i + 1)), take));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(writeManifest()));
          } catch (err) {
            fail(500, err instanceof Error ? err.message : String(err));
          }
        });
      });
    },
  };
}

/** Built files the offline worker fetches on demand, not up front: unit sprites and their missiles. */
const LAZY_FILES = /^sprites\/(units|projectiles)\//;

/**
 * Build only: writes `sw.js`, the service worker that keeps the whole game on
 * the device so the installed app opens offline. It is `src/pwa/sw.js` under a
 * list of every built file with a hash of its contents, so any change to the
 * build is a new worker, which fetches just the files whose hash is new. The
 * unit art is listed apart (`LAZY`): the worker fetches it as the game shows it.
 */
function offlineWorker(): Plugin {
  let root = '';
  let outDir = '';
  return {
    name: 'fansong-offline-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: Record<string, string> = {};
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else files[path.relative(outDir, full).split(path.sep).join('/')] = createHash('sha1').update(readFileSync(full)).digest('hex').slice(0, 12);
        }
      };
      walk(outDir);
      delete files['sw.js'];
      const sorted = Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1));
      // The unit art is thousands of images: the worker keeps each as it is first shown.
      const lazy = ([file]: [string, string]): boolean => LAZY_FILES.test(file);
      const worker = readFileSync(path.resolve(root, 'src/pwa/sw.js'), 'utf8');
      writeFileSync(path.join(outDir, 'sw.js'), `const FILES = ${JSON.stringify(Object.fromEntries(sorted.filter((f) => !lazy(f))))};
const LAZY = ${JSON.stringify(Object.fromEntries(sorted.filter(lazy)))};

${worker}`);
    },
  };
}

// The web app is a thin client of the workspace engine packages, which are
// consumed straight from their TypeScript sources (see each package's "main").
// Vite/esbuild transpiles them, so no build step is needed for the packages.
export default defineConfig({
  plugins: [react(), sfxRecorder(), offlineWorker()],
  // When this copy of the app was built, shown beside the menu's update check.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  server: { port: 5173 },
});

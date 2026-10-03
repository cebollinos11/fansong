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

// The web app is a thin client of the workspace engine packages, which are
// consumed straight from their TypeScript sources (see each package's "main").
// Vite/esbuild transpiles them, so no build step is needed for the packages.
export default defineConfig({
  plugins: [react(), sfxRecorder()],
  server: { port: 5173 },
});

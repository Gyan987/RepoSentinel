import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin, ViteDevServer } from 'vite';
import { handleGitHubArchive } from './src/server/github.ts';
import { LIMITS } from './src/core/limits.ts';

/** Runs the same endpoint in local development and Docker without needing Netlify CLI. */
function localArchiveEndpoint(): Plugin {
  const attach = (server: { middlewares: ViteDevServer['middlewares'] }) => {
    server.middlewares.use(async (incoming, outgoing, next) => {
      if (incoming.url?.split('?')[0] !== '/api/github') { next(); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > LIMITS.requestBytes) {
            outgoing.writeHead(413, { 'Content-Type': 'application/json' });
            outgoing.end(JSON.stringify({ error: 'Request body is too large.' }));
            return;
          }
          chunks.push(Buffer.from(chunk));
        }
        const method = incoming.method ?? 'GET';
        const controller = new AbortController();
        outgoing.on('close', () => controller.abort());
        const request = new Request('http://localhost/api/github', {
          method, headers: { 'Content-Type': incoming.headers['content-type'] ?? '' },
          body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks), signal: controller.signal,
        });
        const response = await handleGitHubArchive(request);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json' });
        outgoing.end(JSON.stringify({ error: 'The local archive endpoint failed.' }));
      }
    });
  };
  return { name: 'reposentinel-local-archive', configureServer: attach, configurePreviewServer: attach };
}

export default defineConfig({
  plugins: [react(), localArchiveEndpoint()],
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}'], restoreMocks: true },
  build: { target: 'es2022' },
});

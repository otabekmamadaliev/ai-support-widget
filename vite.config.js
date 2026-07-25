import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Run the real `/api/chat` handler during `npm run dev`.
 *
 * Vercel's runtime isn't available locally, so this adapts Node's req/res to the
 * Web Request/Response the handler expects. It deliberately loads the *same*
 * module that ships to production — no mock, no second code path — so streaming,
 * validation and rate limiting are all exercised while developing.
 */
function devApi() {
  const ALLOWED_HEADERS = ['content-type', 'accept', 'x-real-ip', 'x-forwarded-for'];

  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res) => {
        try {
          const { default: handler } = await server.ssrLoadModule('/api/chat.js');

          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);

          // Node hands us hop-by-hop headers the fetch Request constructor
          // rejects, so pass through only what the handler actually reads.
          const headers = new Headers();
          for (const name of ALLOWED_HEADERS) {
            if (req.headers[name]) headers.set(name, req.headers[name]);
          }
          if (!headers.has('x-real-ip')) headers.set('x-real-ip', '127.0.0.1');

          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });

          const response = await handler(request);

          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));

          if (response.body) {
            const reader = response.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(Buffer.from(value));
            }
          }
          res.end();
        } catch (err) {
          server.config.logger.error(`[dev-api] ${err.stack ?? err}`);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'dev_error', message: String(err) } }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The handler reads process.env, so mirror .env.local into it for dev.
  const env = loadEnv(mode, process.cwd(), '');
  if (!process.env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }

  return {
    plugins: [react(), devApi()],
    build: { outDir: 'dist' },
  };
});

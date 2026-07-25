import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Run the real `/api/chat` handler during `npm run dev`.
 *
 * Vercel's runtime isn't available locally, but the handler is an ordinary Node
 * `(req, res)` function, so Vite's middleware can hand it the same objects
 * Vercel would. It loads the *same* module that ships to production — no mock,
 * no second code path — so streaming, validation and rate limiting are all
 * exercised while developing.
 */
function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res) => {
        try {
          const { default: handler } = await server.ssrLoadModule('/api/chat.js');
          await handler(req, res);
        } catch (err) {
          server.config.logger.error(`[dev-api] ${err.stack ?? err}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
          }
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

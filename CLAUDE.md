# ai-support-widget

Northgate — an embeddable AI support chatbot that drops onto any site with one
`<script>` tag. Live at **https://ai-support-widget-sand.vercel.app**. Repo:
`github.com/otabekmamadaliev/ai-support-widget`.

## Stack

React 19 + Vite 8, **plain JavaScript**, plain CSS. `@google/genai` for Gemini,
server-side only. No router, no motion library, no icon package — the icons are
hand-written SVG in `src/widget/icons.jsx`, because every dependency ends up
inside the embed bundle a client downloads.

## Two builds, not one

```
npm run build         # site, then widget - both, in order
npm run build:site    # dist/ - the demo page
npm run build:widget  # dist/widget.js - the embeddable bundle
```

`vite.widget.config.js` builds `src/embed.jsx` into a single self-contained
`dist/widget.js`. Things that are deliberate and will break if changed:

- **IIFE, not ESM.** A classic script keeps `document.currentScript` available,
  which is how the `data-*` attributes are read, and it works on pages with no
  build step.
- **React is bundled in**, so a client installs nothing.
- **`emptyOutDir: false`**, so the widget build runs *after* the site build
  without wiping it. Build order matters — `build:widget` alone leaves no site.

## The shadow root

`src/widget/mount.jsx` calls `host.attachShadow({ mode: 'open' })` and mounts
everything inside. That isolation is the product: the host page's CSS cannot
reach the widget and the widget's cannot leak out.

So: **all widget styling must go through `widget.css` injected into the shadow
root.** A global stylesheet, a `document.head` insertion, or a Tailwind-style
utility class will simply not apply, and worse, may work in the demo page while
failing on a real host site.

## The API key never reaches the browser

`api/chat.js` is a Vercel function holding `process.env.GEMINI_API_KEY`. Note
there is **no `VITE_` prefix** — that is precisely what keeps it out of the client
build. It streams replies back as Server-Sent Events.

`export const config = { runtime: 'nodejs' }` — **Node, not Edge**, on purpose, so
the same `(req, res)` handler runs locally under Vite with no adapter. Switching
it to Edge breaks local dev.

The system prompt is built in `shared/clinic.js` on the server. **The client
cannot influence the prompt or the model** — keep that boundary.

## Cost controls are server-side and load-bearing

This runs on the Gemini **free tier**, so the limits in `api/chat.js`
(`MAX_TOKENS`, `MAX_USER_MESSAGES`, `MAX_TRANSCRIPT`, `MAX_CHARS`,
`MAX_BODY_BYTES`) exist to stay inside a daily request quota. Every one is
enforced on the server; the counter in the widget footer is a courtesy, not the
control. Do not move enforcement to the client.

`GEMINI_MODEL` is an env var because **free-tier quotas differ per model and
Google retires them** — `gemini-2.0-flash` is already shut down. Current default
is `gemini-3.6-flash`. When a model breaks, check the installed
`@google/genai` `.d.ts` rather than the docs; model IDs churn faster than the
documentation.

## Behaviour that is intentional

The bot answers **only** from the business's own knowledge base — treatments,
prices, opening hours — politely declines everything else, and routes emergencies
to the phone number. That refusal behaviour is the demo's point, not a limitation
to loosen.

## Rules

- **Branch + PR into `main`. Never commit directly to main.**
- `C:\Users\ASUS` is itself a git repo with an unborn `main` — running git from
  the wrong cwd silently operates on the home directory. Always
  `cd /c/Users/ASUS/Desktop/ai-support-widget` first.
- Verify with `npm run build` (both builds) and `npx oxlint src`. No test suite.
- Verify visually in real Chrome — the Browser preview pane does not paint
  reliably here and freezes `requestAnimationFrame`.

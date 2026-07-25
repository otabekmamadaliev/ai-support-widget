import { mountWidget } from './widget/mount.jsx';

/**
 * Standalone entry point — this is what gets built into `widget.js`.
 *
 * A client drops one <script> tag on their page and configures the widget with
 * data-* attributes, so re-branding never needs a rebuild. No framework, no
 * build step, and nothing secret in the bundle: it only knows the endpoint URL.
 */

function readConfig() {
  const script =
    document.currentScript ??
    document.querySelector('script[data-support-widget]') ??
    document.querySelector('script[src*="widget.js"]');

  const data = script?.dataset ?? {};
  const config = {};

  if (data.api) config.endpoint = data.api;
  if (data.name) config.name = data.name;
  if (data.accent) config.accent = data.accent;
  if (data.greeting) config.greeting = data.greeting;
  if (data.position === 'left' || data.position === 'right') config.position = data.position;

  if (data.quickReplies) {
    const replies = data.quickReplies
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (replies.length) config.quickReplies = replies;
  }

  const max = Number.parseInt(data.maxMessages, 10);
  if (Number.isFinite(max) && max > 0) config.maxMessages = max;

  return config;
}

// Read the attributes *now*, while the script is executing — `document.currentScript`
// is only valid at that moment, and is null by the time DOMContentLoaded fires.
const config = readConfig();
const start = () => mountWidget(config);

// `defer` normally means the DOM is ready, but guard in case the tag is inlined
// higher up the page without it.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

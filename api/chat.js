import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from '../shared/clinic.js';

/**
 * POST /api/chat
 *
 * Takes a transcript, streams Claude's reply back as Server-Sent Events.
 * The Anthropic API key lives only in this process — the browser bundle never
 * sees it, and the client cannot influence the system prompt or the model.
 *
 * Runs on the Node runtime rather than Edge: the Anthropic SDK reaches for
 * `node:fs` and `node:path`, which the Edge runtime refuses to bundle.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

// ── Cost controls ────────────────────────────────────────────────────────────
// This is a portfolio demo on a personal API key, so the limits are deliberately
// tight. Every one of them is enforced here, on the server; the counter in the
// widget's footer is a courtesy, not the control.
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 500; // a receptionist answer, not an essay
const MAX_USER_MESSAGES = 20; // per session
const MAX_TRANSCRIPT = 45; // user + assistant turns we'll accept at all
const MAX_CHARS = 700; // per message
const MAX_BODY_BYTES = 64 * 1024; // hard cap before we even parse
const IP_LIMIT = 30; // requests…
const IP_WINDOW_MS = 60 * 60 * 1000; // …per hour

const SYSTEM_PROMPT = buildSystemPrompt();

/**
 * Per-IP request counts.
 *
 * Note this is per-instance memory: serverless instances come and go, and
 * several can run at once, so a determined caller could get more than IP_LIMIT
 * through. It is a cost guardrail, not a security boundary — the hard ceilings
 * are MAX_TOKENS and MAX_USER_MESSAGES, which apply to every single request.
 * A real deployment would put this in Redis or Vercel KV.
 */
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const fresh = (hits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (fresh.length >= IP_LIMIT) {
    hits.set(ip, fresh);
    return true;
  }
  fresh.push(now);
  hits.set(ip, fresh);

  // Opportunistic cleanup so the map can't grow without bound.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= IP_WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}

function fail(res, status, code, message) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: { code, message } }));
}

/**
 * Vercel pre-parses JSON bodies; Vite's dev middleware does not. Handle both so
 * local development exercises this exact file rather than a stand-in.
 */
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Accept only what we expect: an array of plain user/assistant text turns
 * ending on a user turn. Anything else is rejected rather than forwarded — the
 * client does not get to shape the request we send upstream.
 */
function validate(body) {
  if (!body || !Array.isArray(body.messages)) {
    return { error: ['bad_request', 'Expected a "messages" array.'] };
  }

  const { messages } = body;

  if (messages.length === 0) return { error: ['bad_request', 'No messages provided.'] };
  if (messages.length > MAX_TRANSCRIPT) {
    return { error: ['session_limit', 'This demo conversation has reached its limit.'] };
  }

  const clean = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) {
      return { error: ['bad_request', 'Each message needs a role of "user" or "assistant".'] };
    }
    if (typeof m.content !== 'string') {
      return { error: ['bad_request', 'Each message needs string content.'] };
    }
    const content = m.content.trim();
    if (!content) return { error: ['bad_request', 'Messages cannot be empty.'] };
    if (content.length > MAX_CHARS) {
      return { error: ['too_long', `Please keep messages under ${MAX_CHARS} characters.`] };
    }
    clean.push({ role: m.role, content });
  }

  if (clean.filter((m) => m.role === 'user').length > MAX_USER_MESSAGES) {
    return {
      error: [
        'session_limit',
        `This demo allows ${MAX_USER_MESSAGES} messages per conversation. Start a new chat to reset.`,
      ],
    };
  }
  if (clean.at(-1).role !== 'user') {
    return { error: ['bad_request', 'The last message must be from the user.'] };
  }

  return { messages: clean };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return fail(res, 405, 'method_not_allowed', 'Use POST.');
  }

  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    req.headers['x-real-ip'] ||
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : forwarded?.[0]) ||
    req.socket?.remoteAddress ||
    'unknown';

  if (rateLimited(ip)) {
    return fail(res, 429, 'rate_limited', 'Too many messages from this address. Try again later.');
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    return fail(res, 400, 'bad_request', 'Body must be JSON.');
  }

  const { messages, error } = validate(body);
  if (error) {
    return fail(res, error[0] === 'session_limit' ? 429 : 400, error[0], error[1]);
  }

  // Checked after validation so a malformed request still gets an accurate
  // reason, rather than every problem reporting as a configuration failure.
  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(res, 500, 'not_configured', 'The assistant is not configured on this deployment.');
  }

  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  // Belt and braces against any proxy that would otherwise buffer the stream.
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Haiku 4.5 takes no `thinking` or `effort` parameter — a grounded FAQ
    // answer needs neither, and passing `effort` would be rejected outright.
    const claude = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    });

    for await (const event of claude) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        send({ type: 'delta', text: event.delta.text });
      }
    }

    const final = await claude.finalMessage();
    send({
      type: 'done',
      stop_reason: final.stop_reason,
      usage: { input: final.usage.input_tokens, output: final.usage.output_tokens },
    });
  } catch (err) {
    // Never leak upstream detail (which can echo the key's org or request shape)
    // to the browser — log it, hand back something human.
    console.error('[api/chat]', err);
    const overloaded = err?.status === 429 || err?.status === 529;
    send({
      type: 'error',
      message: overloaded
        ? 'The assistant is busy right now. Please try again in a moment.'
        : 'Something went wrong reaching the assistant.',
    });
  } finally {
    res.end();
  }
}

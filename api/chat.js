import { GoogleGenAI } from '@google/genai';
import { buildSystemPrompt } from '../shared/clinic.js';

/**
 * POST /api/chat
 *
 * Takes a transcript, streams the assistant's reply back as Server-Sent Events.
 * The Gemini API key lives only in this process — the browser bundle never sees
 * it, and the client cannot influence the system prompt or the model.
 *
 * Runs on the Node runtime rather than Edge so the same `(req, res)` handler can
 * run locally under Vite with no adapter.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

// ── Cost controls ────────────────────────────────────────────────────────────
// This demo runs on the Gemini free tier, so the limits exist to stay inside a
// daily request quota rather than a dollar budget. Every one of them is enforced
// here, on the server; the counter in the widget's footer is a courtesy, not the
// control.
//
// The model is an env var so it can be swapped without a code change — free-tier
// quotas differ per model and Google retires older ones (gemini-2.0-flash is
// already shut down).
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
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
 * through. It is a quota guardrail, not a security boundary — the hard ceilings
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

/** Our transcript shape → Gemini's. Gemini calls the assistant turn "model". */
function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

/**
 * Turn reasoning down as far as the model allows.
 *
 * Looking up a fixed price in a system prompt gains nothing from reasoning, and
 * it costs latency and free-tier quota on every message. Unhelpfully the knob
 * differs by family — Gemini 3.x takes a `thinkingLevel` enum, 2.5 takes a
 * numeric `thinkingBudget` — and sending the wrong one is a 400.
 */
function thinkingConfigFor(model) {
  return model.startsWith('gemini-3')
    ? { thinkingLevel: 'MINIMAL' }
    : { thinkingBudget: 0 };
}

function openStream(ai, contents, { withThinkingConfig }) {
  return ai.models.generateContentStream({
    model: MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: MAX_TOKENS,
      ...(withThinkingConfig ? { thinkingConfig: thinkingConfigFor(MODEL) } : {}),
    },
  });
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
  if (!process.env.GEMINI_API_KEY) {
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
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const contents = toGeminiContents(messages);

    // Turning thinking down is an optimisation, not a requirement. If the model
    // rejects the knob we guessed for its family, drop it and answer anyway —
    // a slightly more expensive reply beats a broken demo.
    let stream;
    try {
      stream = await openStream(ai, contents, { withThinkingConfig: true });
    } catch (err) {
      if (err?.status !== 400) throw err;
      console.warn(`[api/chat] ${MODEL} rejected the thinking config; retrying without it`);
      stream = await openStream(ai, contents, { withThinkingConfig: false });
    }

    let usage = null;
    let sentAnything = false;

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        sentAnything = true;
        send({ type: 'delta', text });
      }
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
    }

    if (!sentAnything) {
      // A safety filter or an empty candidate — say so rather than closing the
      // stream silently, which the widget would report as "no reply".
      send({
        type: 'error',
        message: "I couldn't answer that one. Try rephrasing, or call the practice.",
      });
    } else {
      send({
        type: 'done',
        usage: {
          input: usage?.promptTokenCount ?? null,
          output: usage?.candidatesTokenCount ?? null,
        },
      });
    }
  } catch (err) {
    // Never leak upstream text (which can echo the key's project, quota figures
    // or the request shape) to the browser — log the whole thing, and hand back
    // a human message plus a `reason` derived *only* from the HTTP status.
    // That's enough to tell a misconfigured deployment apart from an exhausted
    // quota without exposing anything the caller shouldn't see.
    console.error('[api/chat]', err);

    const status = typeof err?.status === 'number' ? err.status : null;
    const reason =
      { 400: 'bad_upstream_request', 403: 'key_rejected', 404: 'model_not_found', 429: 'quota' }[
        status
      ] ?? 'unknown';

    // Google retires models on its own schedule, so "the configured model no
    // longer exists" is a failure this demo should expect rather than treat as
    // a mystery. Report which models the key *can* use — those are public
    // product identifiers, not secrets — so the fix is a GEMINI_MODEL change
    // rather than a debugging session.
    let available;
    if (status === 404) {
      try {
        const page = await new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
        }).models.list();
        available = [];
        for await (const m of page) {
          if (m.supportedActions?.includes('generateContent')) {
            available.push(String(m.name).replace(/^models\//, ''));
          }
          if (available.length >= 40) break;
        }
      } catch (listErr) {
        console.error('[api/chat] could not list models', listErr);
      }
    }

    send({
      type: 'error',
      reason,
      status,
      configuredModel: MODEL,
      ...(available?.length ? { available } : {}),
      message:
        status === 429
          ? "The assistant has hit today's free-tier limit. Please try again later."
          : 'Something went wrong reaching the assistant.',
    });
  } finally {
    res.end();
  }
}

import { useCallback, useRef, useState } from 'react';

let nextId = 0;
const makeId = () => `m${++nextId}`;

/**
 * Owns the conversation: transcript, streaming, and error state.
 *
 * History lives here and nowhere else — nothing is persisted, so closing the
 * tab ends the session. That keeps the demo privacy-clean and means the message
 * allowance resets naturally.
 */
export function useChat({ endpoint, greeting, maxMessages }) {
  const [messages, setMessages] = useState(() => [
    { id: makeId(), role: 'assistant', content: greeting, greeting: true },
  ]);
  const [status, setStatus] = useState('idle'); // idle | thinking | streaming
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const userCount = messages.filter((m) => m.role === 'user').length;
  const limitReached = userCount >= maxMessages;
  const busy = status !== 'idle';

  const run = useCallback(
    async (history) => {
      setError(null);
      setStatus('thinking');

      const controller = new AbortController();
      abortRef.current = controller;

      // The canned greeting is ours, not Claude's — the API needs the transcript
      // to start with a user turn, so it never goes upstream.
      const payload = history
        .filter((m) => !m.greeting)
        .map(({ role, content }) => ({ role, content }));

      const replyId = makeId();
      let started = false;

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: payload }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw Object.assign(new Error(body?.error?.message ?? 'Request failed.'), {
            code: body?.error?.code ?? 'http_error',
          });
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Server-sent events: one JSON payload per `data:` line, blank-line separated.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';

          for (const chunk of chunks) {
            const line = chunk.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;

            let event;
            try {
              event = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }

            if (event.type === 'delta') {
              if (!started) {
                started = true;
                setStatus('streaming');
                setMessages((prev) => [
                  ...prev,
                  { id: replyId, role: 'assistant', content: event.text },
                ]);
              } else {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === replyId ? { ...m, content: m.content + event.text } : m,
                  ),
                );
              }
            } else if (event.type === 'error') {
              throw Object.assign(new Error(event.message), { code: 'stream_error' });
            }
          }
        }

        if (!started) {
          throw Object.assign(new Error('The assistant did not reply.'), { code: 'empty' });
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        // Drop a half-written reply so a partial sentence never reads as final.
        setMessages((prev) => prev.filter((m) => m.id !== replyId));
        setError({ message: err.message, code: err.code ?? 'unknown' });
      } finally {
        abortRef.current = null;
        setStatus('idle');
      }
    },
    [endpoint],
  );

  const send = useCallback(
    (text) => {
      const content = text.trim();
      if (!content || busy || limitReached) return;

      const history = [...messages, { id: makeId(), role: 'user', content }];
      setMessages(history);
      run(history);
    },
    [busy, limitReached, messages, run],
  );

  /** Re-send the last user turn after a failure, without duplicating it. */
  const retry = useCallback(() => {
    if (busy) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) run(messages);
  }, [busy, messages, run]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setError(null);
    setStatus('idle');
    setMessages([{ id: makeId(), role: 'assistant', content: greeting, greeting: true }]);
  }, [greeting]);

  return { messages, status, error, busy, send, retry, reset, userCount, limitReached };
}

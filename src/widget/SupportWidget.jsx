import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChat } from './useChat.js';
import { ToothMark, SendIcon } from './icons.jsx';

const DEFAULTS = {
  endpoint: '/api/chat',
  name: 'Northgate Assistant',
  accent: '#3f8ee6',
  greeting:
    "Hi 👋 I'm the Northgate Dental assistant. I can help with treatments, prices, opening hours and booking. What would you like to know?",
  quickReplies: ['Opening hours', 'Price list', 'Book a visit', "I'm in pain"],
  maxMessages: 20,
  position: 'right',
};

const TEASER_DELAY = 6000;
const TEASER_KEY = 'nds-widget-teaser-seen';

export default function SupportWidget(props) {
  const config = { ...DEFAULTS, ...props };
  const { endpoint, name, accent, greeting, quickReplies, maxMessages, position } = config;

  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [draft, setDraft] = useState('');

  const launcherRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const bodyRef = useRef(null);

  const chat = useChat({ endpoint, greeting, maxMessages });
  const { messages, status, error, busy, send, retry, reset, userCount, limitReached } = chat;

  // ── The nudge: once per session, and never while the panel is open ─────────
  useEffect(() => {
    if (open) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem(TEASER_KEY) === '1';
    } catch {
      seen = false; // private mode / storage blocked — just skip the nudge
    }
    if (seen) return;

    const timer = setTimeout(() => setTeaser(true), TEASER_DELAY);
    return () => clearTimeout(timer);
  }, [open]);

  const dismissTeaser = useCallback(() => {
    setTeaser(false);
    try {
      sessionStorage.setItem(TEASER_KEY, '1');
    } catch {
      /* storage blocked — the in-memory state is enough for this session */
    }
  }, []);

  const openPanel = useCallback(() => {
    dismissTeaser();
    setOpen(true);
  }, [dismissTeaser]);

  const closePanel = useCallback(() => setOpen(false), []);

  // ── Keyboard: Esc closes, Tab stays inside the panel ──────────────────────
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePanel();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll(
        'button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Inside a shadow root, document.activeElement is the host — ask the root.
      const active = panelRef.current.getRootNode().activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const node = panelRef.current;
    node?.addEventListener('keydown', onKeyDown);
    return () => node?.removeEventListener('keydown', onKeyDown);
  }, [open, closePanel]);

  /*
   * Move focus after React has committed, never during the event that caused the
   * change: focusing the launcher inside closePanel() runs before the panel is
   * removed, and the focus is lost again on commit.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else if (wasOpen.current) {
      launcherRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // Keep the newest message in view as tokens arrive.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages, status, error]);

  // Below 480px the panel is a full-screen sheet, so stop the page scrolling
  // behind it. Tracked live rather than checked once, so rotating the device or
  // resizing while the panel is open locks and unlocks correctly.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    const mq = window.matchMedia('(max-width: 480px)');
    const previous = document.body.style.overflow;
    const apply = () => {
      document.body.style.overflow = mq.matches ? 'hidden' : previous;
    };

    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const submit = (e) => {
    e?.preventDefault();
    if (!draft.trim() || busy || limitReached) return;
    send(draft);
    setDraft('');
  };

  const onComposerKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const showQuickReplies = messages.length === 1 && !busy && !limitReached && !error;
  const remaining = maxMessages - userCount;

  return (
    <div className={`widget widget--${position}`} style={{ '--accent': accent }}>
      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="panel"
          ref={panelRef}
          role="dialog"
          aria-label={`${name} — chat`}
          id="nds-chat-panel"
        >
          <header className="panel__head">
            <span className="avatar" aria-hidden="true">
              <ToothMark />
            </span>
            <div className="panel__who">
              <h2>{name}</h2>
              <p>
                <span className="dot" aria-hidden="true" />
                Online · usually replies instantly
              </p>
            </div>
            <div className="panel__actions">
              <button
                type="button"
                className="icon-btn"
                onClick={reset}
                title="Start a new chat"
                aria-label="Start a new chat"
              >
                ⟳
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={closePanel}
                title="Close chat"
                aria-label="Close chat"
              >
                ✕
              </button>
            </div>
          </header>

          <div className="panel__body" ref={bodyRef}>
            <div className="log" role="log" aria-live="polite" aria-atomic="false">
              {messages.map((m) => (
                <div key={m.id} className={`msg msg--${m.role}`}>
                  {m.role === 'assistant' && (
                    <span className="msg__avatar" aria-hidden="true">
                      <ToothMark />
                    </span>
                  )}
                  <div className="msg__bubble">
                    <span className="msg__from">
                      {m.role === 'assistant' ? `${name} said:` : 'You said:'}
                    </span>
                    {m.content}
                  </div>
                </div>
              ))}

              {status === 'thinking' && (
                <div className="msg msg--assistant">
                  <span className="msg__avatar" aria-hidden="true">
                    <ToothMark />
                  </span>
                  <div className="msg__bubble dots" aria-label={`${name} is typing`}>
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              )}
            </div>

            {showQuickReplies && (
              <div className="quick">
                {quickReplies.map((q) => (
                  <button key={q} type="button" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <div className="notice notice--error" role="alert">
                <span aria-hidden="true">⚠️</span>
                <div>
                  {error.message}
                  {error.code !== 'session_limit' && (
                    <button type="button" className="notice__action" onClick={retry}>
                      ↻ Retry
                    </button>
                  )}
                </div>
              </div>
            )}

            {limitReached && !error && (
              <div className="notice notice--warn" role="status">
                <span aria-hidden="true">⏳</span>
                <div>
                  You've used all {maxMessages} messages in this demo session.{' '}
                  <button type="button" className="notice__action" onClick={reset}>
                    Start a new chat
                  </button>
                </div>
              </div>
            )}
          </div>

          <form className="panel__foot" onSubmit={submit}>
            <div className="composer">
              <label className="sr-only" htmlFor="nds-chat-input">
                Message {name}
              </label>
              <textarea
                id="nds-chat-input"
                ref={inputRef}
                rows={1}
                value={draft}
                disabled={limitReached}
                placeholder={
                  limitReached ? 'Message limit reached' : 'Ask about services, prices or hours…'
                }
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              <button
                type="submit"
                className="send"
                disabled={!draft.trim() || busy || limitReached}
                aria-label="Send message"
              >
                <SendIcon />
              </button>
            </div>
            <p className="legal">
              <span className="legal__by">
                <i aria-hidden="true" />
                Powered by Gemini
              </span>
              <span className="legal__count">
                {remaining} message{remaining === 1 ? '' : 's'} left
              </span>
            </p>
          </form>
        </div>
      )}

      {/* ── Launcher ──────────────────────────────────────────────────────── */}
      {teaser && !open && (
        <div className="teaser">
          <button
            type="button"
            className="teaser__x"
            onClick={dismissTeaser}
            aria-label="Dismiss"
          >
            ✕
          </button>
          <button type="button" className="teaser__body" onClick={openPanel}>
            <strong>Questions about prices or hours?</strong>
            <span>Ask our assistant — replies instantly</span>
          </button>
        </div>
      )}

      <button
        type="button"
        ref={launcherRef}
        className={`launcher${open ? ' launcher--open' : ''}`}
        onClick={() => (open ? closePanel() : openPanel())}
        aria-expanded={open}
        aria-controls="nds-chat-panel"
        aria-label={open ? 'Close chat' : `Open chat with ${name}`}
      >
        {open ? (
          <span className="launcher__close" aria-hidden="true">
            ✕
          </span>
        ) : (
          <>
            <span className="launcher__chat" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {!teaser && <span className="launcher__badge" aria-hidden="true">1</span>}
          </>
        )}
      </button>
    </div>
  );
}

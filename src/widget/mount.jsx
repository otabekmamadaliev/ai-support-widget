import { createRoot } from 'react-dom/client';
import SupportWidget from './SupportWidget.jsx';
import styles from './widget.css?inline';

/**
 * Mount the widget into a shadow root.
 *
 * The shadow root is the whole point of this function: the host page's CSS
 * cannot reach the widget, and the widget's CSS cannot escape to the host. That
 * is what lets the same bundle drop onto any site without a visual audit first.
 * The stylesheet is inlined at build time so there is no second request.
 *
 * @returns {() => void} teardown — unmounts React and removes the host element.
 */
export function mountWidget(options = {}) {
  const host = document.createElement('div');
  host.setAttribute('data-support-widget', '');
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = styles;
  shadow.appendChild(style);

  const container = document.createElement('div');
  shadow.appendChild(container);

  const root = createRoot(container);
  root.render(<SupportWidget {...options} />);

  return () => {
    // Unmounting a root synchronously from inside another root's effect cleanup
    // makes React 19 warn about a render race — which is exactly what happens
    // when a host component tears the widget down. Defer past the commit.
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  };
}

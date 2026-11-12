/**
 * Loads the YouTube IFrame API script (`https://www.youtube.com/iframe_api`) once and tells every
 * waiting listener when it is ready or failed. A failed script tag is removed, so the next call
 * tries again. The bridge calls it when it creates a player; `warmUpYouTubeApi` calls it early.
 */
const API_LOAD_TIMEOUT_MS = 15000;
/** Fallback delay when the browser has no `requestIdleCallback`. */
const WARM_UP_DELAY_MS = 1500;

export interface ApiListener {
  ready: () => void;
  fail: () => void;
}

let ytApiLoading = false;
const apiListeners: ApiListener[] = [];

function flushApiListeners(outcome: keyof ApiListener) {
  const pending = apiListeners.splice(0, apiListeners.length);
  for (const listener of pending) {
    listener[outcome]();
  }
}

export function loadYouTubeIframeApi(listener: ApiListener) {
  if (typeof window === 'undefined') return;
  if (window.YT && window.YT.Player) {
    listener.ready();
    return;
  }
  apiListeners.push(listener);
  if (ytApiLoading) return;
  ytApiLoading = true;

  let settled = false;
  const settle = (outcome: keyof ApiListener) => {
    if (settled) return;
    settled = true;
    ytApiLoading = false;
    window.clearTimeout(timeoutId);
    flushApiListeners(outcome);
  };

  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    if (prev) prev();
    settle('ready');
  };

  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  script.async = true;
  script.onerror = () => {
    script.remove();
    settle('fail');
  };
  const timeoutId = window.setTimeout(() => {
    if (!(window.YT && window.YT.Player)) {
      script.remove();
      settle('fail');
    }
  }, API_LOAD_TIMEOUT_MS);
  document.head.appendChild(script);
}

let warmUpScheduled = false;

/**
 * Once per page load: while nothing is active, loads the API script from an idle callback so the
 * first play does not pay for it. Silent: a failure sets no state and shows no notice, and the
 * bridge's own later load starts again from scratch. When a track is active by then, the bridge
 * loads the API itself and this does nothing.
 */
export function warmUpYouTubeApi(nothingActive: () => boolean): void {
  if (warmUpScheduled || typeof window === 'undefined') return;
  warmUpScheduled = true;
  const run = () => {
    if (!nothingActive()) return;
    loadYouTubeIframeApi({ ready: () => undefined, fail: () => undefined });
  };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 3000 });
  else window.setTimeout(run, WARM_UP_DELAY_MS);
}

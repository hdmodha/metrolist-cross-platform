/**
 * Brave-style ad blocking for the desktop app: every request of the session (the app page and the
 * YouTube player iframe alike) passes `shouldBlockRequest` (`src/shared/adBlock.ts`, shared with the
 * Android app) before it leaves; ad and tracking requests are cancelled, the video plays normally.
 */
import type { Session } from 'electron';
import { shouldBlockRequest } from '../src/shared/adBlock';

export interface AdBlocker {
  /** Requests cancelled since the app started. */
  blockedCount: () => number;
}

/** Logs the first block and then every 50th, so the log shows it working without flooding. */
const LOG_EVERY = 50;

export function installAdBlocker(ses: Session, log: (line: string) => void = console.log): AdBlocker {
  let blocked = 0;
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const cancel = shouldBlockRequest(details.url, details.resourceType);
    if (cancel) {
      blocked++;
      if (blocked === 1 || blocked % LOG_EVERY === 0) {
        let host = '';
        try {
          host = new URL(details.url).host;
        } catch {
          // keep it empty
        }
        log(`[metrolist] ad blocker: ${blocked} ad / tracking request(s) blocked so far (latest: ${host})`);
      }
    }
    callback({ cancel });
  });
  return { blockedCount: () => blocked };
}

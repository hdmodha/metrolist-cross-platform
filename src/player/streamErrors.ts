/**
 * What a YouTube IFrame player error means, and how the player recovers from it. Pure, shared by
 * the reducer (notice texts) and `effectPolicies.ts` (recovery plans).
 *
 * `onError` codes of the IFrame Player API:
 * - 2   invalid parameter (a malformed video id)
 * - 5   HTML5 player error (often transient)
 * - 100 the video was removed or is private
 * - 101 / 150 the owner does not allow the video to be played in other apps / sites ("embedding")
 * - 152 / 153 the embedder or its referrer was rejected (a problem with how the app embeds the
 *   player, not with this song: another upload would fail the same way)
 */

export type UnplayableReason =
  | 'embedDisabled'
  | 'unavailable'
  | 'invalidVideo'
  | 'playerError'
  | 'embedderRejected'
  | 'unknown';

/**
 * - `alternate`: look for another upload of the same song at once
 * - `retryThenAlternate`: re-create the player for the same video once, then look for another upload
 * - `retryThenSkip`: re-create the player once, then skip (other uploads would fail the same way)
 */
export type StreamErrorRecovery = 'alternate' | 'retryThenAlternate' | 'retryThenSkip';

export interface StreamErrorClass {
  reason: UnplayableReason;
  recovery: StreamErrorRecovery;
}

export function classifyStreamError(code: number): StreamErrorClass {
  switch (code) {
    case 2:
      return { reason: 'invalidVideo', recovery: 'alternate' };
    case 5:
      return { reason: 'playerError', recovery: 'retryThenAlternate' };
    case 100:
      return { reason: 'unavailable', recovery: 'alternate' };
    case 101:
    case 150:
      return { reason: 'embedDisabled', recovery: 'alternate' };
    case 152:
    case 153:
      return { reason: 'embedderRejected', recovery: 'retryThenSkip' };
    default:
      return { reason: 'unknown', recovery: 'alternate' };
  }
}

/**
 * Reasons that belong to the upload itself (not to the network or to the app): a song whose every
 * upload failed for one of these is remembered as unplayable for this session.
 */
export function isContentRestriction(reason: UnplayableReason): boolean {
  return reason === 'embedDisabled' || reason === 'unavailable' || reason === 'invalidVideo';
}

/**
 * The notice about a song that cannot be played: honest about why, never blaming the listener.
 * `outcome`: `skipping` (it failed while playing), `skipped` (it was jumped over without being
 * loaded) or `none` (a tap on it was refused).
 */
export function unplayableNotice(
  title: string,
  reason: UnplayableReason = 'unknown',
  outcome: 'skipping' | 'skipped' | 'none' = 'skipping'
): string {
  const suffix = outcome === 'skipping' ? ' Skipping…' : outcome === 'skipped' ? ' Skipped.' : '';
  return `${unplayableReasonText(title, reason)}${suffix}`;
}

function unplayableReasonText(title: string, reason: UnplayableReason): string {
  switch (reason) {
    case 'embedDisabled':
      return `“${title}” can’t be played outside YouTube: its owner turned that off.`;
    case 'unavailable':
      return `“${title}” was removed from YouTube or is private.`;
    case 'invalidVideo':
      return `“${title}” has no playable video on YouTube.`;
    case 'playerError':
      return `YouTube’s player couldn’t play “${title}”.`;
    case 'embedderRejected':
      return `YouTube refused to play “${title}” in this app.`;
    default:
      return `“${title}” can’t be played here.`;
  }
}

/** A short, one-line reason shown on a song in a list that is known not to play (and in its accessible name). */
export function unplayableShortReason(reason: UnplayableReason = 'unknown'): string {
  switch (reason) {
    case 'embedDisabled':
      return 'Its owner doesn’t allow playback outside YouTube';
    case 'unavailable':
      return 'Removed from YouTube or private';
    case 'invalidVideo':
      return 'No playable video on YouTube';
    default:
      return 'Can’t be played here';
  }
}

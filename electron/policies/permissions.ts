/**
 * Web permissions the desktop app grants. Everything else (camera, microphone, geolocation,
 * notifications, MIDI, HID, …) is denied: the app needs none of it.
 * - `fullscreen`: the YouTube player's fullscreen button.
 * - `clipboard-sanitized-write`: copying text (e.g. a song title) through the async clipboard API.
 */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen', 'clipboard-sanitized-write']);

export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

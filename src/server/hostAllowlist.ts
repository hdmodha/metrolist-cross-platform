/**
 * DNS-rebinding protection for the desktop server. The desktop app's server listens on 127.0.0.1, but
 * a web page on any site can point its own domain at 127.0.0.1 and then talk to it as same-origin.
 * Such requests carry the attacker's name in `Host`, so only the two names the app itself uses are
 * accepted, on the port the server is actually bound to. Exact string comparison, no regex.
 */
export function isAllowedDesktopHost(hostHeader: string | undefined, port: number): boolean {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  if (typeof hostHeader !== 'string' || hostHeader.length === 0 || hostHeader.length > 32) return false;
  const host = hostHeader.toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

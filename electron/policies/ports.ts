/**
 * The desktop app's local server port. localStorage (liked songs, downloads, the queue) is stored per
 * origin, and the origin includes the port, so the app always prefers the same fixed port: a random
 * port would lose the listener's data on every launch. If it is taken, a short list of fallbacks is
 * tried, then any free port as a last resort (the app then tells the listener their saved data is
 * not available in this session).
 */
export const PREFERRED_PORT = 47823;
export const DESKTOP_PORTS: readonly number[] = [PREFERRED_PORT, 47824, 47825, 47826, 47827];

export interface PortChoice<T> {
  value: T;
  /** The port that was asked for (`0` = any free port; read the real one from `value`). */
  port: number;
  usedFallback: boolean;
  /** Ports that were busy or not allowed, in the order tried. */
  unavailable: number[];
}

/** A port that is taken (`EADDRINUSE`) or not allowed (`EACCES`, e.g. reserved by Windows / Hyper-V). */
export function isPortUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EADDRINUSE' || code === 'EACCES';
}

export async function listenOnPreferredPort<T>(
  listen: (port: number) => Promise<T>,
  ports: readonly number[] = DESKTOP_PORTS
): Promise<PortChoice<T>> {
  const unavailable: number[] = [];
  for (const port of [...ports, 0]) {
    try {
      const value = await listen(port);
      return { value, port, usedFallback: port !== ports[0], unavailable };
    } catch (err) {
      if (port === 0 || !isPortUnavailable(err)) throw err;
      unavailable.push(port);
    }
  }
  throw new Error('No port available.');
}

/** Whether to tell the listener their saved data is not available on `port` (once per fallback port). */
export function shouldShowPortNotice(port: number, alreadyNoticed: readonly number[]): boolean {
  if (port === PREFERRED_PORT) return false;
  if (!DESKTOP_PORTS.includes(port)) return true;
  return !alreadyNoticed.includes(port);
}

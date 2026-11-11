/** Right-sized cover URLs: small boxes (rows, mini player) do not need the 400 px class image. Pure, never throws. */

export type ArtworkSize = 'small' | 'large';

const SMALL_PX = 120;
const YT_FULL_NAMES = new Set(['hqdefault', 'sddefault', 'maxresdefault', 'hq720']);

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** `/vi/<id>/<name>.jpg` or `/vi_webp/<id>/<name>.webp` with a full-size name → the same path with mqdefault. */
function smallYtimgPath(pathname: string): string | null {
  const parts = pathname.split('/');
  if (parts.length !== 4 || parts[0] !== '') return null;
  const [, kind, id, file] = parts;
  const ext = kind === 'vi' ? '.jpg' : kind === 'vi_webp' ? '.webp' : null;
  if (!ext || !id || !file.endsWith(ext)) return null;
  if (!YT_FULL_NAMES.has(file.slice(0, file.length - ext.length))) return null;
  return `/${kind}/${id}/mqdefault${ext}`;
}

function isDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** `w400-h400-l90-rj` → `w120-h120-l90-rj`; `s544` → `s120`; anything else → null. */
function smallSizeDirective(directive: string): string | null {
  const flags = directive.split('-');
  const first = flags[0];
  if (flags.length === 1 && first[0] === 's' && isDigits(first.slice(1))) return `s${SMALL_PX}`;
  if (flags.length >= 2 && first[0] === 'w' && isDigits(first.slice(1)) && flags[1][0] === 'h' && isDigits(flags[1].slice(1))) {
    return [`w${SMALL_PX}`, `h${SMALL_PX}`, ...flags.slice(2)].join('-');
  }
  return null;
}

export function artworkUrlForSize(url: string, size: ArtworkSize): string {
  if (size === 'large') return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return url;
    const host = parsed.hostname.toLowerCase();
    if (hostIs(host, 'ytimg.com')) {
      const path = smallYtimgPath(parsed.pathname);
      return path ? `${parsed.origin}${path}` : url;
    }
    if (hostIs(host, 'googleusercontent.com') || hostIs(host, 'ggpht.com')) {
      const eq = url.lastIndexOf('=');
      if (eq < 0 || url.indexOf('/', eq) >= 0 || url.indexOf('?', eq) >= 0 || url.indexOf('#', eq) >= 0) return url;
      const directive = smallSizeDirective(url.slice(eq + 1));
      return directive ? `${url.slice(0, eq + 1)}${directive}` : url;
    }
    return url;
  } catch {
    return url;
  }
}

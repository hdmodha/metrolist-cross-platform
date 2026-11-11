package com.metrolist.backgroundplayback;

import java.io.ByteArrayOutputStream;
import java.net.IDN;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The host and path of an http(s) URL, parsed the way the WHATWG URL parser (`new URL(url)` in
 * `src/shared/adBlock.ts`) does for everything the ad-block rules look at: leading / trailing
 * spaces and control characters trimmed, tabs and newlines removed, case-insensitive scheme,
 * backslashes as slashes, any number of slashes after "https:", user info, port, percent-encoded
 * and internationalized hosts, and "." / ".." path segments (also as %2e). A URL the WHATWG parser
 * rejects (empty host, bad port, forbidden host characters) gives {@code null}, like the TypeScript
 * matcher's {@code catch}. Pure Java (no Android classes), linear in the URL length.
 *
 * <p>The WebView hands {@code shouldInterceptRequest} URLs it has already canonicalized, so in the
 * app this mostly sees plain URLs; the careful parsing keeps the JUnit test vectors (shared with the
 * TypeScript tests) meaningful for any input.
 */
final class AdBlockUrl {

    final String host;
    final String path;

    private AdBlockUrl(String host, String path) {
        this.host = host;
        this.path = path;
    }

    /** {@code null} unless {@code input} is a valid http or https URL. */
    static AdBlockUrl parseHttp(String input) {
        if (input == null) return null;
        String url = clean(input);
        int colon = schemeEnd(url);
        if (colon < 0) return null;
        String scheme = url.substring(0, colon).toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return null;

        int i = colon + 1;
        int n = url.length();
        while (i < n && (url.charAt(i) == '/' || url.charAt(i) == '\\')) i++;

        int authorityEnd = i;
        while (authorityEnd < n && !isAuthorityEnd(url.charAt(authorityEnd))) authorityEnd++;
        String authority = url.substring(i, authorityEnd);
        int at = authority.lastIndexOf('@');
        String hostAndPort = at >= 0 ? authority.substring(at + 1) : authority;

        String rawHost = hostAndPort;
        if (hostAndPort.startsWith("[")) {
            int close = hostAndPort.indexOf(']');
            if (close < 0) return null;
            rawHost = hostAndPort.substring(0, close + 1);
            String rest = hostAndPort.substring(close + 1);
            if (!rest.isEmpty() && (rest.charAt(0) != ':' || !isValidPort(rest.substring(1)))) return null;
        } else {
            int portColon = hostAndPort.indexOf(':');
            if (portColon >= 0) {
                rawHost = hostAndPort.substring(0, portColon);
                if (!isValidPort(hostAndPort.substring(portColon + 1))) return null;
            }
        }
        if (rawHost.isEmpty()) return null;
        String host = rawHost.startsWith("[") ? rawHost.toLowerCase(Locale.ROOT) : domainToAscii(rawHost);
        if (host == null || host.isEmpty()) return null;

        String path = "/";
        if (authorityEnd < n && (url.charAt(authorityEnd) == '/' || url.charAt(authorityEnd) == '\\')) {
            int pathEnd = authorityEnd;
            while (pathEnd < n && url.charAt(pathEnd) != '?' && url.charAt(pathEnd) != '#') pathEnd++;
            path = normalizePath(url.substring(authorityEnd + 1, pathEnd));
        }
        return new AdBlockUrl(host, path);
    }

    /** Leading / trailing C0 controls and spaces trimmed; ASCII tab and newlines removed anywhere. */
    private static String clean(String input) {
        int start = 0;
        int end = input.length();
        while (start < end && input.charAt(start) <= 0x20) start++;
        while (end > start && input.charAt(end - 1) <= 0x20) end--;
        StringBuilder out = new StringBuilder(end - start);
        for (int i = start; i < end; i++) {
            char c = input.charAt(i);
            if (c != '\t' && c != '\n' && c != '\r') out.append(c);
        }
        return out.toString();
    }

    /** Index of the colon ending a valid scheme, or -1. */
    private static int schemeEnd(String url) {
        if (url.isEmpty() || !isAsciiAlpha(url.charAt(0))) return -1;
        for (int i = 1; i < url.length(); i++) {
            char c = url.charAt(i);
            if (c == ':') return i;
            if (!(isAsciiAlpha(c) || (c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.')) return -1;
        }
        return -1;
    }

    private static boolean isAsciiAlpha(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    }

    private static boolean isAuthorityEnd(char c) {
        return c == '/' || c == '\\' || c == '?' || c == '#';
    }

    private static boolean isValidPort(String port) {
        if (port.isEmpty()) return true;
        if (port.length() > 5) {
            // Leading zeros are allowed: only the value counts
            int firstNonZero = 0;
            while (firstNonZero < port.length() - 1 && port.charAt(firstNonZero) == '0') firstNonZero++;
            port = port.substring(firstNonZero);
            if (port.length() > 5) return false;
        }
        for (int i = 0; i < port.length(); i++) {
            char c = port.charAt(i);
            if (c < '0' || c > '9') return false;
        }
        return Integer.parseInt(port) <= 65535;
    }

    /** Percent-decoded, IDNA to ASCII, lowercase; {@code null} for a host the URL parser rejects. */
    private static String domainToAscii(String raw) {
        String decoded = percentDecodeUtf8(raw);
        if (decoded == null) return null;
        String ascii;
        if (isAscii(decoded)) {
            ascii = decoded.toLowerCase(Locale.ROOT);
        } else {
            try {
                ascii = IDN.toASCII(decoded, IDN.ALLOW_UNASSIGNED).toLowerCase(Locale.ROOT);
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
        for (int i = 0; i < ascii.length(); i++) {
            if (isForbiddenDomainChar(ascii.charAt(i))) return null;
        }
        return ascii;
    }

    private static boolean isAscii(String s) {
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) > 0x7f) return false;
        }
        return true;
    }

    private static boolean isForbiddenDomainChar(char c) {
        if (c <= 0x20 || c == 0x7f) return true;
        switch (c) {
            case '#':
            case '%':
            case '/':
            case ':':
            case '<':
            case '>':
            case '?':
            case '@':
            case '[':
            case '\\':
            case ']':
            case '^':
            case '|':
                return true;
            default:
                return false;
        }
    }

    /** %XX sequences decoded as UTF-8 (invalid sequences are kept); {@code null} for invalid UTF-8. */
    private static String percentDecodeUtf8(String s) {
        if (s.indexOf('%') < 0) return s;
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(s.length());
        byte[] utf8 = s.getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < utf8.length; i++) {
            byte b = utf8[i];
            if (b == '%' && i + 2 < utf8.length && isHex(utf8[i + 1]) && isHex(utf8[i + 2])) {
                bytes.write((hexValue(utf8[i + 1]) << 4) | hexValue(utf8[i + 2]));
                i += 2;
            } else {
                bytes.write(b);
            }
        }
        try {
            return StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes.toByteArray()))
                .toString();
        } catch (CharacterCodingException e) {
            return null;
        }
    }

    private static boolean isHex(byte b) {
        return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F');
    }

    private static int hexValue(byte b) {
        if (b >= '0' && b <= '9') return b - '0';
        if (b >= 'a' && b <= 'f') return b - 'a' + 10;
        return b - 'A' + 10;
    }

    /**
     * The WHATWG path state for special schemes: segments split on "/" and "\", "." and ".." (also
     * "%2e" forms) resolved, a trailing "." or ".." leaves the path ending in "/". {@code rest} is
     * everything after the first slash, up to the query / fragment.
     */
    private static String normalizePath(String rest) {
        List<String> segments = new ArrayList<>();
        int start = 0;
        int n = rest.length();
        for (int i = 0; i <= n; i++) {
            boolean atEnd = i == n;
            char c = atEnd ? 0 : rest.charAt(i);
            if (!atEnd && c != '/' && c != '\\') continue;
            String segment = rest.substring(start, i);
            if (isDoubleDot(segment)) {
                if (!segments.isEmpty()) segments.remove(segments.size() - 1);
                if (atEnd) segments.add("");
            } else if (isSingleDot(segment)) {
                if (atEnd) segments.add("");
            } else {
                segments.add(segment);
            }
            start = i + 1;
        }
        StringBuilder out = new StringBuilder(rest.length() + 1);
        for (String segment : segments) out.append('/').append(segment);
        return out.length() == 0 ? "/" : out.toString();
    }

    private static boolean isSingleDot(String s) {
        return s.equals(".") || s.equalsIgnoreCase("%2e");
    }

    private static boolean isDoubleDot(String s) {
        return (
            s.equals("..") ||
            s.equalsIgnoreCase(".%2e") ||
            s.equalsIgnoreCase("%2e.") ||
            s.equalsIgnoreCase("%2e%2e")
        );
    }
}

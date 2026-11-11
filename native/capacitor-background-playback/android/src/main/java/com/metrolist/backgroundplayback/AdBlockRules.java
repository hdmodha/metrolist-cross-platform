package com.metrolist.backgroundplayback;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The ad / tracking blocklist of {@code src/shared/adBlock.ts}, loaded from the generated
 * {@code metrolist-ad-block-rules.json} asset ({@code npm run adblock:rules}). Same semantics as
 * {@code shouldBlockRequest}: a top-level navigation and anything that is not http(s) is never
 * blocked; the never-block hosts win over every rule, then a blocked host blocks, then the
 * never-block paths win over the path rules. A host rule matches the host and its subdomains; a
 * trailing dot of the host is ignored. JUnit runs the test vectors shared with the TypeScript tests
 * ({@code AdBlockRulesTest}). Immutable and thread-safe (the WebView asks from its IO thread).
 */
final class AdBlockRules {

    static final String ASSET_NAME = "metrolist-ad-block-rules.json";

    private static final class PathRule {

        final List<String> hosts;
        final String pathPrefix;

        PathRule(List<String> hosts, String pathPrefix) {
            this.hosts = hosts;
            this.pathPrefix = pathPrefix;
        }
    }

    private final List<String> blockHosts;
    private final List<PathRule> blockPaths;
    private final List<String> neverBlockHosts;
    private final List<String> neverBlockPaths;

    private AdBlockRules(List<String> blockHosts, List<PathRule> blockPaths, List<String> neverBlockHosts, List<String> neverBlockPaths) {
        this.blockHosts = blockHosts;
        this.blockPaths = blockPaths;
        this.neverBlockHosts = neverBlockHosts;
        this.neverBlockPaths = neverBlockPaths;
    }

    static AdBlockRules fromJson(String json) throws JSONException {
        JSONObject root = new JSONObject(json);
        if (root.getInt("version") != 1) throw new JSONException("Unsupported ad-block rules version " + root.get("version"));
        List<PathRule> paths = new ArrayList<>();
        JSONArray pathArray = root.getJSONArray("blockPaths");
        for (int i = 0; i < pathArray.length(); i++) {
            JSONObject rule = pathArray.getJSONObject(i);
            paths.add(new PathRule(strings(rule.getJSONArray("hosts")), rule.getString("pathPrefix")));
        }
        return new AdBlockRules(
            strings(root.getJSONArray("blockHosts")),
            Collections.unmodifiableList(paths),
            strings(root.getJSONArray("neverBlockHosts")),
            strings(root.getJSONArray("neverBlockPaths"))
        );
    }

    private static List<String> strings(JSONArray array) throws JSONException {
        List<String> out = new ArrayList<>(array.length());
        for (int i = 0; i < array.length(); i++) out.add(array.getString(i));
        return Collections.unmodifiableList(out);
    }

    int ruleCount() {
        return blockHosts.size() + blockPaths.size();
    }

    /** Whether the request for {@code url} should be answered with an empty response. */
    boolean shouldBlock(String url, boolean isMainFrame) {
        if (isMainFrame) return false;
        AdBlockUrl parsed = AdBlockUrl.parseHttp(url);
        if (parsed == null) return false;
        String host = parsed.host;
        if (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        for (String keep : neverBlockHosts) {
            if (isOnHost(host, keep)) return false;
        }
        for (String blocked : blockHosts) {
            if (isOnHost(host, blocked)) return true;
        }
        String path = parsed.path;
        for (String keep : neverBlockPaths) {
            if (path.startsWith(keep)) return false;
        }
        for (PathRule rule : blockPaths) {
            if (!path.startsWith(rule.pathPrefix)) continue;
            for (String domain : rule.hosts) {
                if (isOnHost(host, domain)) return true;
            }
        }
        return false;
    }

    private static boolean isOnHost(String host, String domain) {
        return host.equals(domain) || (host.length() > domain.length() && host.endsWith(domain) && host.charAt(host.length() - domain.length() - 1) == '.');
    }
}

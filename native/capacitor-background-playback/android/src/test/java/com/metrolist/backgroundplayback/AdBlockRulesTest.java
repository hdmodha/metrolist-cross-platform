package com.metrolist.backgroundplayback;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.BeforeClass;
import org.junit.Test;

/**
 * Runs the ad-block test vectors shared with the TypeScript tests ({@code src/shared/adBlockVectors.ts},
 * written to {@code src/test/resources/ad-block-vectors.json} by {@code npm run adblock:rules})
 * against the rules asset the app ships ({@code src/main/assets/metrolist-ad-block-rules.json}, on
 * the test classpath through build.gradle's test resources). Both matchers must give the same answers.
 */
public class AdBlockRulesTest {

    private static AdBlockRules rules;
    private static JSONArray vectors;

    @BeforeClass
    public static void load() throws Exception {
        rules = AdBlockRules.fromJson(resource(AdBlockRules.ASSET_NAME));
        vectors = new JSONObject(resource("ad-block-vectors.json")).getJSONArray("vectors");
    }

    private static String resource(String name) throws IOException {
        InputStream in = AdBlockRulesTest.class.getClassLoader().getResourceAsStream(name);
        assertNotNull(name + " is on the test classpath", in);
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = stream.read(buffer)) != -1) out.write(buffer, 0, read);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @Test
    public void everySharedVectorGivesTheSameAnswerAsTheTypeScriptMatcher() throws Exception {
        assertTrue("the vectors were generated", vectors.length() > 100);
        List<String> mismatches = new ArrayList<>();
        for (int i = 0; i < vectors.length(); i++) {
            JSONObject vector = vectors.getJSONObject(i);
            String url = vector.getString("url");
            boolean isMainFrame = "mainFrame".equals(vector.optString("resourceType", ""));
            boolean expected = vector.getBoolean("block");
            if (rules.shouldBlock(url, isMainFrame) != expected) {
                mismatches.add((expected ? "should block: " : "should allow: ") + JSONObject.quote(url) + (isMainFrame ? " (main frame)" : ""));
            }
        }
        assertEquals("mismatches: " + mismatches, 0, mismatches.size());
    }

    @Test
    public void theNeverBlockListWinsOverEveryRule() {
        // A never-block host under a blocked domain, and never-block paths under blocked prefixes
        assertFalse(rules.shouldBlock("https://rr1---sn-abc.googlevideo.com/videoplayback?id=1", false));
        assertFalse(rules.shouldBlock("https://www.youtube.com/embed/abc?x=/pagead/", false));
        assertFalse(rules.shouldBlock("https://www.youtube.com/youtubei/v1/player", false));
        assertTrue(rules.shouldBlock("https://www.youtube.com/youtubei/v1/log_event", false));
    }

    @Test
    public void navigationsAndOtherSchemesAreNeverBlocked() {
        assertFalse(rules.shouldBlock("https://googleads.g.doubleclick.net/pagead/id", true));
        assertTrue(rules.shouldBlock("https://googleads.g.doubleclick.net/pagead/id", false));
        assertFalse(rules.shouldBlock(null, false));
        assertFalse(rules.shouldBlock("https://localhost/pagead/", false));
    }

    @Test
    public void hostileUrlsAreFast() {
        StringBuilder host = new StringBuilder();
        for (int i = 0; i < 100; i++) host.append("a.");
        host.append("doubleclick.net");
        StringBuilder path = new StringBuilder("https://www.youtube.com/");
        for (int i = 0; i < 20000; i++) path.append("p/");
        long started = System.nanoTime();
        for (int i = 0; i < 200; i++) {
            assertTrue(rules.shouldBlock("https://" + host + "/x", false));
            assertFalse(rules.shouldBlock(path.toString(), false));
        }
        long elapsedMs = (System.nanoTime() - started) / 1_000_000;
        assertTrue("took " + elapsedMs + " ms", elapsedMs < 5000);
    }
}

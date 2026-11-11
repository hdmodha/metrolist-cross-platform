package com.metrolist.backgroundplayback;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * Runs the vectors of the "system paused us" guard shared with the TypeScript reference
 * ({@code src/shared/systemPauseGuardVectors.ts}, written to
 * {@code src/test/resources/system-pause-guard-vectors.json} by {@code npm run adblock:rules}).
 */
public class SystemPauseGuardTest {

    private static String resource(String name) throws IOException {
        InputStream in = SystemPauseGuardTest.class.getClassLoader().getResourceAsStream(name);
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
    public void sharedVectors() throws Exception {
        JSONObject json = new JSONObject(resource("system-pause-guard-vectors.json"));
        assertEquals("the window is the TypeScript one", json.getLong("windowMs"), SystemPauseGuard.WINDOW_MS);
        JSONArray cases = json.getJSONArray("cases");
        assertTrue(cases.length() >= 15);
        int decisions = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject vector = cases.getJSONObject(i);
            String name = vector.getString("name");
            SystemPauseGuard guard = new SystemPauseGuard();
            JSONArray steps = vector.getJSONArray("steps");
            for (int s = 0; s < steps.length(); s++) {
                JSONObject step = steps.getJSONObject(s);
                JSONObject event = step.getJSONObject("event");
                String type = event.getString("type");
                long at = event.getLong("at");
                switch (type) {
                    case "background":
                        guard.onBackground(at);
                        break;
                    case "foreground":
                        guard.onForeground();
                        break;
                    case "userCommand":
                        guard.onUserCommand(event.getString("action"));
                        break;
                    case "update": {
                        String pausedBy = event.has("pausedBy") ? event.getString("pausedBy") : null;
                        boolean resume = guard.onUpdate(event.getString("state"), pausedBy, at);
                        assertEquals(name + " (step " + s + ")", step.getString("expect"), resume ? "resume" : "none");
                        decisions++;
                        break;
                    }
                    default:
                        throw new AssertionError("unknown event " + type);
                }
            }
        }
        assertTrue(decisions > cases.length());
    }

    @Test
    public void visibilityPolicyKeepsTheWindowVisibleOnlyWhileMusicIsWanted() {
        assertEquals(WindowVisibilityPolicy.VISIBLE, WindowVisibilityPolicy.reported(WindowVisibilityPolicy.GONE, true));
        assertEquals(WindowVisibilityPolicy.VISIBLE, WindowVisibilityPolicy.reported(WindowVisibilityPolicy.INVISIBLE, true));
        assertEquals(WindowVisibilityPolicy.GONE, WindowVisibilityPolicy.reported(WindowVisibilityPolicy.GONE, false));
        assertEquals(WindowVisibilityPolicy.INVISIBLE, WindowVisibilityPolicy.reported(WindowVisibilityPolicy.INVISIBLE, false));
        assertEquals(WindowVisibilityPolicy.VISIBLE, WindowVisibilityPolicy.reported(WindowVisibilityPolicy.VISIBLE, false));
        assertEquals("GONE", WindowVisibilityPolicy.name(8));
        assertEquals("UNKNOWN(3)", WindowVisibilityPolicy.name(3));
    }

    @Test
    public void theGuardIsInTheBackgroundOnlyBetweenTheSignals() {
        SystemPauseGuard guard = new SystemPauseGuard();
        assertFalse(guard.isInBackground());
        guard.onBackground(10);
        assertTrue(guard.isInBackground());
        guard.onForeground();
        assertFalse(guard.isInBackground());
    }
}

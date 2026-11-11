import Foundation

/// The "system paused us" guard, the Swift twin of `src/shared/systemPauseGuard.ts` (the reference)
/// and of the Android plugin's `SystemPauseGuard.java`. All three run the shared vectors
/// (`android/src/test/resources/system-pause-guard-vectors.json`, written by `npm run adblock:rules`;
/// CI runs them against this file with `ios/Tests/main.swift`).
///
/// WebKit may pause a video player when the app leaves the foreground. The page then reports
/// `paused` with `pausedBy: player` (the player paused itself, not the listener). If that comes within
/// `windowMs` of entering the background while music was wanted, `onUpdate` answers `true` once per
/// background episode and the plugin sends `play` back to the page. A pause the listener asked for
/// (the app, the lock screen, a headset, an audio interruption) always stands. Pure Foundation;
/// main thread only.
final class SystemPauseGuard {
    /// From entering the background to the page's `paused` (the page settles an external pause for 700 ms).
    static let windowMs: Double = 2500

    private var wantsPlayback = false
    private(set) var inBackground = false
    private var backgroundAt: Double = 0
    private var armed = false
    private var used = false

    /// The app entered the background. Repeated calls keep the first time.
    func onBackground(at: Double) {
        if inBackground { return }
        inBackground = true
        backgroundAt = at
        armed = wantsPlayback
        used = false
    }

    /// The app is in the foreground again: the episode ends.
    func onForeground() {
        inBackground = false
        armed = false
        used = false
    }

    /// A command from the lock screen / Control Center / headset (play, pause, next, previous, seekTo).
    func onUserCommand(_ action: String) {
        if action == "pause" { armed = false }
    }

    /// The page reported the player. `true`: the system paused us, resume once.
    func onUpdate(state: String, pausedBy: String?, at: Double) -> Bool {
        if state != "paused" {
            wantsPlayback = true
            return false
        }
        let resume = inBackground && armed && !used && pausedBy == "player" && at >= backgroundAt && at - backgroundAt <= SystemPauseGuard.windowMs
        if resume {
            wantsPlayback = true
            used = true
            return true
        }
        // Any pause that stands ends the episode
        wantsPlayback = false
        armed = false
        return false
    }
}

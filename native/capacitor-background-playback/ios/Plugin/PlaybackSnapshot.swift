import Foundation

/// What the page last told the plugin about the player (`BackgroundPlayback.update`), sanitized like
/// the Android plugin's `PlaybackSnapshot.java`.
struct PlaybackSnapshot {
    enum State: String {
        case playing
        /// The listener wants to hear music that is not audible yet (loading, the next song).
        case buffering
        case paused
    }

    static let pausedByUser = "user"
    static let pausedByPlayer = "player"
    private static let maxTextLength = 300
    private static let maxUrlLength = 2048

    let title: String
    let artist: String
    let album: String
    /// http(s) only, or empty.
    let artworkUrl: String
    /// 0 when unknown.
    let durationMs: Double
    let positionMs: Double
    let state: State
    /// Paused only: `player` or `user` (anything else).
    let pausedBy: String

    /// The listener wants music (playing or buffering): the audio session stays active.
    var wantsPlayback: Bool { return state != .paused }

    init(title: String, artist: String, album: String, artworkUrl: String, durationMs: Double, positionMs: Double, state: String, pausedBy: String?) {
        self.title = PlaybackSnapshot.text(title)
        self.artist = PlaybackSnapshot.text(artist)
        self.album = PlaybackSnapshot.text(album)
        self.artworkUrl = PlaybackSnapshot.httpUrl(artworkUrl)
        let duration = PlaybackSnapshot.millis(durationMs)
        let position = PlaybackSnapshot.millis(positionMs)
        self.durationMs = duration
        self.positionMs = duration > 0 ? min(position, duration) : position
        self.state = State(rawValue: state) ?? .paused
        self.pausedBy = pausedBy == PlaybackSnapshot.pausedByPlayer ? PlaybackSnapshot.pausedByPlayer : PlaybackSnapshot.pausedByUser
    }

    private init(copying base: PlaybackSnapshot, state: State) {
        title = base.title
        artist = base.artist
        album = base.album
        artworkUrl = base.artworkUrl
        durationMs = base.durationMs
        positionMs = base.positionMs
        self.state = state
        pausedBy = PlaybackSnapshot.pausedByUser
    }

    /// The same song in another state (an optimistic resume, or its undo).
    func with(state: State) -> PlaybackSnapshot {
        return PlaybackSnapshot(copying: self, state: state)
    }

    func sameMetadata(_ other: PlaybackSnapshot?) -> Bool {
        guard let other = other else { return false }
        return title == other.title && artist == other.artist && album == other.album && artworkUrl == other.artworkUrl && durationMs == other.durationMs
    }

    private static func text(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count > maxTextLength ? String(trimmed.prefix(maxTextLength)) : trimmed
    }

    private static func httpUrl(_ value: String) -> String {
        let url = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if url.count > maxUrlLength { return "" }
        let lower = url.lowercased()
        return lower.hasPrefix("https://") || lower.hasPrefix("http://") ? url : ""
    }

    private static func millis(_ value: Double) -> Double {
        if value.isNaN || value.isInfinite || value <= 0 { return 0 }
        return min(value.rounded(), 1e12)
    }
}

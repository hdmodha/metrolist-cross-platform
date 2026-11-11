import AVFoundation
import Foundation
import MediaPlayer
import UIKit

/// The native half of background playback on iOS (main thread only), the counterpart of the Android
/// plugin's `PlaybackController`: it holds what the page last reported, keeps the audio session
/// active while music is wanted (category `.playback`, activated at the first play; the app's
/// `UIBackgroundModes` has `audio`, added by `npm run native:prepare`), publishes the song to the lock
/// screen / Control Center (`MPNowPlayingInfoCenter`) and turns `MPRemoteCommandCenter` commands
/// (play, pause, toggle, next, previous, seek), headphones being unplugged and the app's lifecycle into
/// events for the page.
///
/// WebKit may still pause a video player when the app leaves the foreground: a `paused` the player
/// made itself right after that is answered with one `play` (`SystemPauseGuard`), never against a
/// pause the listener asked for (lock screen, headset, an audio interruption such as a call).
///
/// Untested on a device (CI only compiles it for the simulator).
final class NowPlayingController {
    /// `positionMs` is only set for `seekTo`.
    typealias CommandHandler = (_ action: String, _ positionMs: Double?, _ reason: String) -> Void

    static let reasonSystemPause = "systemPause"
    private static let playConfirmationTimeout: TimeInterval = 8
    private static let maxArtworkBytes = 2_000_000

    var onCommand: CommandHandler?
    var onLifecycle: ((String) -> Void)?

    private(set) var snapshot: PlaybackSnapshot?
    private let pauseGuard = SystemPauseGuard()
    private var audioSessionActive = false
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    private var artworkUrl = ""
    private var artwork: MPMediaItemArtwork?
    private var artworkTask: URLSessionDataTask?
    private var pendingConfirmation: DispatchWorkItem?
    private var observers: [NSObjectProtocol] = []

    init() {
        observeApp()
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    private static func nowMs() -> Double {
        return ProcessInfo.processInfo.systemUptime * 1000
    }

    /* ------------------------------------------- page ------------------------------------------- */

    /// The page reported the player (`BackgroundPlayback.update`).
    func update(_ reported: PlaybackSnapshot) {
        let previous = snapshot
        if previous == nil || previous?.state != reported.state || !reported.sameMetadata(previous) {
            let by = reported.state == .paused ? " (by \(reported.pausedBy))" : ""
            MetrolistLog.info("Page: \(reported.state.rawValue)\(by), \"\(reported.title)\" at \(Int(reported.positionMs / 1000)) s\(pauseGuard.inBackground ? ", app in the background" : "")")
        }
        let systemPaused = pauseGuard.onUpdate(state: reported.state.rawValue, pausedBy: reported.pausedBy, at: NowPlayingController.nowMs())
        var next = reported
        if systemPaused {
            MetrolistLog.warn("The system paused the player within \(Int(SystemPauseGuard.windowMs)) ms of entering the background: sending play once")
            next = reported.with(state: .buffering)
        }
        snapshot = next
        cancelConfirmation()
        if systemPaused { awaitConfirmation() }
        if next.wantsPlayback { activateAudioSession() }
        installRemoteCommands()
        if next.artworkUrl != artworkUrl { loadArtwork(next.artworkUrl) }
        publishNowPlaying()
        if systemPaused { dispatch("play", nil, NowPlayingController.reasonSystemPause) }
    }

    /// Nothing to play any more: lock-screen info and remote commands go away.
    func stop() {
        if snapshot != nil { MetrolistLog.info("Stop: nothing to play any more") }
        snapshot = nil
        cancelConfirmation()
        artworkTask?.cancel()
        artworkTask = nil
        artworkUrl = ""
        artwork = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        removeRemoteCommands()
        if audioSessionActive {
            audioSessionActive = false
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    /* ------------------------------------ listener commands ------------------------------------- */

    /// Play from the lock screen / Control Center / a headset: optimistic `buffering`, then the page plays.
    private func requestPlay(reason: String) {
        guard let current = snapshot else {
            stop()
            return
        }
        if !current.wantsPlayback {
            snapshot = current.with(state: .buffering)
            cancelConfirmation()
            awaitConfirmation()
            activateAudioSession()
            publishNowPlaying()
        }
        dispatch("play", nil, reason)
    }

    private func dispatch(_ action: String, _ positionMs: Double?, _ reason: String) {
        if reason != NowPlayingController.reasonSystemPause { pauseGuard.onUserCommand(action) }
        let at = positionMs.map { " \(Int($0 / 1000)) s" } ?? ""
        MetrolistLog.info("Command to the page: \(action)\(at) (\(reason))\(onCommand == nil ? ", but no page is listening" : "")")
        onCommand?(action, positionMs, reason)
    }

    private func awaitConfirmation() {
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, let current = self.snapshot, current.state == .buffering else { return }
            MetrolistLog.warn("The page did not confirm the resume within \(Int(NowPlayingController.playConfirmationTimeout)) s: back to paused")
            self.snapshot = current.with(state: .paused)
            self.publishNowPlaying()
        }
        pendingConfirmation = work
        DispatchQueue.main.asyncAfter(deadline: .now() + NowPlayingController.playConfirmationTimeout, execute: work)
    }

    private func cancelConfirmation() {
        pendingConfirmation?.cancel()
        pendingConfirmation = nil
    }

    private func installRemoteCommands() {
        if !remoteTargets.isEmpty { return }
        let center = MPRemoteCommandCenter.shared()
        addRemote(center.playCommand) { [weak self] _ in
            self?.requestPlay(reason: "session")
            return .success
        }
        addRemote(center.pauseCommand) { [weak self] _ in
            self?.dispatch("pause", nil, "session")
            return .success
        }
        addRemote(center.togglePlayPauseCommand) { [weak self] _ in
            guard let self = self else { return .commandFailed }
            if self.snapshot?.wantsPlayback == true {
                self.dispatch("pause", nil, "session")
            } else {
                self.requestPlay(reason: "session")
            }
            return .success
        }
        addRemote(center.nextTrackCommand) { [weak self] _ in
            self?.dispatch("next", nil, "session")
            return .success
        }
        addRemote(center.previousTrackCommand) { [weak self] _ in
            self?.dispatch("previous", nil, "session")
            return .success
        }
        addRemote(center.changePlaybackPositionCommand) { [weak self] event in
            guard let seek = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.dispatch("seekTo", max(0, seek.positionTime * 1000), "session")
            return .success
        }
        UIApplication.shared.beginReceivingRemoteControlEvents()
        MetrolistLog.info("Lock-screen and headset controls on")
    }

    private func addRemote(_ command: MPRemoteCommand, _ handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
        command.isEnabled = true
        let target = command.addTarget(handler: handler)
        remoteTargets.append((command, target))
    }

    private func removeRemoteCommands() {
        for (command, target) in remoteTargets {
            command.removeTarget(target)
        }
        remoteTargets.removeAll()
    }

    /* ------------------------------------------- app -------------------------------------------- */

    private func observeApp() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.onLifecycle?("pause")
        })
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.enteredBackground()
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.becameActive()
        })
        let session = AVAudioSession.sharedInstance()
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
            self?.audioInterrupted(note)
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
            self?.audioRouteChanged(note)
        })
    }

    private func enteredBackground() {
        MetrolistLog.info("App in the background\(snapshot?.wantsPlayback == true ? ", music wanted" : "")")
        pauseGuard.onBackground(at: NowPlayingController.nowMs())
        onLifecycle?("stop")
    }

    private func becameActive() {
        if pauseGuard.inBackground { MetrolistLog.info("App in the foreground") }
        pauseGuard.onForeground()
        onLifecycle?("resume")
    }

    /// A call, an alarm or another app took the audio: a pause now is the system's but must stand.
    private func audioInterrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began {
            MetrolistLog.info("Audio interrupted (call, alarm or another app): a pause now is not resumed")
            pauseGuard.onUserCommand("pause")
        } else {
            MetrolistLog.info("Audio interruption ended")
        }
    }

    /// Headphones unplugged / Bluetooth audio gone: pause, never blast the speaker.
    private func audioRouteChanged(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
              reason == .oldDeviceUnavailable,
              snapshot?.wantsPlayback == true else { return }
        dispatch("pause", nil, "noisy")
    }

    /* ---------------------------------- audio session and info ---------------------------------- */

    private func activateAudioSession() {
        if audioSessionActive { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
            audioSessionActive = true
            MetrolistLog.info("Audio session active (playback)")
        } catch {
            MetrolistLog.error("Audio session not activated: \(error)")
        }
    }

    private func publishNowPlaying() {
        guard let current = snapshot else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: current.title,
            MPMediaItemPropertyArtist: current.artist,
            MPMediaItemPropertyAlbumTitle: current.album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: current.positionMs / 1000,
            MPNowPlayingInfoPropertyPlaybackRate: current.state == .playing ? 1.0 : 0.0,
        ]
        if current.durationMs > 0 { info[MPMediaItemPropertyPlaybackDuration] = current.durationMs / 1000 }
        if let artwork = artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork(_ url: String) {
        artworkTask?.cancel()
        artworkTask = nil
        artworkUrl = url
        artwork = nil
        guard let target = URL(string: url) else { return }
        let task = URLSession.shared.dataTask(with: target) { [weak self] data, _, _ in
            guard let data = data, data.count <= NowPlayingController.maxArtworkBytes, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self = self, self.artworkUrl == url else { return }
                self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.publishNowPlaying()
            }
        }
        artworkTask = task
        task.resume()
    }
}

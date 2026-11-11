import Capacitor
import Foundation
import WebKit

/// Background play, lock-screen controls and ad blocking for the YouTube IFrame player in
/// Capacitor's WKWebView: the iOS twin of the Android plugin (`android/src/main/java/...`), with the
/// same JavaScript API (`src/index.ts`): `update`, `stop`, `ensureNotificationPermission` (always
/// granted: iOS needs no permission for lock-screen controls), `getDebugLog`; events `command` and
/// `lifecycle`.
///
/// - The audio session, lock screen / Control Center and remote commands: `NowPlayingController`.
/// - The YouTube frames believe the page is still visible: `metrolist-page-visibility.js` (shared with
///   Android), injected at document start into every frame (`forMainFrameOnly: false`); the script
///   only acts in https://www.youtube.com and https://www.youtube-nocookie.com frames.
/// - Ad / tracking requests are blocked by a WebKit content-rule list generated from
///   `src/shared/adBlock.ts` (`metrolist-content-blocker.json`, see `webkitContentBlocker.ts` for the
///   documented differences).
///
/// Playback itself stays in YouTube's official IFrame player. Untested on a device: CI compiles it
/// for the simulator only.
@objc(BackgroundPlaybackPlugin)
public class BackgroundPlaybackPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackgroundPlaybackPlugin"
    public let jsName = "BackgroundPlayback"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ensureNotificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDebugLog", returnType: CAPPluginReturnPromise),
    ]

    private static let resourceBundleName = "MetrolistBackgroundPlayback"
    private static let contentRuleListId = "MetrolistAdBlock"
    private var controller: NowPlayingController?

    override public func load() {
        let controller = NowPlayingController()
        controller.onCommand = { [weak self] action, positionMs, reason in
            var data: [String: Any] = ["action": action, "reason": reason]
            if let positionMs = positionMs { data["positionMs"] = positionMs }
            self?.notifyListeners("command", data: data)
        }
        controller.onLifecycle = { [weak self] state in
            self?.notifyListeners("lifecycle", data: ["state": state])
        }
        self.controller = controller
        installVisibilityOverride()
        installContentBlocker()
        MetrolistLog.info("Background playback plugin loaded (iOS)")
    }

    /* -------------------------------------- page -> native -------------------------------------- */

    @objc func update(_ call: CAPPluginCall) {
        let snapshot = PlaybackSnapshot(
            title: call.getString("title") ?? "",
            artist: call.getString("artist") ?? "",
            album: call.getString("album") ?? "",
            artworkUrl: call.getString("artworkUrl") ?? "",
            durationMs: call.getDouble("durationMs") ?? 0,
            positionMs: call.getDouble("positionMs") ?? 0,
            state: call.getString("state") ?? "paused",
            pausedBy: call.getString("pausedBy")
        )
        DispatchQueue.main.async { [weak self] in
            self?.controller?.update(snapshot)
        }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.controller?.stop()
        }
        call.resolve()
    }

    /// iOS shows lock-screen controls without asking.
    @objc func ensureNotificationPermission(_ call: CAPPluginCall) {
        call.resolve(["granted": true])
    }

    @objc func getDebugLog(_ call: CAPPluginCall) {
        let entries: [[String: Any]] = MetrolistLog.snapshot().map { entry in
            ["at": entry.at, "level": entry.level, "message": entry.message]
        }
        call.resolve(["entries": entries])
    }

    /* ------------------------------------------ setup ------------------------------------------- */

    private func installVisibilityOverride() {
        guard let url = BackgroundPlaybackPlugin.resource("metrolist-page-visibility", "js"),
              let script = try? String(contentsOf: url, encoding: .utf8) else {
            MetrolistLog.error("metrolist-page-visibility.js missing: YouTube may pause in the background")
            return
        }
        guard let contentController = webView?.configuration.userContentController else {
            MetrolistLog.error("No web view: page-visibility override not installed")
            return
        }
        contentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        MetrolistLog.info("Page-visibility override installed for YouTube frames")
    }

    private func installContentBlocker() {
        guard let url = BackgroundPlaybackPlugin.resource("metrolist-content-blocker", "json"),
              let rules = try? String(contentsOf: url, encoding: .utf8) else {
            MetrolistLog.error("metrolist-content-blocker.json missing: ad blocking is off")
            return
        }
        let store: WKContentRuleListStore? = WKContentRuleListStore.default()
        store?.compileContentRuleList(forIdentifier: BackgroundPlaybackPlugin.contentRuleListId, encodedContentRuleList: rules) { [weak self] list, error in
            DispatchQueue.main.async {
                guard let list = list else {
                    MetrolistLog.error("Ad-block rules not compiled; ad blocking is off: \(error.map { String(describing: $0) } ?? "unknown error")")
                    return
                }
                guard let contentController = self?.webView?.configuration.userContentController else { return }
                contentController.add(list)
                MetrolistLog.info("Ad blocking on (WebKit content rules)")
            }
        }
    }

    /// A file of the pod's resource bundle (CocoaPods `resource_bundles`), wherever CocoaPods put it.
    private static func resource(_ name: String, _ ext: String) -> URL? {
        let own = Bundle(for: BackgroundPlaybackPlugin.self)
        var bundles: [Bundle] = []
        for base in [own, Bundle.main] {
            if let bundleUrl = base.url(forResource: resourceBundleName, withExtension: "bundle"), let bundle = Bundle(url: bundleUrl) {
                bundles.append(bundle)
            }
        }
        bundles.append(own)
        bundles.append(Bundle.main)
        for bundle in bundles {
            if let url = bundle.url(forResource: name, withExtension: ext) { return url }
        }
        return nil
    }
}

import Foundation

/// The plugin's diagnostics: the device console (prefix `Metrolist:`), and the last `capacity` lines
/// kept in memory for the app's hidden debug log (`#/debug`, a long press on the version in Library),
/// which reads them with the plugin's `getDebugLog`. Any thread.
enum MetrolistLog {
    struct Entry {
        /// Epoch milliseconds.
        let at: Double
        let level: String
        let message: String
    }

    static let capacity = 100
    private static var recent: [Entry] = []
    private static let lock = NSLock()

    static func info(_ message: String) { write("info", message) }
    static func warn(_ message: String) { write("warn", message) }
    static func error(_ message: String) { write("error", message) }

    /// Oldest first.
    static func snapshot() -> [Entry] {
        lock.lock()
        defer { lock.unlock() }
        return recent
    }

    private static func write(_ level: String, _ message: String) {
        NSLog("Metrolist: %@", message as NSString)
        let entry = Entry(at: Date().timeIntervalSince1970 * 1000, level: level, message: message)
        lock.lock()
        defer { lock.unlock() }
        if recent.count >= capacity { recent.removeFirst(recent.count - capacity + 1) }
        recent.append(entry)
    }
}

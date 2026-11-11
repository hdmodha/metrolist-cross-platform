// Runs the shared vectors of the "system paused us" guard (src/shared/systemPauseGuardVectors.ts,
// written as JSON by `npm run adblock:rules`) against ios/Plugin/SystemPauseGuard.swift, like the
// TypeScript test and the Android JUnit test do. CI (macOS):
//   swiftc ios/Plugin/SystemPauseGuard.swift ios/Tests/main.swift -o guard-vectors
//   ./guard-vectors android/src/test/resources/system-pause-guard-vectors.json
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "android/src/test/resources/system-pause-guard-vectors.json"
guard let data = FileManager.default.contents(atPath: path),
      let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let cases = root["cases"] as? [[String: Any]],
      let windowMs = root["windowMs"] as? Double else {
    fail("Cannot read the vectors at \(path)")
}
if windowMs != SystemPauseGuard.windowMs { fail("windowMs \(windowMs) != SystemPauseGuard.windowMs \(SystemPauseGuard.windowMs)") }
if cases.count < 15 { fail("Expected at least 15 cases, got \(cases.count)") }

var decisions = 0
for vector in cases {
    let name = vector["name"] as? String ?? "?"
    let guardUnderTest = SystemPauseGuard()
    for (index, step) in (vector["steps"] as? [[String: Any]] ?? []).enumerated() {
        guard let event = step["event"] as? [String: Any], let type = event["type"] as? String, let at = event["at"] as? Double else {
            fail("\(name) (step \(index)): malformed step")
        }
        switch type {
        case "background": guardUnderTest.onBackground(at: at)
        case "foreground": guardUnderTest.onForeground()
        case "userCommand": guardUnderTest.onUserCommand(event["action"] as? String ?? "")
        case "update":
            let resume = guardUnderTest.onUpdate(state: event["state"] as? String ?? "", pausedBy: event["pausedBy"] as? String, at: at)
            let expected = step["expect"] as? String ?? "?"
            if (resume ? "resume" : "none") != expected { fail("\(name) (step \(index)): expected \(expected)") }
            decisions += 1
        default: fail("\(name) (step \(index)): unknown event \(type)")
        }
    }
}
print("SystemPauseGuard (Swift): \(cases.count) shared vector cases, \(decisions) decisions, all as expected")

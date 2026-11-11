// Compiles the generated content-blocker list (ios/Resources/metrolist-content-blocker.json) with
// WebKit's own compiler (WKContentRuleListStore, macOS: the same parser as iOS), so a filter WebKit
// cannot read fails CI instead of silently turning ad blocking off in the app. CI (macOS):
//   swift ios/Tests/compile-content-blocker.swift ios/Resources/metrolist-content-blocker.json
import Foundation
import WebKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ios/Resources/metrolist-content-blocker.json"
guard let rules = try? String(contentsOfFile: path, encoding: .utf8) else { fail("Cannot read \(path)") }
let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("metrolist-content-rules-\(getpid())")
try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
let store: WKContentRuleListStore? = WKContentRuleListStore(url: directory)
guard let ruleStore = store else { fail("No WKContentRuleListStore") }

var finished = false
ruleStore.compileContentRuleList(forIdentifier: "MetrolistAdBlock", encodedContentRuleList: rules) { list, error in
    if let error = error { fail("WebKit rejected \(path): \(error)") }
    if list == nil { fail("WebKit returned no rule list for \(path)") }
    print("WebKit compiled \(path)")
    finished = true
}
let deadline = Date().addingTimeInterval(60)
while !finished && Date() < deadline {
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
}
if !finished { fail("WebKit did not finish compiling \(path) within 60 s") }

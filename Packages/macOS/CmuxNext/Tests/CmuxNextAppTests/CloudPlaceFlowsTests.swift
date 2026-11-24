import Foundation
@testable import CmuxNextCloudPlace
import Testing

/// The move's flow reports each step to Rust's reducer in order, and Cancel stops the move's Task only when the reducer says stop.
@MainActor struct CloudPlaceFlowsTests {
    /// A fake reducer: records each event's name, answers `stop` for a cancel when told to.
    nonisolated final class Recorder: @unchecked Sendable {
        private let lock = NSLock()
        private var names: [String] = []
        var stopOnCancel = true
        var events: [String] { lock.withLock { names } }

        func core(_ operation: String, _ request: Data) -> Data? {
            guard let object = try? JSONSerialization.jsonObject(with: request) as? [String: Any] else { return nil }
            if operation == "cloud_move_place_view" { return Data(#"{"state":"moving"}"#.utf8) }
            let event = (object["event"] as? [String: Any])?["event"] as? String ?? ""
            lock.withLock { names.append(event) }
            let next = event == "cancel" && stopOnCancel ? "stop" : "go"
            return Data(#"{"flow":{"n":1},"next":"\#(next)"}"#.utf8)
        }
    }

    private func flows(_ recorder: Recorder) -> CloudPlaceFlows {
        let defaults = UserDefaults(suiteName: "CloudPlaceFlowsTests.\(UUID().uuidString)")!
        return CloudPlaceFlows(defaults: defaults, core: { recorder.core($0, $1) }, clock: { 1 })
    }

    @Test func reportsEveryStepInOrder() throws {
        let recorder = Recorder()
        let place = flows(recorder)
        place.begin(session: "s", toCloud: true, trigger: .person, from: "Mac", to: "", cargo: .init())
        try place.advance("s", "machine")
        place.target("s", to: "vm")
        try place.advance("s", "sync")
        try place.advance("s", "freeze")
        place.step("s", "commit")
        place.step("s", "attach")
        place.step("s", "release")
        place.live("s")
        #expect(recorder.events == ["begin", "step", "target", "step", "step", "step", "step", "step", "live"])
        #expect(place.state(of: "s") == "moving")
        #expect(place.placeJSON(session: "s", onCloud: true, cloudName: "vm") != nil)
    }

    @Test func cancelStopsTheTaskOnlyOnStop() throws {
        let recorder = Recorder()
        let place = flows(recorder)
        var stopped = 0
        place.begin(session: "s", toCloud: true, trigger: .evacuate, from: "Mac", to: "", cargo: .init())
        place.onCancel("s") { stopped += 1 }
        #expect(place.cancel("s") == .stop)
        #expect(stopped == 1)
        #expect(place.wasCancelled("s"))
        recorder.stopOnCancel = false
        place.begin(session: "t", toCloud: true, trigger: .person, from: "Mac", to: "", cargo: .init())
        place.onCancel("t") { stopped += 1 }
        #expect(place.cancel("t") == .go)
        #expect(stopped == 1)
    }

    @Test func modesPersist() {
        let defaults = UserDefaults(suiteName: "CloudPlaceFlowsTests.\(UUID().uuidString)")!
        let first = CloudPlaceFlows(defaults: defaults)
        first.setMode("auto", of: "s")
        #expect(CloudPlaceFlows(defaults: defaults).mode(of: "s") == "auto")
    }

    @Test func dirtyCountSkipsARenamesSourcePath() {
        let out = Data(" M a.txt\0R  new.txt\0old.txt\0?? b.txt\0".utf8)
        #expect(CloudPlaceFlows.dirtyCount(porcelainZ: out) == 3)
        #expect(CloudPlaceFlows.dirtyCount(porcelainZ: Data()) == 0)
    }

    @Test func evacuationShowsEachChatsStateAndCancelDropsTheQueue() throws {
        let place = flows(Recorder())
        place.beginEvacuation(direction: "toCloud", chats: [("a", "A"), ("b", "B"), ("c", "C")])
        place.evacuationPhase("a", .running)
        place.evacuationPhase("b", .running)
        place.evacuationPhase("b", .ended) // no flow was kept: read as failed, never as landed
        #expect(place.stopEvacuation() == ["a"])
        #expect(place.evacuationStopped)
        let object = try #require(place.evacuateJSON(canBringBack: 2).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        let states = (object["chats"] as? [[String: Any]])?.map { $0["state"] as? String }
        #expect(states == ["moving", "failed", "cancelled"])
        #expect(object["direction"] as? String == "toCloud" && object["canBringBack"] as? Int == 2 && object["elapsedMs"] != nil)
        place.evacuationPhase("a", .ended)
        #expect(place.evacuation?.endedMs != nil)
    }

    @Test func idleEvacuateCarriesOnlyTheBringBackCount() throws {
        let place = flows(Recorder())
        #expect(place.evacuateJSON(canBringBack: 0) == nil)
        let object = try #require(place.evacuateJSON(canBringBack: 3).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        #expect(Set(object.keys) == ["canBringBack"])
    }

    /// A hybrid start's state rides on `place.start` as Rust answers it, read once per drivers' folder change (RFD 0078).
    @Test func placeCarriesTheHybridStart() throws {
        let defaults = UserDefaults(suiteName: "CloudPlaceFlowsTests.\(UUID().uuidString)")!
        let calls = Calls()
        let place = CloudPlaceFlows(defaults: defaults, core: { operation, request in
            guard operation == "cloud_hybrid_start" else { return nil }
            calls.add()
            let ask = try? JSONSerialization.jsonObject(with: request) as? [String: Any]
            return ask?["session"] as? String == "s" ? Data(#"{"start":{"cloud":"booting","sinceMs":5}}"#.utf8) : Data("{}".utf8)
        }, clock: { 1 })
        #expect(place.placeJSON(session: "s", onCloud: false, cloudName: nil).flatMap(Self.start) == nil) // no state folder: no read
        #expect(calls.count == 0)
        let sessions = FileManager.default.temporaryDirectory.appending(path: "hybrid-\(UUID().uuidString)/sessions")
        defer { place.watchStarts(state: nil) }
        let start = try #require(place.placeJSON(session: "s", onCloud: false, cloudName: nil, starts: sessions).flatMap(Self.start))
        #expect(start["cloud"] as? String == "booting")
        #expect(start["sinceMs"] as? Int == 5)
        _ = place.placeJSON(session: "s", onCloud: false, cloudName: nil)
        #expect(calls.count == 1) // the same revision reads once
        #expect(place.placeJSON(session: "t", onCloud: false, cloudName: nil).flatMap(Self.start) == nil) // no hybrid start: no key
    }

    nonisolated final class Calls: @unchecked Sendable {
        private let lock = NSLock()
        private var n = 0
        var count: Int { lock.withLock { n } }
        func add() { lock.withLock { n += 1 } }
    }

    private static func start(_ data: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["start"] as? [String: Any]
    }
}

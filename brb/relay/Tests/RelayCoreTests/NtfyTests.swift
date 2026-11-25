import XCTest
import Foundation
import SharedKit
@testable import RelayCore

final class NtfyTests: XCTestCase {
    private actor Recorder {
        var requests: [APNsPreparedRequest] = []
        func add(_ request: APNsPreparedRequest) { requests.append(request) }
        func all() -> [APNsPreparedRequest] { requests }
    }

    private final class LogBox: @unchecked Sendable {
        private let lock = NSLock()
        private var items: [String] = []
        func add(_ line: String) { lock.lock(); items.append(line); lock.unlock() }
        func all() -> [String] { lock.lock(); defer { lock.unlock() }; return items }
    }

    private struct FakeTransport: APNsTransport {
        let recorder: Recorder
        var status = 200
        var fails = false
        func send(_ request: APNsPreparedRequest) async throws -> APNsHTTPResponse {
            await recorder.add(request)
            if fails { throw URLError(.notConnectedToInternet) }
            return APNsHTTPResponse(status: status, headers: [:], body: nil)
        }
    }

    private func notification(title: String = "Codex needs input", body: String = "secret terminal text") -> NotificationRecord {
        NotificationRecord(id: "n1", workspaceId: "w1", surfaceId: "s1", title: title,
                           subtitle: nil, body: body, ts: 1, threadId: "t")
    }

    private func decode(_ request: APNsPreparedRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: request.body) as? [String: Any])
    }

    private func event(_ name: String = "notification.created") -> EventFrame {
        EventFrame(category: .notification, name: name, payload: .object([
            "id": .string("n1"), "workspace_id": .string("w1"), "surface_id": .string("s1"),
            "title": .string("Codex needs input"), "body": .string("secret terminal text"),
        ]))
    }

    func testTopicIsLongRandomAndDifferentEachTime() {
        let first = NtfySettingsStore.randomTopic()
        let second = NtfySettingsStore.randomTopic()
        XCTAssertNotEqual(first, second)
        XCTAssertTrue(first.hasPrefix("brb-"))
        XCTAssertEqual(first.count, 4 + 26)
    }

    func testDefaultMessageHidesTerminalText() throws {
        let settings = NtfySettings(topic: "brb-abc")
        let request = try XCTUnwrap(NtfyRequestBuilder.request(settings: settings, notification: notification()))
        let json = try decode(request)
        XCTAssertEqual(json["topic"] as? String, "brb-abc")
        XCTAssertEqual(json["title"] as? String, "BRB")
        XCTAssertEqual(json["message"] as? String, "An agent needs your attention.")
        let raw = String(decoding: request.body, as: UTF8.self)
        XCTAssertFalse(raw.contains("secret terminal text"))
        XCTAssertFalse(raw.contains("Codex"))
    }

    func testIncludeTextSendsTrimmedRealText() throws {
        var settings = NtfySettings(topic: "t")
        settings.includeText = true
        let long = String(repeating: "x", count: 1000)
        let request = try XCTUnwrap(NtfyRequestBuilder.request(settings: settings, notification: notification(title: "Hi ✅", body: long)))
        let json = try decode(request)
        XCTAssertEqual(json["title"] as? String, "Hi ✅")
        XCTAssertEqual((json["message"] as? String)?.count, 300)
    }

    func testRequestGoesToTheServerRootAsJson() throws {
        let settings = NtfySettings(server: "https://ntfy.example.com", topic: "t", token: "tk_123")
        let request = try XCTUnwrap(NtfyRequestBuilder.request(settings: settings, notification: notification()))
        XCTAssertEqual(request.url.absoluteString, "https://ntfy.example.com")
        XCTAssertEqual(request.headers["Content-Type"], "application/json")
        XCTAssertEqual(request.headers["Authorization"], "Bearer tk_123")
        let noToken = try XCTUnwrap(NtfyRequestBuilder.request(settings: NtfySettings(topic: "t"), notification: notification()))
        XCTAssertNil(noToken.headers["Authorization"])
    }

    func testBadServerAddressBuildsNothing() {
        XCTAssertNil(NtfyRequestBuilder.request(settings: NtfySettings(server: "not a url", topic: "t"), notification: notification()))
        XCTAssertNil(NtfyRequestBuilder.request(settings: NtfySettings(server: "ftp://x", topic: "t"), notification: notification()))
    }

    func testSubscribeURLHasNoDoubleSlash() {
        XCTAssertEqual(NtfySettings(server: "https://ntfy.sh/", topic: "abc").subscribeURL, "https://ntfy.sh/abc")
    }

    func testStoreCreatesOnceKeepsTopicAndIsOwnerOnly() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ntfy-\(UUID())", isDirectory: true).appendingPathComponent("ntfy.json")
        let store = NtfySettingsStore(url: url)
        XCTAssertNil(store.load())
        let first = try store.ensure()
        let second = try store.ensure()
        XCTAssertEqual(first.topic, second.topic)
        XCTAssertFalse(first.includeText)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        var changed = first
        changed.enabled = false
        try store.save(changed)
        XCTAssertEqual(store.load()?.enabled, false)
        XCTAssertEqual(store.load()?.topic, first.topic)
    }

    func testFanoutPublishesInboxNotificationsOnly() async {
        let recorder = Recorder()
        let fanout = NtfyFanout(settings: { NtfySettings(topic: "t") }, transport: FakeTransport(recorder: recorder))
        await fanout.deliver(event: event())
        await fanout.deliver(event: event("notification.read"))
        await fanout.deliver(event: EventFrame(category: .workspace, name: "workspace.updated", payload: .object([:])))
        let sent = await recorder.all()
        XCTAssertEqual(sent.count, 1)
    }

    func testFanoutDoesNothingWhenOffOrNotSetUp() async {
        let recorder = Recorder()
        let off = NtfyFanout(settings: { NtfySettings(enabled: false, topic: "t") }, transport: FakeTransport(recorder: recorder))
        await off.deliver(event: event())
        let none = NtfyFanout(settings: { nil }, transport: FakeTransport(recorder: recorder))
        await none.deliver(event: event())
        let sent = await recorder.all()
        XCTAssertTrue(sent.isEmpty)
    }

    func testFanoutSurvivesNetworkFailureAndServerErrors() async {
        let recorder = Recorder()
        let lines = LogBox()
        let down = NtfyFanout(
            settings: { NtfySettings(topic: "t") },
            transport: FakeTransport(recorder: recorder, fails: true),
            log: { lines.add($0) }
        )
        await down.deliver(event: event())
        let rejected = NtfyFanout(
            settings: { NtfySettings(topic: "t") },
            transport: FakeTransport(recorder: recorder, status: 429),
            log: { lines.add($0) }
        )
        await rejected.deliver(event: event())
        XCTAssertEqual(lines.all().count, 2)
        XCTAssertFalse(lines.all().contains { $0.contains("secret") })
    }

    func testSendTestReturnsStatus() async {
        let recorder = Recorder()
        let status = await NtfyFanout.sendTest(settings: NtfySettings(topic: "t"), transport: FakeTransport(recorder: recorder, status: 200))
        XCTAssertEqual(status, 200)
        let unreachable = await NtfyFanout.sendTest(settings: NtfySettings(topic: "t"), transport: FakeTransport(recorder: recorder, fails: true))
        XCTAssertNil(unreachable)
    }
}

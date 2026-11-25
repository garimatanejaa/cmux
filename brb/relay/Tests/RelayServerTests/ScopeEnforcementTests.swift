import XCTest
import Foundation
@testable import RelayServer
@testable import RelayCore

final class ScopeEnforcementTests: XCTestCase {
    private let hello = #"{"deviceId":"d","appVersion":"1","protocolVersion":1}"#

    private final class ScopeBox: @unchecked Sendable {
        private let lock = NSLock()
        private var value: DeviceScope?
        init(_ value: DeviceScope?) { self.value = value }
        func get() -> DeviceScope? { lock.lock(); defer { lock.unlock() }; return value }
        func set(_ v: DeviceScope?) { lock.lock(); value = v; lock.unlock() }
    }

    private func tempAudit() -> (AuditLog, URL) {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("scope-audit-\(UUID())", isDirectory: true)
            .appendingPathComponent("audit.log")
        return (AuditLog(url: url, maxBytes: 1_000_000, keepFiles: 2, clock: FakeClock()), url)
    }

    private func machine(scope: ScopeBox, audit: AuditLog?, cmux: CMUXFacade) -> WSProtocolMachine {
        WSProtocolMachine(
            cmux: cmux,
            scopeEnforcer: ScopeEnforcer(deviceId: "device-1234567890", scopeFor: { scope.get() }, audit: audit)
        )
    }

    func testReadDeviceCannotSendInputAndNothingReachesCmux() async {
        let cmux = RecordingCMUXFacade()
        let (audit, url) = tempAudit()
        let m = machine(scope: ScopeBox(.read), audit: audit, cmux: cmux)
        _ = await m.processText(hello)

        let actions = await m.processText(#"{"id":"1","method":"surface.send_text","params":{"workspace_id":"w","surface_id":"s","text":"rm -rf /"}}"#)

        let calls = await cmux.snapshot()
        XCTAssertEqual(calls.count, 0)
        guard case .sendText(let reply) = actions.first else { return XCTFail("expected an error reply") }
        XCTAssertTrue(reply.contains("forbidden"), reply)
        let log = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        XCTAssertTrue(log.contains("denied"))
        XCTAssertFalse(log.contains("rm -rf"), "terminal text must never reach the audit log")
    }

    func testReadDeviceCanStillListWorkspaces() async {
        let cmux = RecordingCMUXFacade()
        let m = machine(scope: ScopeBox(.read), audit: nil, cmux: cmux)
        _ = await m.processText(hello)
        _ = await m.processText(#"{"id":"1","method":"workspace.list","params":{}}"#)
        let calls = await cmux.snapshot()
        XCTAssertEqual(calls.map(\.method), ["workspace.list"])
    }

    func testUnknownMethodIsDeniedForReadDevices() async {
        let cmux = RecordingCMUXFacade()
        let m = machine(scope: ScopeBox(.read), audit: nil, cmux: cmux)
        _ = await m.processText(hello)
        _ = await m.processText(#"{"id":"1","method":"workspace.close","params":{"workspace_id":"w"}}"#)
        let calls = await cmux.snapshot()
        XCTAssertEqual(calls.count, 0)
    }

    func testControlDeviceCanSendInputAndItIsAuditedWithoutText() async {
        let cmux = RecordingCMUXFacade()
        let (audit, url) = tempAudit()
        let m = machine(scope: ScopeBox(.control), audit: audit, cmux: cmux)
        _ = await m.processText(hello)
        _ = await m.processText(#"{"id":"1","method":"surface.send_text","params":{"workspace_id":"w1","surface_id":"s1","text":"secret-input"}}"#)
        let calls = await cmux.snapshot()
        XCTAssertEqual(calls.map(\.method), ["surface.send_text"])
        let log = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        XCTAssertTrue(log.contains("surface.send_text"))
        XCTAssertTrue(log.contains("w1"))
        XCTAssertFalse(log.contains("secret-input"))
    }

    func testRelayUpdateIsRefusedEvenForControl() async {
        let cmux = RecordingCMUXFacade()
        let m = machine(scope: ScopeBox(.control), audit: nil, cmux: cmux)
        _ = await m.processText(hello)
        let actions = await m.processText(#"{"id":"1","method":"relay.update.start","params":{}}"#)
        guard case .sendText(let reply) = actions.first else { return XCTFail("expected an error reply") }
        XCTAssertTrue(reply.contains("forbidden"), reply)
    }

    func testRevokedDeviceIsDisconnectedOnItsNextRequest() async {
        let cmux = RecordingCMUXFacade()
        let box = ScopeBox(.control)
        let m = machine(scope: box, audit: nil, cmux: cmux)
        _ = await m.processText(hello)
        box.set(nil)
        let actions = await m.processText(#"{"id":"1","method":"workspace.list","params":{}}"#)
        XCTAssertEqual(actions, [.close])
        let calls = await cmux.snapshot()
        XCTAssertEqual(calls.count, 0)
    }

    func testScopeChangeTakesEffectOnTheOpenConnection() async {
        let cmux = RecordingCMUXFacade()
        let box = ScopeBox(.control)
        let m = machine(scope: box, audit: nil, cmux: cmux)
        _ = await m.processText(hello)
        box.set(.read)
        _ = await m.processText(#"{"id":"1","method":"surface.send_key","params":{"workspace_id":"w","surface_id":"s","key":"enter"}}"#)
        let calls = await cmux.snapshot()
        XCTAssertEqual(calls.count, 0)
    }
}

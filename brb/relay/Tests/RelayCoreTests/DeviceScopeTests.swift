import XCTest
@testable import RelayCore

final class DeviceScopeTests: XCTestCase {
    private func tempURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID()).json")
    }

    func testReadScopeOnlyAllowsTheReadList() {
        XCTAssertTrue(MethodPolicy.isAllowed(method: "workspace.list", scope: .read))
        XCTAssertTrue(MethodPolicy.isAllowed(method: "surface.subscribe", scope: .read))
        XCTAssertFalse(MethodPolicy.isAllowed(method: "surface.send_text", scope: .read))
        XCTAssertFalse(MethodPolicy.isAllowed(method: "surface.send_key", scope: .read))
        XCTAssertFalse(MethodPolicy.isAllowed(method: "feed.reply", scope: .read))
        XCTAssertFalse(MethodPolicy.isAllowed(method: "terminal.artifact.fetch", scope: .read))
        XCTAssertFalse(MethodPolicy.isAllowed(method: "workspace.close", scope: .read), "unknown methods are denied")
    }

    func testControlScopeAllowsInputButNeverUpdate() {
        XCTAssertTrue(MethodPolicy.isAllowed(method: "surface.send_text", scope: .control))
        XCTAssertTrue(MethodPolicy.isAllowed(method: "feed.reply", scope: .control))
        XCTAssertFalse(MethodPolicy.isAllowed(method: "relay.update.start", scope: .control))
        XCTAssertFalse(MethodPolicy.isAllowed(method: "relay.update.start", scope: .read))
    }

    func testAuditedMethodsAreTheNonReadOnes() {
        XCTAssertTrue(MethodPolicy.isControlAction(method: "surface.send_text"))
        XCTAssertFalse(MethodPolicy.isControlAction(method: "workspace.list"))
    }

    func testNewDevicesAreReadOnlyByDefaultAndScopePersists() throws {
        let url = tempURL()
        let store = try DeviceStore(url: url)
        _ = try store.register(deviceId: "d1", loginName: "a", hostname: "h", apnsToken: nil)
        XCTAssertEqual(store.scope(of: "d1"), .read)
        try store.setScope(deviceId: "d1", scope: .control)
        XCTAssertEqual(try DeviceStore(url: url).scope(of: "d1"), .control)
    }

    func testRegisterCanGrantControlDirectly() throws {
        let store = try DeviceStore(url: tempURL())
        _ = try store.register(deviceId: "d1", loginName: "a", hostname: "h", apnsToken: nil, scope: .control)
        XCTAssertEqual(store.scope(of: "d1"), .control)
    }

    func testRecordWithoutScopeCountsAsReadOnly() throws {
        let url = tempURL()
        let legacy = #"{"d":{"device_id":"d","login_name":"a","hostname":"h","registered_at":1,"token_hash":"x"}}"#
        try Data(legacy.utf8).write(to: url)
        XCTAssertEqual(try DeviceStore(url: url).scope(of: "d"), .read)
    }

    func testSetScopeOnUnknownDeviceThrows() throws {
        let store = try DeviceStore(url: tempURL())
        XCTAssertThrowsError(try store.setScope(deviceId: "nope", scope: .control))
    }

    func testRevokeAllRemovesEveryDevice() throws {
        let url = tempURL()
        let store = try DeviceStore(url: url)
        _ = try store.register(deviceId: "d1", loginName: "a", hostname: "h", apnsToken: nil)
        _ = try store.register(deviceId: "d2", loginName: "a", hostname: "h2", apnsToken: nil)
        XCTAssertEqual(try store.revokeAll(), 2)
        XCTAssertTrue(try DeviceStore(url: url).allDevices().isEmpty)
        XCTAssertNil(store.scope(of: "d1"))
    }

    func testResolveFindsByUniquePrefix() throws {
        let store = try DeviceStore(url: tempURL())
        _ = try store.register(deviceId: "abc123", loginName: "a", hostname: "h", apnsToken: nil)
        _ = try store.register(deviceId: "abd999", loginName: "a", hostname: "h2", apnsToken: nil)
        XCTAssertEqual(store.resolve(idOrPrefix: "abc")?.deviceId, "abc123")
        XCTAssertNil(store.resolve(idOrPrefix: "ab"), "an ambiguous prefix matches nothing")
        XCTAssertEqual(store.resolve(idOrPrefix: "abd999")?.deviceId, "abd999")
    }

    func testConfigDefaultsAndLifetimeClamp() throws {
        let defaults = RelayConfig.defaults
        XCTAssertEqual(defaults.listen, "tailscale:4399")
        XCTAssertFalse(defaults.allowAllInterfaces)
        XCTAssertEqual(defaults.pairingCodeLifetimeSeconds, 3600)
        var config = defaults
        config.pairingCodeLifetimeMinutes = 1
        XCTAssertEqual(config.pairingCodeLifetimeSeconds, 300)
        config.pairingCodeLifetimeMinutes = 100_000
        XCTAssertEqual(config.pairingCodeLifetimeSeconds, 86_400)
        let decoded = try RelayConfig.decode(
            jsonString: #"{"allow_all_interfaces":true,"pairing_code_lifetime_minutes":15}"#
        )
        XCTAssertTrue(decoded.allowAllInterfaces)
        XCTAssertEqual(decoded.pairingCodeLifetimeSeconds, 900)
    }
}

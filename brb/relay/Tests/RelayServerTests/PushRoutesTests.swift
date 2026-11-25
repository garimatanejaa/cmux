import XCTest
import Foundation
@testable import RelayServer
@testable import RelayCore

final class PushRoutesTests: XCTestCase {
    private func routes(_ store: DeviceStore, ntfy: NtfySettings?) -> Routes {
        Routes(
            deviceStore: store,
            config: .testValue,
            auth: MockAuthService(peers: [:]),
            allowLocalhost: false,
            ntfySettings: { ntfy }
        )
    }

    private func json(_ response: HTTPResponseLite) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: response.body ?? Data()) as? [String: Any])
    }

    func testDeviceStatusReportsTheAccessLevel() async throws {
        let store = try DeviceStore.empty()
        _ = try store.register(deviceId: "r", loginName: "a", hostname: "h", apnsToken: nil)
        _ = try store.register(deviceId: "c", loginName: "a", hostname: "h2", apnsToken: nil, scope: .control)
        let r = routes(store, ntfy: nil)
        let read = await r.handle(method: .GET, path: "/v1/devices/me", body: nil, deviceId: "r", remoteAddr: "100.64.0.5:1")
        let control = await r.handle(method: .GET, path: "/v1/devices/me", body: nil, deviceId: "c", remoteAddr: "100.64.0.5:1")
        XCTAssertEqual(try json(read)["scope"] as? String, "read")
        XCTAssertEqual(try json(read)["device_id"] as? String, "r")
        XCTAssertEqual(try json(control)["scope"] as? String, "control")
    }

    func testPushInfoNeedsAPairedDevice() async throws {
        let store = try DeviceStore.empty()
        let r = routes(store, ntfy: NtfySettings(topic: "brb-x"))
        let anonymous = await r.handle(method: .GET, path: "/v1/push", body: nil, deviceId: nil, remoteAddr: "100.64.0.5:1")
        XCTAssertEqual(anonymous.status, .unauthorized)
        let unknown = await r.handle(method: .GET, path: "/v1/push", body: nil, deviceId: "ghost", remoteAddr: "100.64.0.5:1")
        XCTAssertEqual(unknown.status, .unauthorized)
    }

    func testPushInfoGivesTheSubscribeAddressWhenOn() async throws {
        let store = try DeviceStore.empty()
        _ = try store.register(deviceId: "d", loginName: "a", hostname: "h", apnsToken: nil)
        let on = routes(store, ntfy: NtfySettings(server: "https://ntfy.sh", topic: "brb-x"))
        let response = await on.handle(method: .GET, path: "/v1/push", body: nil, deviceId: "d", remoteAddr: "100.64.0.5:1")
        XCTAssertEqual(response.status, .ok)
        let body = try json(response)
        XCTAssertEqual(body["enabled"] as? Bool, true)
        XCTAssertEqual(body["subscribe_url"] as? String, "https://ntfy.sh/brb-x")
        XCTAssertEqual(body["include_text"] as? Bool, false)
    }

    func testPushInfoHidesTheTopicWhenOffOrNotSetUp() async throws {
        let store = try DeviceStore.empty()
        _ = try store.register(deviceId: "d", loginName: "a", hostname: "h", apnsToken: nil)
        for settings in [NtfySettings(enabled: false, topic: "brb-x"), nil] {
            let response = await routes(store, ntfy: settings)
                .handle(method: .GET, path: "/v1/push", body: nil, deviceId: "d", remoteAddr: "100.64.0.5:1")
            let body = try json(response)
            XCTAssertEqual(body["enabled"] as? Bool, false)
            XCTAssertNil(body["subscribe_url"])
            XCTAssertFalse(String(decoding: response.body ?? Data(), as: UTF8.self).contains("brb-x"))
        }
    }
}

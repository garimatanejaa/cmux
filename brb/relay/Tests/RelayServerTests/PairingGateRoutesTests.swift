import XCTest
import Foundation
@testable import RelayServer
@testable import RelayCore

final class PairingGateRoutesTests: XCTestCase {
    private struct Registered: Decodable {
        let deviceId: String
        let token: String
        enum CodingKeys: String, CodingKey { case deviceId = "device_id", token }
    }

    private struct Fixture {
        let routes: Routes
        let store: DeviceStore
        let codes: PairingCodeStore
        let clock: FakeClock
    }

    private func fixture() throws -> Fixture {
        let clock = FakeClock()
        let store = try DeviceStore.empty()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("gate-\(UUID())", isDirectory: true)
        let codes = PairingCodeStore(url: dir.appendingPathComponent("pairing.json"), clock: clock)
        let limiter = AttemptLimiter(
            policy: .init(maxFailures: 3, window: 600, baseLockout: 60, maxLockout: 600), clock: clock
        )
        var config = RelayConfig.testValue
        config.allowLogin = ["a@b"]
        let routes = Routes(
            deviceStore: store,
            config: config,
            auth: MockAuthService(peers: [
                "100.64.0.5": .init(loginName: "a@b", hostname: "iPhone", os: "ios", nodeKey: "nk1")
            ]),
            allowLocalhost: false,
            clock: clock,
            pairing: PairingGate(codes: codes, addressLimiter: limiter)
        )
        return Fixture(routes: routes, store: store, codes: codes, clock: clock)
    }

    private func register(_ f: Fixture, code: String?) async -> HTTPResponseLite {
        let body = code.map { Data(#"{"code":"\#($0)"}"#.utf8) }
        return await f.routes.handle(method: .POST, path: "/v1/devices/me/register",
                                     body: body, deviceId: nil, remoteAddr: "100.64.0.5:1")
    }

    func testRegistrationWithoutACodeIsRefused() async throws {
        let f = try fixture()
        _ = try f.codes.issue(lifetimeSeconds: 3600)
        let response = await register(f, code: nil)
        XCTAssertEqual(response.status, .forbidden)
        XCTAssertTrue(try f.store.allDevices().isEmpty)
    }

    func testRegistrationWithNoActiveCodeIsRefused() async throws {
        let f = try fixture()
        let response = await register(f, code: "AAAA-AAAA-AAAA-AAAA")
        XCTAssertEqual(response.status, .forbidden)
    }

    func testGoodCodeRegistersAReadOnlyDeviceAndIsSingleUse() async throws {
        let f = try fixture()
        let issued = try f.codes.issue(lifetimeSeconds: 3600)
        let first = await register(f, code: issued.code)
        XCTAssertEqual(first.status, .ok)
        let registered = try JSONDecoder().decode(Registered.self, from: first.body ?? Data())
        XCTAssertEqual(f.store.scope(of: registered.deviceId), .read)
        let second = await register(f, code: issued.code)
        XCTAssertEqual(second.status, .forbidden, "a used code must not work twice")
    }

    func testControlCodeGrantsControl() async throws {
        let f = try fixture()
        let issued = try f.codes.issue(lifetimeSeconds: 3600, grants: .control)
        let response = await register(f, code: issued.code)
        let registered = try JSONDecoder().decode(Registered.self, from: response.body ?? Data())
        XCTAssertEqual(f.store.scope(of: registered.deviceId), .control)
    }

    func testExpiredCodeIsRefused() async throws {
        let f = try fixture()
        let issued = try f.codes.issue(lifetimeSeconds: 600)
        f.clock.advance(by: 601)
        let response = await register(f, code: issued.code)
        XCTAssertEqual(response.status, .forbidden)
    }

    func testRepeatedWrongCodesLockTheAddressOut() async throws {
        let f = try fixture()
        let issued = try f.codes.issue(lifetimeSeconds: 3600)
        for _ in 0..<3 { _ = await register(f, code: "AAAA-AAAA-AAAA-AAAA") }
        let locked = await register(f, code: issued.code)
        XCTAssertEqual(locked.status, .tooManyRequests)
        XCTAssertNotNil(locked.headers.first { $0.0.lowercased() == "retry-after" })
        XCTAssertTrue(try f.store.allDevices().isEmpty, "the right code must not work while locked out")
        f.clock.advance(by: 61)
        let after = await register(f, code: issued.code)
        XCTAssertEqual(after.status, .ok)
    }
}

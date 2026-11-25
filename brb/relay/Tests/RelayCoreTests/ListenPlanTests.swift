import XCTest
@testable import RelayCore

final class ListenPlanTests: XCTestCase {
    func testDefaultListensOnTheTailscaleAddress() {
        let plan = ListenPlan.plan(listen: "tailscale:4399", allowAllInterfaces: false, tailscaleIPv4: { "100.101.102.103" })
        XCTAssertEqual(plan, .bind(host: "100.101.102.103", port: 4399))
    }

    func testEmptyHostMeansTailscaleToo() {
        let plan = ListenPlan.plan(listen: ":5000", allowAllInterfaces: false, tailscaleIPv4: { "100.1.2.3" })
        XCTAssertEqual(plan, .bind(host: "100.1.2.3", port: 5000))
    }

    func testNoListenerWhileTailscaleIsDown() {
        let plan = ListenPlan.plan(listen: "tailscale:4399", allowAllInterfaces: false, tailscaleIPv4: { nil })
        XCTAssertEqual(plan, .waitForTailscale(port: 4399))
    }

    func testAllInterfacesAreRefusedWithoutTheFlag() {
        for listen in ["0.0.0.0:4399", "::", "[::]:4399", "*:4399"] {
            let plan = ListenPlan.plan(listen: listen, allowAllInterfaces: false, tailscaleIPv4: { "100.1.2.3" })
            guard case .refused(let reason) = plan else { return XCTFail("\(listen) should be refused, got \(plan)") }
            XCTAssertTrue(reason.contains("allow_all_interfaces"))
        }
    }

    func testAllInterfacesAreAllowedWithTheFlag() {
        let plan = ListenPlan.plan(listen: "0.0.0.0:4399", allowAllInterfaces: true, tailscaleIPv4: { nil })
        XCTAssertEqual(plan, .bind(host: "0.0.0.0", port: 4399))
    }

    func testExplicitAddressIsUsedAsGiven() {
        let plan = ListenPlan.plan(listen: "127.0.0.1:4400", allowAllInterfaces: false, tailscaleIPv4: { "100.1.2.3" })
        XCTAssertEqual(plan, .bind(host: "127.0.0.1", port: 4400))
    }

    func testPortFallsBackWhenMissingOrInvalid() {
        XCTAssertEqual(ListenPlan.parse("tailscale").port, 4399)
        XCTAssertEqual(ListenPlan.parse("tailscale:abc").port, 4399)
        XCTAssertEqual(ListenPlan.parse("tailscale:99999").port, 4399)
        XCTAssertEqual(ListenPlan.parse("tailscale:8080").port, 8080)
    }

    func testBareIPv6IsNotSplitAtItsLastColon() {
        XCTAssertEqual(ListenPlan.parse("::").host, "::")
        XCTAssertEqual(ListenPlan.parse("::").port, 4399)
        XCTAssertEqual(ListenPlan.parse("[::1]:5000").host, "[::1]")
        XCTAssertEqual(ListenPlan.parse("[::1]:5000").port, 5000)
    }

    func testIPv4Check() {
        XCTAssertTrue(ListenPlan.isIPv4("100.64.0.1"))
        XCTAssertFalse(ListenPlan.isIPv4("100.64.0"))
        XCTAssertFalse(ListenPlan.isIPv4("100.64.0.256"))
        XCTAssertFalse(ListenPlan.isIPv4("fd7a:115c::1"))
        XCTAssertFalse(ListenPlan.isIPv4("100.064.0.1"))
    }
}

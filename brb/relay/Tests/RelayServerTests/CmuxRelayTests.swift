import XCTest
import ArgumentParser
import SharedKit
@testable import RelayServer

/// Argument-parsing surface for the `cmux-relay` CLI. Business logic
/// inside `run()` (filesystem reads, NIO bootstrap, signal handling) is
/// exercised by the M3.13 live smoke; here we only assert the parser
/// produces the right subcommand with the right fields.
final class CmuxRelayTests: XCTestCase {

    func testVersionFlagPrintsSharedMarketingVersion() {
        XCTAssertEqual(CmuxRelay.configuration.version, CmuxRemoteVersion.marketing)
        XCTAssertThrowsError(try CmuxRelay.parseAsRoot(["--version"])) { error in
            XCTAssertEqual(CmuxRelay.message(for: error), CmuxRemoteVersion.marketing)
            XCTAssertEqual(CmuxRelay.exitCode(for: error), .success)
        }
    }

    func testServeIsDefaultSubcommand() throws {
        let cmd = try CmuxRelay.parseAsRoot([])
        XCTAssertTrue(cmd is Serve, "expected Serve, got \(type(of: cmd))")
    }

    func testServeAcceptsConfigOption() throws {
        let cmd = try CmuxRelay.parseAsRoot(["serve", "--config", "/tmp/r.json"])
        let serve = try XCTUnwrap(cmd as? Serve)
        XCTAssertEqual(serve.config, "/tmp/r.json")
    }

    func testServeDefaultsToHomeConfigPath() throws {
        let cmd = try CmuxRelay.parseAsRoot(["serve"])
        let serve = try XCTUnwrap(cmd as? Serve)
        XCTAssertTrue(serve.config.hasSuffix("/.brb/relay.json"),
                      "default config should live under ~/.brb/; got \(serve.config)")
    }

    func testRelayHomeHonorsHomeEnvironment() {
        XCTAssertEqual(relayHomeDirectory(environment: ["HOME": "/tmp/smoke-home"]), "/tmp/smoke-home")
        XCTAssertEqual(relayHomeDirectory(environment: [:]), NSHomeDirectory())
        XCTAssertEqual(relayHomeDirectory(environment: ["HOME": ""]), NSHomeDirectory())
    }

    func testSelfLoginAutoAuthorizationOptOutValues() {
        XCTAssertTrue(Serve.shouldAutoAuthorizeSelfLogin(environment: [:]))
        XCTAssertTrue(Serve.shouldAutoAuthorizeSelfLogin(environment: ["CMUX_NO_SELF_LOGIN": ""]))
        XCTAssertTrue(Serve.shouldAutoAuthorizeSelfLogin(environment: ["CMUX_NO_SELF_LOGIN": "0"]))
        XCTAssertFalse(Serve.shouldAutoAuthorizeSelfLogin(environment: ["CMUX_NO_SELF_LOGIN": "1"]))
        XCTAssertFalse(Serve.shouldAutoAuthorizeSelfLogin(environment: ["CMUX_NO_SELF_LOGIN": "true"]))
    }

    func testBrbHomeHonorsEnvironmentThenHome() {
        XCTAssertEqual(brbHome(environment: ["BRB_HOME": "/tmp/brb-x"]), "/tmp/brb-x")
        XCTAssertEqual(brbHome(environment: ["HOME": "/tmp/h"]), "/tmp/h/.brb")
        XCTAssertEqual(brbHome(environment: ["BRB_HOME": "", "HOME": "/tmp/h"]), "/tmp/h/.brb")
    }

    func testPairParsesControlFlagAndLifetime() throws {
        let cmd = try CmuxRelay.parseAsRoot(["pair", "--control", "--lifetime-minutes", "30"])
        let pair = try XCTUnwrap(cmd as? Pair)
        XCTAssertTrue(pair.control)
        XCTAssertEqual(pair.lifetimeMinutes, 30)
        let plain = try XCTUnwrap(try CmuxRelay.parseAsRoot(["pair"]) as? Pair)
        XCTAssertFalse(plain.control)
        XCTAssertNil(plain.lifetimeMinutes)
    }

    func testDevicesSetScopeAndRevokeAllParse() throws {
        let set = try XCTUnwrap(try CmuxRelay.parseAsRoot(["devices", "set-scope", "abc", "control"]) as? Devices.SetScope)
        XCTAssertEqual(set.deviceId, "abc")
        XCTAssertEqual(set.scope, "control")
        XCTAssertTrue(try CmuxRelay.parseAsRoot(["devices", "revoke-all"]) is Devices.RevokeAll)
    }

    func testPushSubcommandsParse() throws {
        XCTAssertTrue(try CmuxRelay.parseAsRoot(["push", "setup"]) is Push.Setup)
        let setup = try XCTUnwrap(try CmuxRelay.parseAsRoot(["push", "setup", "--include-text", "--server", "https://n.example"]) as? Push.Setup)
        XCTAssertTrue(setup.includeText)
        XCTAssertEqual(setup.server, "https://n.example")
        XCTAssertTrue(try CmuxRelay.parseAsRoot(["push", "test"]) is Push.Test)
        XCTAssertTrue(try CmuxRelay.parseAsRoot(["push", "disable"]) is Push.Disable)
    }

    func testCommandNameIsBrbRelay() {
        XCTAssertEqual(CmuxRelay.configuration.commandName, "brb-relay")
    }

    func testDevicesListParses() throws {
        let cmd = try CmuxRelay.parseAsRoot(["devices", "list"])
        XCTAssertTrue(cmd is Devices.List, "expected Devices.List, got \(type(of: cmd))")
    }

    func testDevicesRevokeRequiresDeviceId() {
        XCTAssertThrowsError(try CmuxRelay.parseAsRoot(["devices", "revoke"]))
    }

    func testDevicesRevokeAcceptsDeviceId() throws {
        let cmd = try CmuxRelay.parseAsRoot(["devices", "revoke", "abc-xyz"])
        let revoke = try XCTUnwrap(cmd as? Devices.Revoke)
        XCTAssertEqual(revoke.deviceId, "abc-xyz")
    }
}

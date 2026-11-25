import XCTest
@testable import RelayCore

final class PairingCodeStoreTests: XCTestCase {
    private func makeStore(_ clock: FakeClock = FakeClock()) -> (PairingCodeStore, URL, FakeClock) {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("pairing-\(UUID())", isDirectory: true)
            .appendingPathComponent("pairing.json")
        return (PairingCodeStore(url: url, clock: clock), url, clock)
    }

    func testIssuedCodeLooksRightAndWorksOnce() throws {
        let (store, _, _) = makeStore()
        let issued = try store.issue(lifetimeSeconds: 3600)
        // 16 symbols in four groups of four.
        XCTAssertEqual(issued.code.split(separator: "-").count, 4)
        XCTAssertEqual(PairingCodeStore.normalize(issued.code).count, 16)
        XCTAssertEqual(store.consume(issued.code), .accepted(.read))
        XCTAssertEqual(store.consume(issued.code), .rejected(.noActiveCode), "a used code must not work again")
    }

    func testCodeGrantsTheRequestedScope() throws {
        let (store, _, _) = makeStore()
        let issued = try store.issue(lifetimeSeconds: 3600, grants: .control)
        XCTAssertEqual(store.consume(issued.code), .accepted(.control))
    }

    func testCodeIsAcceptedWithoutDashesAndInLowercase() throws {
        let (store, _, _) = makeStore()
        let issued = try store.issue(lifetimeSeconds: 3600)
        let typed = issued.code.replacingOccurrences(of: "-", with: "").lowercased()
        XCTAssertEqual(store.consume(typed), .accepted(.read))
    }

    func testWrongCodeIsRejectedAndKeepsTheActiveCode() throws {
        let (store, _, _) = makeStore()
        let issued = try store.issue(lifetimeSeconds: 3600)
        XCTAssertEqual(store.consume("AAAA-AAAA-AAAA-AAAA"), .rejected(.mismatch))
        XCTAssertEqual(store.consume("not a code"), .rejected(.malformed))
        XCTAssertEqual(store.consume(issued.code), .accepted(.read))
    }

    func testExpiredCodeIsRejectedAndRemoved() throws {
        let (store, url, clock) = makeStore()
        let issued = try store.issue(lifetimeSeconds: 600)
        clock.advance(by: 601)
        XCTAssertEqual(store.consume(issued.code), .rejected(.expired))
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }

    func testCodeStillWorksJustBeforeItExpires() throws {
        let (store, _, clock) = makeStore()
        let issued = try store.issue(lifetimeSeconds: 600)
        clock.advance(by: 599)
        XCTAssertEqual(store.consume(issued.code), .accepted(.read))
    }

    func testNewCodeReplacesAnUnusedOlderOne() throws {
        let (store, _, _) = makeStore()
        let first = try store.issue(lifetimeSeconds: 3600)
        let second = try store.issue(lifetimeSeconds: 3600)
        XCTAssertNotEqual(first.code, second.code)
        XCTAssertEqual(store.consume(first.code), .rejected(.mismatch))
        XCTAssertEqual(store.consume(second.code), .accepted(.read))
    }

    func testLifetimeIsClampedToFiveMinutesThroughOneDay() throws {
        let (store, _, clock) = makeStore()
        let tooShort = try store.issue(lifetimeSeconds: 1)
        XCTAssertEqual(tooShort.expiresAt - clock.now, 300, accuracy: 0.001)
        let tooLong = try store.issue(lifetimeSeconds: 10 * 24 * 3600)
        XCTAssertEqual(tooLong.expiresAt - clock.now, 86_400, accuracy: 0.001)
    }

    func testOnlyAHashIsStoredNeverTheCode() throws {
        let (store, url, _) = makeStore()
        let issued = try store.issue(lifetimeSeconds: 3600)
        let raw = try String(contentsOf: url, encoding: .utf8)
        XCTAssertFalse(raw.contains(PairingCodeStore.normalize(issued.code)))
        XCTAssertFalse(raw.contains(issued.code))
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    }

    func testAnotherProcessSeesTheSameCode() throws {
        let (store, url, clock) = makeStore()
        let issued = try store.issue(lifetimeSeconds: 3600)
        let other = PairingCodeStore(url: url, clock: clock)
        XCTAssertEqual(other.consume(issued.code), .accepted(.read))
        XCTAssertEqual(store.consume(issued.code), .rejected(.noActiveCode))
    }

    func testRandomCodesDoNotRepeat() throws {
        var seen = Set<String>()
        for _ in 0..<200 { seen.insert(try PairingCodeStore.randomCode()) }
        XCTAssertEqual(seen.count, 200)
    }
}

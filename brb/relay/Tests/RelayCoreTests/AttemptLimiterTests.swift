import XCTest
@testable import RelayCore

final class AttemptLimiterTests: XCTestCase {
    private let policy = AttemptLimiter.Policy(maxFailures: 3, window: 600, baseLockout: 60, maxLockout: 240)

    func testLocksAfterThresholdAndUnlocksWhenItEnds() {
        let clock = FakeClock()
        let limiter = AttemptLimiter(policy: policy, clock: clock)
        XCTAssertFalse(limiter.recordFailure("a"))
        XCTAssertFalse(limiter.recordFailure("a"))
        XCTAssertFalse(limiter.isLocked("a"))
        XCTAssertTrue(limiter.recordFailure("a"))
        XCTAssertTrue(limiter.isLocked("a"))
        XCTAssertEqual(try XCTUnwrap(limiter.lockedFor("a")), 60, accuracy: 0.001)
        clock.advance(by: 61)
        XCTAssertFalse(limiter.isLocked("a"))
    }

    func testLockoutDoublesUpToTheMaximum() {
        let clock = FakeClock()
        let limiter = AttemptLimiter(policy: policy, clock: clock)
        var durations: [TimeInterval] = []
        for _ in 0..<4 {
            for _ in 0..<3 { limiter.recordFailure("a") }
            durations.append(limiter.lockedFor("a") ?? 0)
            clock.advance(by: 1000)
        }
        XCTAssertEqual(durations, [60, 120, 240, 240])
    }

    func testOldFailuresFallOutOfTheWindow() {
        let clock = FakeClock()
        let limiter = AttemptLimiter(policy: policy, clock: clock)
        limiter.recordFailure("a")
        limiter.recordFailure("a")
        clock.advance(by: 601)
        XCTAssertFalse(limiter.recordFailure("a"), "the two old failures no longer count")
        XCTAssertFalse(limiter.isLocked("a"))
    }

    func testKeysAreIndependent() {
        let limiter = AttemptLimiter(policy: policy, clock: FakeClock())
        for _ in 0..<3 { limiter.recordFailure("a") }
        XCTAssertTrue(limiter.isLocked("a"))
        XCTAssertFalse(limiter.isLocked("b"))
    }

    func testSuccessClearsFailuresButNotAnActiveLockout() {
        let clock = FakeClock()
        let limiter = AttemptLimiter(policy: policy, clock: clock)
        limiter.recordFailure("a")
        limiter.recordFailure("a")
        limiter.recordSuccess("a")
        XCTAssertFalse(limiter.recordFailure("a"), "success reset the count")
        for _ in 0..<2 { limiter.recordFailure("a") }
        XCTAssertTrue(limiter.isLocked("a"))
        limiter.recordSuccess("a")
        XCTAssertTrue(limiter.isLocked("a"), "a lockout in progress is not cleared by a success")
    }

    func testLockoutSurvivesARestart() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("lockouts-\(UUID())", isDirectory: true)
            .appendingPathComponent("lockouts.json")
        let clock = FakeClock()
        let first = AttemptLimiter(policy: policy, clock: clock, persistURL: url)
        for _ in 0..<3 { first.recordFailure("addr:1.2.3.4") }
        let second = AttemptLimiter(policy: policy, clock: clock, persistURL: url)
        XCTAssertTrue(second.isLocked("addr:1.2.3.4"))
        clock.advance(by: 61)
        let third = AttemptLimiter(policy: policy, clock: clock, persistURL: url)
        XCTAssertFalse(third.isLocked("addr:1.2.3.4"))
    }
}

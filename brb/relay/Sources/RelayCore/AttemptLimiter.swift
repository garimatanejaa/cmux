import Darwin
import Foundation

/// Counts failed attempts per key (a source address or a device id) and locks
/// the key out for a growing period once it fails too often. While a key is
/// locked, even a correct request from it is refused.
public final class AttemptLimiter: @unchecked Sendable {
    public struct Policy: Equatable, Sendable {
        public var maxFailures: Int
        public var window: TimeInterval
        public var baseLockout: TimeInterval
        public var maxLockout: TimeInterval

        public init(maxFailures: Int, window: TimeInterval, baseLockout: TimeInterval, maxLockout: TimeInterval) {
            self.maxFailures = maxFailures
            self.window = window
            self.baseLockout = baseLockout
            self.maxLockout = maxLockout
        }

        /// 10 failures in 10 minutes locks an address for 1 minute, doubling to 1 hour.
        public static let perAddress = Policy(maxFailures: 10, window: 600, baseLockout: 60, maxLockout: 3600)
        /// 5 bad tokens in 10 minutes locks a device for 1 minute, doubling to 1 hour.
        public static let perDevice = Policy(maxFailures: 5, window: 600, baseLockout: 60, maxLockout: 3600)
    }

    private struct Entry: Codable {
        var failures: [TimeInterval] = []
        var lockedUntil: TimeInterval = 0
        var lockCount: Int = 0
        enum CodingKeys: String, CodingKey {
            case failures, lockedUntil = "locked_until", lockCount = "lock_count"
        }
    }

    private let policy: Policy
    private let clock: any Clock
    private let persistURL: URL?
    private let lock = NSLock()
    private var entries: [String: Entry] = [:]

    /// `persistURL` keeps lockouts in progress across a restart. Failure
    /// counts that have not caused a lockout stay in memory only.
    public init(policy: Policy, clock: any Clock = SystemClock(), persistURL: URL? = nil) {
        self.policy = policy
        self.clock = clock
        self.persistURL = persistURL
        if let persistURL,
           let data = try? Data(contentsOf: persistURL),
           let loaded = try? JSONDecoder().decode([String: Entry].self, from: data) {
            let now = clock.now
            entries = loaded.filter { $0.value.lockedUntil > now }
        }
    }

    /// Seconds left on the lockout for `key`, or nil when it is not locked.
    public func lockedFor(_ key: String) -> TimeInterval? {
        lock.lock()
        defer { lock.unlock() }
        guard let entry = entries[key] else { return nil }
        let left = entry.lockedUntil - clock.now
        return left > 0 ? left : nil
    }

    public func isLocked(_ key: String) -> Bool { lockedFor(key) != nil }

    /// Records one failed attempt. Returns true when this failure started a lockout.
    @discardableResult
    public func recordFailure(_ key: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        let now = clock.now
        var entry = entries[key] ?? Entry()
        entry.failures.removeAll { now - $0 > policy.window }
        entry.failures.append(now)
        var started = false
        if entry.failures.count >= policy.maxFailures {
            entry.lockCount += 1
            let doublings = min(entry.lockCount - 1, 20)
            let duration = min(policy.baseLockout * pow(2, Double(doublings)), policy.maxLockout)
            entry.lockedUntil = now + duration
            entry.failures = []
            started = true
        }
        entries[key] = entry
        if started { persistLocked() }
        return started
    }

    /// A good request clears the failure count. It does not end a lockout in
    /// progress, and the lockout level only falls back after the key has been
    /// quiet and unlocked.
    public func recordSuccess(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        guard var entry = entries[key] else { return }
        entry.failures = []
        if entry.lockedUntil <= clock.now {
            entries.removeValue(forKey: key)
        } else {
            entries[key] = entry
        }
    }

    private func persistLocked() {
        guard let persistURL else { return }
        let now = clock.now
        let active = entries.filter { $0.value.lockedUntil > now }
        guard let data = try? JSONEncoder().encode(active) else { return }
        let directory = persistURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let temporary = directory.appendingPathComponent(".lockouts-\(UUID().uuidString).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard (try? data.write(to: temporary)) != nil else { return }
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        _ = rename(temporary.path, persistURL.path)
    }
}

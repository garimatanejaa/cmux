import Crypto
import Darwin
import Foundation
import Security

/// One active, single-use pairing code, stored only as a SHA-256 hash with its
/// expiry. The file is re-read on every use so `brb-relay pair` (a separate
/// process) and the running relay always agree on the current code.
public final class PairingCodeStore: @unchecked Sendable {
    public static let minLifetimeSeconds: TimeInterval = 5 * 60
    public static let maxLifetimeSeconds: TimeInterval = 24 * 60 * 60
    public static let defaultLifetimeSeconds: TimeInterval = 60 * 60

    public enum ConsumeResult: Equatable, Sendable {
        /// The code was good. The phone being paired gets this scope.
        case accepted(DeviceScope)
        case rejected(Reason)
    }

    public enum Reason: String, Equatable, Sendable {
        case noActiveCode = "no_active_code"
        case mismatch
        case expired
        case malformed
    }

    public enum StoreError: Error, Equatable {
        case secureRandom(Int32)
        case persistence(Int32)
    }

    private struct Record: Codable {
        var codeHash: String
        var createdAt: TimeInterval
        var expiresAt: TimeInterval
        var scope: DeviceScope? = nil
        enum CodingKeys: String, CodingKey {
            case codeHash = "code_hash", createdAt = "created_at", expiresAt = "expires_at", scope
        }
    }

    /// Crockford base32 without I, L, O, U, so a code read aloud or off a
    /// screen is hard to mistype. 16 characters is 80 bits.
    static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    static let codeLength = 16

    public let url: URL
    private let clock: any Clock
    private let lock = NSLock()

    public init(url: URL, clock: any Clock = SystemClock()) {
        self.url = url
        self.clock = clock
    }

    /// Clamps a requested lifetime into the allowed 5 minutes to 24 hours range.
    public static func clampedLifetime(_ seconds: TimeInterval) -> TimeInterval {
        min(max(seconds, minLifetimeSeconds), maxLifetimeSeconds)
    }

    /// Creates a new code and replaces any unused older one.
    public func issue(
        lifetimeSeconds: TimeInterval,
        grants scope: DeviceScope = .read
    ) throws -> (code: String, expiresAt: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        let lifetime = Self.clampedLifetime(lifetimeSeconds)
        let code = try Self.randomCode()
        let now = clock.now
        let record = Record(
            codeHash: Self.hash(Self.normalize(code)),
            createdAt: now,
            expiresAt: now + lifetime,
            scope: scope
        )
        try persist(record)
        return (Self.display(code), record.expiresAt)
    }

    /// Checks a presented code. A correct, unexpired code is accepted exactly
    /// once and removed. An expired code is removed too. A wrong code leaves
    /// the active one in place, and lockout in the caller limits guessing.
    public func consume(_ presented: String) -> ConsumeResult {
        lock.lock()
        defer { lock.unlock() }
        guard let record = load() else { return .rejected(.noActiveCode) }
        let normalized = Self.normalize(presented)
        guard normalized.count == Self.codeLength,
              normalized.allSatisfy({ Self.alphabet.contains($0) }) else {
            return .rejected(.malformed)
        }
        guard Self.constantTimeEqual(record.codeHash, Self.hash(normalized)) else {
            return .rejected(.mismatch)
        }
        if clock.now >= record.expiresAt {
            remove()
            return .rejected(.expired)
        }
        remove()
        return .accepted(record.scope ?? .read)
    }

    /// Removes any active code.
    public func clear() {
        lock.lock()
        defer { lock.unlock() }
        remove()
    }

    /// Seconds until the active code expires, or nil when there is none.
    public func secondsRemaining() -> TimeInterval? {
        lock.lock()
        defer { lock.unlock() }
        guard let record = load() else { return nil }
        let left = record.expiresAt - clock.now
        return left > 0 ? left : nil
    }

    // MARK: - Code format

    static func normalize(_ raw: String) -> String {
        var out = ""
        for character in raw.uppercased() {
            switch character {
            case "-", " ", "\n", "\t", "\r": continue
            case "O": out.append("0")
            case "I", "L": out.append("1")
            default: out.append(character)
            }
        }
        return out
    }

    static func display(_ code: String) -> String {
        var groups: [String] = []
        var index = code.startIndex
        while index < code.endIndex {
            let end = code.index(index, offsetBy: 4, limitedBy: code.endIndex) ?? code.endIndex
            groups.append(String(code[index..<end]))
            index = end
        }
        return groups.joined(separator: "-")
    }

    static func randomCode() throws -> String {
        var bytes = [UInt8](repeating: 0, count: codeLength)
        let status = bytes.withUnsafeMutableBufferPointer {
            SecRandomCopyBytes(kSecRandomDefault, $0.count, $0.baseAddress!)
        }
        guard status == errSecSuccess else { throw StoreError.secureRandom(status) }
        // 32 symbols, so a byte masked to 5 bits is uniform.
        return String(bytes.map { alphabet[Int($0 & 0x1F)] })
    }

    static func hash(_ normalized: String) -> String {
        SHA256.hash(data: Data(normalized.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func constantTimeEqual(_ a: String, _ b: String) -> Bool {
        guard a.utf8.count == b.utf8.count else { return false }
        var difference: UInt8 = 0
        for (left, right) in zip(a.utf8, b.utf8) { difference |= left ^ right }
        return difference == 0
    }

    // MARK: - Storage

    private func load() -> Record? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Record.self, from: data)
    }

    private func remove() {
        try? FileManager.default.removeItem(at: url)
    }

    private func persist(_ record: Record) throws {
        let fileManager = FileManager.default
        let directory = url.deletingLastPathComponent()
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let temporary = directory.appendingPathComponent(".pairing-\(UUID().uuidString).tmp")
        defer { try? fileManager.removeItem(at: temporary) }
        try JSONEncoder().encode(record).write(to: temporary)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        guard rename(temporary.path, url.path) == 0 else {
            throw StoreError.persistence(errno)
        }
    }
}

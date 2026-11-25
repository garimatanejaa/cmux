import Foundation

/// Append-only log of what phones did. It records who, when, which method and
/// which workspace and surface, never terminal text, keys, tokens or codes.
public final class AuditLog: @unchecked Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        public var time: String
        public var device: String
        public var scope: String
        public var method: String
        public var workspaceId: String?
        public var surfaceId: String?
        public var result: String

        public init(
            time: String,
            device: String,
            scope: String,
            method: String,
            workspaceId: String? = nil,
            surfaceId: String? = nil,
            result: String
        ) {
            self.time = time
            self.device = device
            self.scope = scope
            self.method = method
            self.workspaceId = workspaceId
            self.surfaceId = surfaceId
            self.result = result
        }

        enum CodingKeys: String, CodingKey {
            case time, device, scope, method, result
            case workspaceId = "workspace_id"
            case surfaceId = "surface_id"
        }
    }

    public let url: URL
    private let maxBytes: Int
    private let keepFiles: Int
    private let clock: any Clock
    private let lock = NSLock()

    /// `keepFiles` counts the live file too: 3 keeps audit.log, audit.log.1, audit.log.2.
    public init(url: URL, maxBytes: Int = 5 * 1024 * 1024, keepFiles: Int = 3, clock: any Clock = SystemClock()) {
        self.url = url
        self.maxBytes = max(1, maxBytes)
        self.keepFiles = max(1, keepFiles)
        self.clock = clock
    }

    public func record(
        device: String,
        scope: DeviceScope,
        method: String,
        workspaceId: String? = nil,
        surfaceId: String? = nil,
        result: String
    ) {
        let formatter = ISO8601DateFormatter()
        let entry = Entry(
            time: formatter.string(from: Date(timeIntervalSince1970: clock.now)),
            device: String(device.prefix(12)),
            scope: scope.rawValue,
            method: method,
            workspaceId: workspaceId,
            surfaceId: surfaceId,
            result: result
        )
        append(entry)
    }

    func append(_ entry: Entry) {
        lock.lock()
        defer { lock.unlock() }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard var line = try? encoder.encode(entry) else { return }
        line.append(0x0A)

        let fileManager = FileManager.default
        try? fileManager.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        rotateIfNeeded(adding: line.count)
        if !fileManager.fileExists(atPath: url.path) {
            fileManager.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: line)
    }

    private func rotateIfNeeded(adding bytes: Int) {
        let fileManager = FileManager.default
        guard let attributes = try? fileManager.attributesOfItem(atPath: url.path),
              let size = attributes[.size] as? Int,
              size + bytes > maxBytes else { return }
        // audit.log.(keepFiles-1) is dropped, the rest shift up, audit.log becomes .1
        let oldest = rotated(keepFiles - 1)
        try? fileManager.removeItem(at: oldest)
        if keepFiles > 1 {
            var index = keepFiles - 2
            while index >= 1 {
                let from = rotated(index)
                if fileManager.fileExists(atPath: from.path) {
                    try? fileManager.moveItem(at: from, to: rotated(index + 1))
                }
                index -= 1
            }
            try? fileManager.moveItem(at: url, to: rotated(1))
        } else {
            try? fileManager.removeItem(at: url)
        }
    }

    private func rotated(_ index: Int) -> URL {
        url.deletingLastPathComponent().appendingPathComponent("\(url.lastPathComponent).\(index)")
    }
}

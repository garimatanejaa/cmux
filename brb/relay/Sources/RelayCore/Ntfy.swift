import Foundation
import SharedKit

/// Settings for phone notifications through ntfy (https://ntfy.sh or your own server).
/// Kept in `~/.brb/ntfy.json` (0600), not in relay.json, so `brb-relay push ...` can change
/// them while the relay runs.
public struct NtfySettings: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var server: String
    /// The topic is the only secret on a public ntfy server: anyone who knows it can read
    /// what is published to it. It is random and at least 128 bits.
    public var topic: String
    /// Send the real notification title and body. Off by default, because ntfy.sh and Apple
    /// or Google push servers would then see text from your terminals.
    public var includeText: Bool
    /// Optional access token for a protected ntfy server.
    public var token: String?

    enum CodingKeys: String, CodingKey {
        case enabled, server, topic, includeText = "include_text", token
    }

    public init(enabled: Bool = true, server: String = "https://ntfy.sh", topic: String,
                includeText: Bool = false, token: String? = nil) {
        self.enabled = enabled
        self.server = server
        self.topic = topic
        self.includeText = includeText
        self.token = token
    }

    /// The URL a phone subscribes to.
    public var subscribeURL: String {
        var base = server
        while base.hasSuffix("/") { base.removeLast() }
        return "\(base)/\(topic)"
    }
}

public final class NtfySettingsStore: @unchecked Sendable {
    private let url: URL

    public init(url: URL) { self.url = url }

    public func load() -> NtfySettings? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(NtfySettings.self, from: data)
    }

    public func save(_ settings: NtfySettings) throws {
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let temporary = directory.appendingPathComponent(".ntfy-\(UUID().uuidString).tmp")
        try encoder.encode(settings).write(to: temporary)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary)
    }

    /// Returns the saved settings, creating them with a fresh random topic the first time.
    public func ensure() throws -> NtfySettings {
        if let existing = load() { return existing }
        let created = NtfySettings(topic: Self.randomTopic())
        try save(created)
        return created
    }

    /// "brb-" plus 26 base32 characters: 130 bits from the system random source.
    public static func randomTopic() -> String {
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz234567")
        var generator = SystemRandomNumberGenerator()
        let body = (0..<26).map { _ in alphabet[Int.random(in: 0..<alphabet.count, using: &generator)] }
        return "brb-" + String(body)
    }
}

public enum NtfyRequestBuilder {
    static let genericTitle = "BRB"
    static let genericMessage = "An agent needs your attention."

    /// Builds one publish request. ntfy accepts a JSON body posted to the server root,
    /// which keeps non-ASCII text out of HTTP headers.
    public static func request(settings: NtfySettings, notification: NotificationRecord) -> APNsPreparedRequest? {
        guard let url = URL(string: settings.server), url.scheme == "https" || url.scheme == "http" else { return nil }
        var title = Self.genericTitle
        var message = Self.genericMessage
        if settings.includeText {
            let rawTitle = notification.title.trimmingCharacters(in: .whitespacesAndNewlines)
            let rawBody = notification.body.trimmingCharacters(in: .whitespacesAndNewlines)
            if !rawTitle.isEmpty { title = String(rawTitle.prefix(100)) }
            if !rawBody.isEmpty { message = String(rawBody.prefix(300)) }
        }
        let payload: [String: Any] = [
            "topic": settings.topic,
            "title": title,
            "message": message,
            "priority": 4,
            "tags": ["robot"],
        ]
        guard let body = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return nil }
        var headers = ["Content-Type": "application/json"]
        if let token = settings.token, !token.isEmpty { headers["Authorization"] = "Bearer \(token)" }
        return APNsPreparedRequest(url: url, headers: headers, body: body)
    }

    /// A harmless message for `brb-relay push test`.
    public static func testRequest(settings: NtfySettings) -> APNsPreparedRequest? {
        request(settings: settings, notification: NotificationRecord(
            id: "test", workspaceId: "", surfaceId: nil, title: "BRB test",
            subtitle: nil, body: "Push notifications work.", ts: 0, threadId: ""
        ))
    }
}

/// Sends a cmux inbox notification to the phone through ntfy.
public final class NtfyFanout: @unchecked Sendable {
    private let settings: @Sendable () -> NtfySettings?
    private let transport: any APNsTransport
    private let log: @Sendable (String) -> Void

    public init(
        settings: @escaping @Sendable () -> NtfySettings?,
        transport: any APNsTransport,
        log: @escaping @Sendable (String) -> Void = { _ in }
    ) {
        self.settings = settings
        self.transport = transport
        self.log = log
    }

    public func deliver(event: EventFrame) async {
        guard let notification = InboxNotification.record(from: event) else { return }
        guard let current = settings(), current.enabled else { return }
        guard let request = NtfyRequestBuilder.request(settings: current, notification: notification) else {
            log("ntfy: invalid server address in ntfy.json")
            return
        }
        do {
            let response = try await transport.send(request)
            if !(200..<300).contains(response.status) {
                log("ntfy: server answered HTTP \(response.status)")
            }
        } catch {
            log("ntfy: could not reach the server")
        }
    }

    /// Used by `brb-relay push test`. Returns the HTTP status, or nil when the server was unreachable.
    public static func sendTest(settings: NtfySettings, transport: any APNsTransport) async -> Int? {
        guard let request = NtfyRequestBuilder.testRequest(settings: settings) else { return nil }
        return try? await transport.send(request).status
    }
}

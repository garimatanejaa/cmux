import Foundation

/// What a paired phone may do. `read` watches (screens, events, alerts);
/// `control` may also send text and keys, answer approvals and read files.
public enum DeviceScope: String, Codable, Sendable, Equatable {
    case read
    case control
}

/// Decides which RPC methods each scope may call. Deny by default: a method
/// that is not listed as read-only needs `control`, and a method listed in
/// `neverAllowed` is refused for every scope.
public enum MethodPolicy {
    /// Methods a `read` device may call. Everything else needs `control`.
    public static let readOnlyMethods: Set<String> = [
        "host.capabilities",
        "host.battery",
        "relay.info",
        "system.capabilities",
        "system.ping",
        "workspace.list",
        "surface.list",
        "surface.subscribe",
        "surface.unsubscribe",
        "surface.read_text",
        "surface.browser.capture",
        "notification.list",
        "feed.list",
        "feed.pending.list",
        "terminal.replay",
        "terminal.artifact.scan",
        "terminal.artifact.stat",
        "claude.sessions.list",
        "claude.transcript.page",
    ]

    /// Methods no phone may call. BRB has no remote self-update.
    public static let neverAllowed: Set<String> = [
        "relay.update.start",
    ]

    public static func isAllowed(method: String, scope: DeviceScope) -> Bool {
        if neverAllowed.contains(method) { return false }
        switch scope {
        case .control: return true
        case .read: return readOnlyMethods.contains(method)
        }
    }

    /// True for methods that change something or read file contents. These
    /// are the ones written to the audit log.
    public static func isControlAction(method: String) -> Bool {
        !readOnlyMethods.contains(method)
    }
}

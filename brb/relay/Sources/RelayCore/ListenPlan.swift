import Foundation

/// Decides where the relay may listen. The default is the Mac's Tailscale
/// address only, so the port is not open on the local Wi-Fi.
public enum ListenPlan: Equatable, Sendable {
    /// Listen on this address.
    case bind(host: String, port: Int)
    /// Tailscale has no address yet. Retry later and do not listen anywhere meanwhile.
    case waitForTailscale(port: Int)
    /// Refuse to start, with the reason to show the user.
    case refused(String)

    public static let defaultPort = 4399

    /// Splits `host:port`, falling back to port 4399 when it is missing or invalid.
    public static func parse(_ listen: String) -> (host: String, port: Int) {
        let trimmed = listen.trimmingCharacters(in: .whitespaces)
        // A bare IPv6 address ("::", "::1") has several colons and no brackets:
        // the whole string is the host and there is no port to split off.
        if !trimmed.hasPrefix("["), trimmed.filter({ $0 == ":" }).count > 1 {
            return (trimmed, defaultPort)
        }
        guard let separator = trimmed.lastIndex(of: ":") else {
            return (trimmed, defaultPort)
        }
        let host = String(trimmed[trimmed.startIndex..<separator])
        let portText = String(trimmed[trimmed.index(after: separator)...])
        let port = Int(portText).flatMap { (1...65535).contains($0) ? $0 : nil } ?? defaultPort
        return (host, port)
    }

    /// `host` of `tailscale` (or empty) means the Tailscale IPv4 address. An
    /// all-interfaces address is refused unless `allowAllInterfaces` is true.
    public static func plan(
        listen: String,
        allowAllInterfaces: Bool,
        tailscaleIPv4: () -> String?
    ) -> ListenPlan {
        let (host, port) = parse(listen)
        switch host.lowercased() {
        case "", "tailscale":
            if let address = tailscaleIPv4() { return .bind(host: address, port: port) }
            return .waitForTailscale(port: port)
        case "0.0.0.0", "::", "[::]", "*":
            guard allowAllInterfaces else {
                return .refused(
                    "listen address \(host) would open the relay on every network interface. "
                        + "Use \"tailscale:\(port)\" (the default), or set allow_all_interfaces to true "
                        + "in relay.json if you really want this."
                )
            }
            return .bind(host: host, port: port)
        default:
            return .bind(host: host, port: port)
        }
    }

    /// The Mac's Tailscale IPv4 address from `tailscale ip -4`, or nil.
    public static func currentTailscaleIPv4() -> String? {
        guard let executable = TailscaledLocalAuth.resolveTailscaleCLI() else { return nil }
        let environment = ProcessInfo.processInfo.environment.merging(
            ["TAILSCALE_BE_CLI": "1"],
            uniquingKeysWith: { _, forced in forced }
        )
        guard let output = try? TailscaleCLIProcessRunner.run(
            executableURL: URL(fileURLWithPath: executable),
            arguments: ["ip", "-4"],
            environment: environment
        ), output.terminationStatus == 0 else { return nil }
        let text = String(decoding: output.stdout, as: UTF8.self)
        let first = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        return isIPv4(first) ? first : nil
    }

    static func isIPv4(_ text: String) -> Bool {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        return parts.allSatisfy { part in
            guard let value = Int(part), (0...255).contains(value) else { return false }
            return String(value) == String(part)
        }
    }
}

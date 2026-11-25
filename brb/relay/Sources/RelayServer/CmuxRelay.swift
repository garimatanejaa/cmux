import Foundation
import ArgumentParser
import NIOPosix
import RelayCore
import CMUXClient
import SharedKit
import Logging

/// `brb-relay` CLI entry point (based on cmux-remote's relay, MIT).
///
/// Subcommands:
/// - `serve` (default) — boot the HTTP/WS relay against the local cmux UDS.
/// - `pair` — create a one-time pairing code to approve a new phone.
/// - `devices list|set-scope|revoke|revoke-all` — inspect and change paired
///   phones in `~/.brb/devices.json` without going through the running server.
///
/// The AppKit menu-bar subcommand from the plan is intentionally deferred
/// — it's not on the critical path to "phone talks to relay" and adds
/// linker weight that the v1.0 service binary doesn't need.
@main
struct CmuxRelay: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "brb-relay",
        version: CmuxRemoteVersion.marketing,
        subcommands: [Serve.self, Pair.self, Devices.self],
        defaultSubcommand: Serve.self
    )
}

struct Serve: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "serve",
        abstract: "Run the HTTP + WebSocket relay."
    )

    @Option(name: .customLong("config"),
            help: "Path to relay.json (default: ~/.brb/relay.json).")
    var config: String = defaultConfigPath()

    func run() async throws {
        let logger = Logger(label: "brb-relay")
        let store = ConfigStore(url: URL(fileURLWithPath: config))
        try store.reload()

        let group = MultiThreadedEventLoopGroup(numberOfThreads: 2)
        let conn = CmuxConnection(group: group)
        let facade = CMUXFacadeImpl(connection: conn)
        let reader = CmuxSurfaceReader(connection: conn)
        let manager = SessionManager(terminalReader: reader,
                                     defaultFps: store.current.defaultFps,
                                     idleFps: store.current.idleFps)
        // BRB has no remote self-update: the service is always the inert one,
        // so relay.update.start can never reach a network or a launchd job.
        let relayUpdates = RelayUpdateService.unavailable()
        let (sessionCounts, sessionCountSink) = AsyncStream<Int>.makeStream(bufferingPolicy: .bufferingNewest(8))
        await manager.setActiveSessionCountObserver { count in sessionCountSink.yield(count) }
        Task {
            for await count in sessionCounts {
                await relayUpdates.sessionCountChanged(count)
            }
        }
        let deviceStore = try DeviceStore(url: URL(fileURLWithPath: devicesStorePath()))
        let pairingGate = PairingGate(
            codes: PairingCodeStore(url: URL(fileURLWithPath: pairingCodePath())),
            addressLimiter: AttemptLimiter(
                policy: .perAddress,
                persistURL: URL(fileURLWithPath: lockoutsPath())
            )
        )
        let auditLog = AuditLog(url: URL(fileURLWithPath: auditLogPath()))
        let apnsProvider = APNsProviderClient(config: { store.current.apns })
        let apnsFanout = InboxPushFanout(
            deviceStore: deviceStore,
            sender: apnsProvider,
            config: { store.current.apns }
        )
        let enricher = NotificationContentEnricher(
            dispatch: { method, params in try await facade.dispatch(method: method, params: params) },
            log: { line in logger.info("\(line)") }
        )
        let notificationPipeline = NotificationEventPipeline(
            enrich: { await enricher.fill($0) },
            broadcast: { await manager.broadcastToAll(frame: $0) },
            push: { await apnsFanout.deliver(event: $0) }
        )
        conn.onReset = {
            Task { await manager.broadcastReset() }
        }
        Task {
            var policy = ReconnectPolicy()
            while !Task.isCancelled {
                do {
                    let client = try await conn.connectForEvents()
                    let stream = EventStream(client: client) { event in
                        if event.category == .system,
                           let boot = try? event.payload.decode(BootInfo.self)
                        {
                            conn.observe(bootInfo: boot)
                        }
                        notificationPipeline.submit(event)
                    }
                    await stream.start(categories: EventCategory.allCases)
                    logger.info("cmux event stream attached")
                    let attachedAt = ContinuousClock.now
                    await client.awaitClosed()
                    // Only treat this as a healthy connection (and reset backoff)
                    // if it stayed attached a while; otherwise a flapping/crash-
                    // looping cmux would be re-attacked every base interval.
                    if ContinuousClock.now - attachedAt > .seconds(5) {
                        policy.reset()
                    }
                    logger.warning("cmux event stream detached; will re-attach")
                    await conn.invalidateEvents()
                } catch {
                    logger.warning("cmux event stream unavailable: \(String(describing: error))")
                }
                let delay = policy.nextDelay()
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
        let auth = TailscaledLocalAuth()
        let allowSelfLogin = Self.shouldAutoAuthorizeSelfLogin(
            environment: ProcessInfo.processInfo.environment
        )
        let routes = Routes(
            deviceStore: deviceStore,
            config: { store.current },
            auth: auth,
            allowSelfLogin: allowSelfLogin,
            pairing: pairingGate
        )
        let uploadRoot = ProcessInfo.processInfo.environment["CMUX_RELAY_UPLOAD_ROOT"]
            .map { URL(fileURLWithPath: $0, isDirectory: true) }
        let uploadService = uploadRoot.map { ChunkedFileUploadService(rootURL: $0) }
            ?? ChunkedFileUploadService()
        let artifactService = TerminalArtifactService(dispatchNative: { method, params in
            do {
                return .success(try await facade.dispatch(method: method, params: params))
            } catch let error as RPCError {
                return .failure(code: error.code)
            } catch {
                return .failure(code: "internal_error")
            }
        })
        let server = HTTPServer(
            group: group,
            routes: routes,
            auth: auth,
            deviceStore: deviceStore,
            sessionManager: manager,
            cmux: facade,
            uploadService: uploadService,
            artifactService: artifactService,
            relayUpdateService: relayUpdates,
            addressLimiter: pairingGate.addressLimiter,
            auditLog: auditLog,
            enforceScopes: true
        )

        let plan = ListenPlan.plan(
            listen: store.current.listen,
            allowAllInterfaces: store.current.allowAllInterfaces,
            tailscaleIPv4: { ListenPlan.currentTailscaleIPv4() }
        )
        let host: String
        let port: Int
        switch plan {
        case .bind(let planHost, let planPort):
            host = planHost
            port = planPort
        case .refused(let reason):
            logger.error("\(reason)")
            throw ExitCode.failure
        case .waitForTailscale(let planPort):
            // Do not listen anywhere until Tailscale has an address.
            logger.warning("Tailscale has no address yet; waiting (the relay is not listening)")
            var address: String?
            while address == nil {
                try await Task.sleep(nanoseconds: 10_000_000_000)
                address = ListenPlan.currentTailscaleIPv4()
            }
            host = address ?? "127.0.0.1"
            port = planPort
        }

        let sighup = DispatchSource.makeSignalSource(signal: SIGHUP, queue: .global())
        sighup.setEventHandler {
            do {
                try store.reload()
                logger.info("config reloaded")
            } catch {
                logger.warning("config reload failed: \(error)")
            }
        }
        sighup.resume()
        signal(SIGHUP, SIG_IGN)

        logger.info("starting brb-relay \(CmuxRemoteVersion.marketing) on \(host):\(port)")
        let listener = try await server.bind(host: host, port: port)
        logger.info("listening on \(listener.localAddress?.description ?? "?")")
        await relayUpdates.recordStartup()
        try await listener.closeFuture.get()
    }
    static func shouldAutoAuthorizeSelfLogin(environment: [String: String]) -> Bool {
        // The installer always writes the variable ("0" = keep auto-authorise);
        // any other non-empty value opts out, as it did before the plist set it.
        switch environment["CMUX_NO_SELF_LOGIN"] {
        case nil, "", "0": true
        default: false
        }
    }
}

struct Devices: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "devices",
        abstract: "Inspect and revoke registered phones.",
        subcommands: [List.self, SetScope.self, Revoke.self, RevokeAll.self]
    )

    struct List: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            commandName: "list",
            abstract: "Print all registered devices."
        )

        func run() async throws {
            let store = try DeviceStore(url: URL(fileURLWithPath: devicesStorePath()))
            for d in store.allDevices() {
                print("\(d.deviceId)  \(d.loginName)  \(d.hostname)  scope=\(d.effectiveScope.rawValue)  registered=\(d.registeredAt)")
            }
        }
    }

    struct Revoke: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            commandName: "revoke",
            abstract: "Revoke a single device by id."
        )

        @Argument(help: "Device id (or a unique start of it) to revoke.")
        var deviceId: String

        func run() async throws {
            let store = try DeviceStore(url: URL(fileURLWithPath: devicesStorePath()))
            let id = store.resolve(idOrPrefix: deviceId)?.deviceId ?? deviceId
            try store.revoke(deviceId: id)
            print("revoked \(id)")
        }
    }

    struct RevokeAll: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            commandName: "revoke-all",
            abstract: "Revoke every paired phone."
        )

        func run() async throws {
            let store = try DeviceStore(url: URL(fileURLWithPath: devicesStorePath()))
            let count = try store.revokeAll()
            print("revoked \(count) device(s)")
        }
    }

    struct SetScope: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            commandName: "set-scope",
            abstract: "Choose what a paired phone may do: read (watch only) or control (also type and approve)."
        )

        @Argument(help: "Device id (or a unique start of it).")
        var deviceId: String

        @Argument(help: "read or control.")
        var scope: String

        func run() async throws {
            guard let newScope = DeviceScope(rawValue: scope.lowercased()) else {
                throw ValidationError("scope must be \"read\" or \"control\"")
            }
            let store = try DeviceStore(url: URL(fileURLWithPath: devicesStorePath()))
            guard let device = store.resolve(idOrPrefix: deviceId) else {
                throw ValidationError("no single paired device matches \"\(deviceId)\"")
            }
            try store.setScope(deviceId: device.deviceId, scope: newScope)
            print("\(device.deviceId) is now \(newScope.rawValue)")
        }
    }
}

struct Pair: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "pair",
        abstract: "Create a one-time pairing code to approve a new phone."
    )

    @Flag(name: .customLong("control"),
          help: "Let the phone type, send keys and approve requests. Without it the phone can only watch.")
    var control = false

    @Option(name: .customLong("config"),
            help: "Path to relay.json (default: ~/.brb/relay.json).")
    var config: String = defaultConfigPath()

    @Option(name: .customLong("lifetime-minutes"),
            help: "How long the code works, 5 to 1440 minutes. Default: pairing_code_lifetime_minutes in relay.json, else 60.")
    var lifetimeMinutes: Int?

    func run() async throws {
        let store = ConfigStore(url: URL(fileURLWithPath: config))
        try? store.reload()
        let seconds = lifetimeMinutes.map { TimeInterval($0) * 60 } ?? store.current.pairingCodeLifetimeSeconds
        let codes = PairingCodeStore(url: URL(fileURLWithPath: pairingCodePath()))
        let issued = try codes.issue(lifetimeSeconds: seconds, grants: control ? .control : .read)
        let minutes = Int((PairingCodeStore.clampedLifetime(seconds) / 60).rounded())
        print("Pairing code: \(issued.code)")
        print("Valid for \(minutes) minutes, works once. Making a new code cancels this one.")
        print("The phone will be able to \(control ? "watch and control" : "watch only").")
        let address = ListenPlan.currentTailscaleIPv4() ?? "<this Mac's Tailscale address>"
        let port = ListenPlan.parse(store.current.listen).port
        print("Enter it in the BRB app with address \(address):\(port)")
    }
}

// MARK: - Path helpers

/// `$HOME` when set, else the account home. `NSHomeDirectory()` alone ignores
/// `$HOME`, so an ephemeral smoke relay run with a temporary `HOME` used to
/// read and rewrite the live relay's device registry.
func relayHomeDirectory(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
    if let home = environment["HOME"], !home.isEmpty { return home }
    return NSHomeDirectory()
}

/// BRB's data folder: `$BRB_HOME` when set, else `~/.brb`.
func brbHome(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
    if let home = environment["BRB_HOME"], !home.isEmpty { return home }
    return "\(relayHomeDirectory(environment: environment))/.brb"
}

func defaultConfigPath() -> String { "\(brbHome())/relay.json" }
func devicesStorePath() -> String { "\(brbHome())/devices.json" }
func pairingCodePath() -> String { "\(brbHome())/pairing.json" }
func lockoutsPath() -> String { "\(brbHome())/lockouts.json" }
func auditLogPath() -> String { "\(brbHome())/audit.log" }

/// Split `RelayConfig.listen` ("host:port") into a host + port pair.
/// Falls back to 4399 if the port is missing or unparseable so a typo
/// in relay.json doesn't take the daemon down silently.
func parseListen(_ listen: String) -> (host: String, port: Int) {
    let parts = listen.split(separator: ":", maxSplits: 1).map(String.init)
    let host = parts.first ?? "0.0.0.0"
    let port = parts.count >= 2 ? (Int(parts[1]) ?? 4399) : 4399
    return (host, port)
}

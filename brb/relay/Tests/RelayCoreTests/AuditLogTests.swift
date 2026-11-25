import XCTest
@testable import RelayCore

final class AuditLogTests: XCTestCase {
    private func tempLog(maxBytes: Int = 5 * 1024 * 1024, keepFiles: Int = 3) -> (AuditLog, URL) {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("audit-\(UUID())", isDirectory: true)
            .appendingPathComponent("audit.log")
        return (AuditLog(url: url, maxBytes: maxBytes, keepFiles: keepFiles, clock: FakeClock()), url)
    }

    func testWritesOneJsonLinePerEntryWithoutAnyText() throws {
        let (log, url) = tempLog()
        log.record(device: "device-abcdefghijklmnop", scope: .control, method: "surface.send_text",
                   workspaceId: "w1", surfaceId: "s1", result: "allowed")
        log.record(device: "d2", scope: .read, method: "surface.send_key", result: "denied")
        let lines = try String(contentsOf: url, encoding: .utf8)
            .split(separator: "\n").map(String.init)
        XCTAssertEqual(lines.count, 2)
        let first = try JSONDecoder().decode(AuditLog.Entry.self, from: Data(lines[0].utf8))
        XCTAssertEqual(first.method, "surface.send_text")
        XCTAssertEqual(first.workspaceId, "w1")
        XCTAssertEqual(first.surfaceId, "s1")
        XCTAssertEqual(first.device, "device-abcde", "only a short device id prefix is logged")
        XCTAssertFalse(lines[0].contains("\"text\""))
    }

    func testFileIsOwnerOnly() throws {
        let (log, url) = tempLog()
        log.record(device: "d", scope: .read, method: "m", result: "ok")
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    }

    func testRotatesAndKeepsAtMostThreeFiles() throws {
        let (log, url) = tempLog(maxBytes: 300, keepFiles: 3)
        for index in 0..<40 {
            log.record(device: "d\(index)", scope: .control, method: "surface.send_text", result: "allowed")
        }
        let directory = url.deletingLastPathComponent()
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path).sorted()
        XCTAssertEqual(names, ["audit.log", "audit.log.1", "audit.log.2"])
        for name in names {
            let size = try XCTUnwrap(
                FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent(name).path)[.size] as? Int
            )
            XCTAssertLessThanOrEqual(size, 300 + 200, "no file grows far past the limit")
        }
    }
}

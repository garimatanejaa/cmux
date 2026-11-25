import Foundation
import Testing
@testable import SharedKit

@Suite("cmux Remote version")
struct CmuxRemoteVersionTests {
    @Test func marketingVersionIsThreeIntegers() {
        let parts = CmuxRemoteVersion.marketing.split(separator: ".", omittingEmptySubsequences: false)
        #expect(parts.count == 3)
        #expect(parts.allSatisfy { !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } })
    }

}

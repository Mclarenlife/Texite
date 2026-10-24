import XCTest

final class TexiteUITests: XCTestCase {
    func testOfflineChineseCompileAndPersistence() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.texite.ios")
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.webViews.buttons["新建"].waitForExistence(timeout: 30))
        app.webViews.buttons["导入 ZIP 项目"].tap()
        let cancel = app.buttons.matching(identifier: "Cancel").firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 20))
        cancel.tap()
        app.webViews.buttons["新建"].tap()
        let name = app.webViews.textFields["输入名称"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap()
        name.typeText("iOS Offline")
        app.webViews.buttons["创建"].tap()
        let compile = app.webViews.buttons["编译"]
        XCTAssertTrue(compile.waitForExistence(timeout: 15))
        compile.tap()
        let pdf = app.webViews.descendants(matching: .any).matching(identifier: "PDF 第 1 页").firstMatch
        XCTAssertTrue(pdf.waitForExistence(timeout: 150), app.debugDescription)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "offline-chinese-pdf"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
        app.launch()
        let project = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "iOS Offline")).firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 30))
        project.tap()
        // WebKit exposes aria-pressed buttons as toggle controls on iOS.
        let preview = app.webViews.descendants(matching: .any).matching(identifier: "预览").firstMatch
        XCTAssertTrue(preview.waitForExistence(timeout: 15))
        preview.tap()
        XCTAssertTrue(app.webViews.descendants(matching: .any).matching(identifier: "PDF 第 1 页").firstMatch.waitForExistence(timeout: 30))
        app.webViews.buttons["导出"].tap()
        // UIDocumentPicker is a system view, separate from the web workspace.
        XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 15))
    }
}

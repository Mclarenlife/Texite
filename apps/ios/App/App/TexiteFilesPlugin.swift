import Capacitor
import Foundation
import UIKit
import UniformTypeIdentifiers

@objc(TexiteFilesPlugin)
public class TexiteFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "TexiteFilesPlugin"
    public let jsName = "TexiteFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "readProjects", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveProject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importZip", returnType: CAPPluginReturnPromise)
    ]
    private let io = DispatchQueue(label: "com.texite.ios.project-files")
    private var pickerCall: CAPPluginCall?
    private var importing = false
    private var exportDirectory: URL?

    private func directory() throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var folder = support.appendingPathComponent("TexiteProjects", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
        return folder
    }

    @objc func readProjects(_ call: CAPPluginCall) {
        io.async {
            do {
                let urls = try FileManager.default.contentsOfDirectory(at: self.directory(), includingPropertiesForKeys: nil)
                let projects: [[String: Any]] = try urls.filter { $0.pathExtension == "json" }.map { url in
                    let data = try Data(contentsOf: url)
                    guard let project = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CocoaError(.fileReadCorruptFile) }
                    return project
                }
                call.resolve(["projects": projects])
            } catch { call.reject("读取项目失败，现有文件未改动", nil, error) }
        }
    }

    @objc func saveProject(_ call: CAPPluginCall) {
        guard let project = call.getObject("project"), let id = project["id"] as? String,
              id.range(of: "^[a-zA-Z0-9-]{1,80}$", options: .regularExpression) != nil else {
            call.reject("无效项目 ID"); return
        }
        io.async {
            do {
                let data = try JSONSerialization.data(withJSONObject: project, options: [.sortedKeys])
                guard data.count <= 80 * 1024 * 1024 else { call.reject("项目超过 80 MB，请拆分项目"); return }
                let url = try self.directory().appendingPathComponent(id + ".json")
                // Atomic replacement preserves the previous file if a write fails.
                try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                call.resolve()
            } catch { call.reject("保存失败，请导出项目备份", nil, error) }
        }
    }

    @objc func importZip(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pickerCall == nil, let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else { call.reject("请先完成当前文件操作"); return }
            self.pickerCall = call
            self.importing = true
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.zip], asCopy: true)
            picker.allowsMultipleSelection = false
            picker.delegate = self
            presenter.present(picker, animated: true)
        }
    }

    @objc func exportFile(_ call: CAPPluginCall) {
        guard let encoded = call.getString("base64"), encoded.utf8.count <= 110 * 1024 * 1024,
              let data = Data(base64Encoded: encoded) else { call.reject("导出数据无效或过大"); return }
        let requested = (call.getString("name") ?? "Texite.zip").replacingOccurrences(of: "\\", with: "_")
        let name = URL(fileURLWithPath: requested).lastPathComponent
        guard !name.isEmpty, name != ".", name != ".." else { call.reject("无效文件名称"); return }
        DispatchQueue.main.async {
            guard self.pickerCall == nil, let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else { call.reject("请先关闭弹窗后再导出"); return }
            self.pickerCall = call
            self.importing = false
            self.io.async {
                do {
                    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Texite-Export-" + UUID().uuidString, isDirectory: true)
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    self.exportDirectory = folder
                    let url = folder.appendingPathComponent(name)
                    try data.write(to: url, options: .atomic)
                    DispatchQueue.main.async {
                        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
                        picker.delegate = self
                        presenter.present(picker, animated: true)
                    }
                } catch {
                    DispatchQueue.main.async { self.finish(error: error) }
                }
            }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(cancelled: true) }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard importing else { finish(); return }
        guard let url = urls.first else { finish(cancelled: true); return }
        let scoped = url.startAccessingSecurityScopedResource()
        io.async {
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 50 * 1024 * 1024 else { throw NSError(domain: "Texite", code: 1, userInfo: [NSLocalizedDescriptionKey: "支持最多 50 MB 的 ZIP"] ) }
                let data = try Data(contentsOf: url)
                guard data.count <= 50 * 1024 * 1024 else { throw CocoaError(.fileReadTooLarge) }
                DispatchQueue.main.async { self.finish(result: ["name": url.lastPathComponent, "base64": data.base64EncodedString()]) }
            } catch { DispatchQueue.main.async { self.finish(error: error) } }
        }
    }
    private func finish(cancelled: Bool = false, result: [String: Any]? = nil, error: Error? = nil) {
        let call = pickerCall
        pickerCall = nil
        if let folder = exportDirectory {
            exportDirectory = nil
            io.async { try? FileManager.default.removeItem(at: folder) }
        }
        if let error { call?.reject(error.localizedDescription, nil, error) }
        else { call?.resolve(result ?? ["cancelled": cancelled]) }
    }
}

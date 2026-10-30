import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

/// Images and files pasted into a text box. React Native's text views paste only text, and iOS
/// does not even offer Paste when the pasteboard holds just an image or a file. This teaches both
/// of them (`RCTUITextView`, multiline, and `RCTUITextField`) to offer it, and to hand what they
/// would have dropped to JavaScript as files in the temporary directory. Text pastes as before.
public class PasteFilesModule: Module {
  fileprivate static weak var current: PasteFilesModule?
  private static var installed = false

  public func definition() -> ModuleDefinition {
    Name("PasteFiles")
    Events("onPasteFiles")

    OnCreate {
      PasteFilesModule.current = self
      DispatchQueue.main.async { PasteFilesModule.install() }
    }
  }

  private static func install() {
    guard !installed else { return }
    installed = true
    for name in ["RCTUITextView", "RCTUITextField"] {
      if let cls = NSClassFromString(name) { teach(cls) }
    }
  }

  /// Wraps the class's own `canPerformAction(_:withSender:)` and `paste(_:)`: both classes define
  /// them, so replacing them on the class leaves UIKit's untouched.
  private static func teach(_ cls: AnyClass) {
    let can = #selector(UIResponder.canPerformAction(_:withSender:))
    if let method = class_getInstanceMethod(cls, can) {
      typealias Can = @convention(c) (AnyObject, Selector, Selector, Any?) -> Bool
      let original = unsafeBitCast(method_getImplementation(method), to: Can.self)
      let block: @convention(block) (AnyObject, Selector, Any?) -> Bool = { view, action, sender in
        if action == #selector(UIResponderStandardEditActions.paste(_:)), pasteboardHasFiles() { return true }
        return original(view, can, action, sender)
      }
      class_replaceMethod(cls, can, imp_implementationWithBlock(block), method_getTypeEncoding(method))
    }

    let paste = #selector(UIResponderStandardEditActions.paste(_:))
    if let method = class_getInstanceMethod(cls, paste) {
      typealias Paste = @convention(c) (AnyObject, Selector, Any?) -> Void
      let original = unsafeBitCast(method_getImplementation(method), to: Paste.self)
      let block: @convention(block) (AnyObject, Any?) -> Void = { view, sender in
        let providers = UIPasteboard.general.itemProviders.filter { fileType(of: $0) != nil }
        if providers.isEmpty || current == nil {
          original(view, paste, sender)
        } else {
          save(providers)
        }
      }
      class_replaceMethod(cls, paste, imp_implementationWithBlock(block), method_getTypeEncoding(method))
    }
  }

  /// What a pasted item is when it is a file: an image, or anything that is neither text nor a web
  /// link. Rich text from Notes or Mail carries plain text too, so it still pastes as text.
  fileprivate static func fileType(_ identifiers: [String]) -> UTType? {
    let types = identifiers.compactMap { UTType($0) }
    if let image = types.first(where: { $0.conforms(to: .image) }) { return image }
    let link = { (t: UTType) in t.conforms(to: .url) && !t.conforms(to: .fileURL) }
    if types.contains(where: { $0.conforms(to: .text) || link($0) }) { return nil }
    return types.first(where: { ($0.conforms(to: .data) || $0.conforms(to: .content)) && !$0.conforms(to: .url) })
  }

  fileprivate static func fileType(of provider: NSItemProvider) -> UTType? {
    fileType(provider.registeredTypeIdentifiers)
  }

  /// Checked by type only: reading the items themselves would ask the owner for permission each
  /// time the edit menu opens.
  fileprivate static func pasteboardHasFiles() -> Bool {
    let board = UIPasteboard.general
    return (board.types(forItemSet: nil) ?? []).contains { fileType($0) != nil }
  }

  private static func save(_ providers: [NSItemProvider]) {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("pasted", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let group = DispatchGroup()
    let lock = NSLock()
    var files: [(Int, [String: Any])] = []
    for (index, provider) in providers.enumerated() {
      guard let type = fileType(of: provider) else { continue }
      group.enter()
      provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
        defer { group.leave() }
        // The file is only there during this call: copy it out.
        guard let url else { return }
        let ext = type.preferredFilenameExtension ?? url.pathExtension
        let stem = provider.suggestedName ?? (type.conforms(to: .image) ? "Pasted image" : "Pasted file")
        let name = ext.isEmpty || stem.lowercased().hasSuffix(".\(ext.lowercased())") ? stem : "\(stem).\(ext)"
        let target = folder.appendingPathComponent("\(UUID().uuidString)-\(name)")
        guard (try? FileManager.default.copyItem(at: url, to: target)) != nil else { return }
        let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? Int) ?? 0
        let file: [String: Any] = [
          "uri": target.absoluteString,
          "name": name,
          "type": type.preferredMIMEType ?? "application/octet-stream",
          "size": size,
        ]
        lock.lock()
        files.append((index, file))
        lock.unlock()
      }
    }
    group.notify(queue: .main) {
      let ordered = files.sorted { $0.0 < $1.0 }.map { $0.1 }
      if !ordered.isEmpty { current?.sendEvent("onPasteFiles", ["files": ordered]) }
    }
  }
}

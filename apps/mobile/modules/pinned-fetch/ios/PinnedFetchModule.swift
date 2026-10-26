import CryptoKit
import ExpoModulesCore
import Foundation

/// HTTPS to the paired Mac. Its certificate is self-signed, so trust comes from its SHA-256
/// fingerprint, which the pairing invite carried, not from a certificate authority: any other
/// certificate is refused, whatever signed it. The same check as `nodePinnedFetch` on the Mac.
/// App Transport Security would refuse that certificate on a Tailscale address before this check
/// runs (only local-network addresses are exempt), so app.json turns it off: this is the check.
public class PinnedFetchModule: Module {
  private var tasks: [String: URLSessionDataTask] = [:]
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("PinnedFetch")

    AsyncFunction("request") {
      (id: String, url: String, method: String, headers: [String: String], body: String?, fingerprint: String, promise: Promise) in
      guard let target = URL(string: url), target.scheme == "https" else {
        promise.reject("E_URL", "Not an https URL: \(url)")
        return
      }
      var request = URLRequest(url: target, timeoutInterval: 30)
      request.httpMethod = method
      for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
      if let body { request.httpBody = Data(body.utf8) }

      let session = URLSession(
        configuration: .ephemeral, delegate: PinningDelegate(fingerprint: fingerprint), delegateQueue: nil)
      let task = session.dataTask(with: request) { [weak self] data, response, error in
        self?.forget(id)
        session.finishTasksAndInvalidate()
        if let error {
          promise.reject("E_FETCH", error.localizedDescription)
          return
        }
        guard let http = response as? HTTPURLResponse else {
          promise.reject("E_FETCH", "No HTTP response")
          return
        }
        var out: [String: String] = [:]
        for (name, value) in http.allHeaderFields {
          out[String(describing: name).lowercased()] = String(describing: value)
        }
        promise.resolve([
          "status": http.statusCode,
          "headers": out,
          "body": String(decoding: data ?? Data(), as: UTF8.self),
        ])
      }
      remember(id, task)
      task.resume()
    }

    Function("cancel") { (id: String) in
      self.forget(id)?.cancel()
    }

    // This iPhone's Tailscale address, when Tailscale is connected: the VPN's tunnel interface
    // carries an address in 100.64.0.0/10. Nil when it is off, so pairing can say so first.
    Function("tailnetAddress") { () -> String? in
      tailnetAddress()
    }
  }

  private func remember(_ id: String, _ task: URLSessionDataTask) {
    lock.lock()
    defer { lock.unlock() }
    tasks[id] = task
  }

  @discardableResult
  private func forget(_ id: String) -> URLSessionDataTask? {
    lock.lock()
    defer { lock.unlock() }
    return tasks.removeValue(forKey: id)
  }
}

func tailnetAddress() -> String? {
  var list: UnsafeMutablePointer<ifaddrs>?
  guard getifaddrs(&list) == 0, let first = list else { return nil }
  defer { freeifaddrs(list) }
  for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
    let entry = pointer.pointee
    guard String(cString: entry.ifa_name).hasPrefix("utun"), let address = entry.ifa_addr,
      address.pointee.sa_family == UInt8(AF_INET)
    else { continue }
    let ip = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
    if ip & 0xFFC0_0000 == 0x6440_0000 {
      return "\(ip >> 24).\((ip >> 16) & 0xFF).\((ip >> 8) & 0xFF).\(ip & 0xFF)"
    }
  }
  return nil
}

/// Accepts the server only when its leaf certificate hashes to the pinned fingerprint.
final class PinningDelegate: NSObject, URLSessionDelegate {
  private let fingerprint: String

  init(fingerprint: String) {
    // `AB:CD:…` as Node writes it, or bare hex: compared without colons, in capitals.
    self.fingerprint = fingerprint.replacingOccurrences(of: ":", with: "").uppercased()
  }

  func urlSession(
    _ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let trust = challenge.protectionSpace.serverTrust,
      let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
      let leaf = chain.first
    else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    let digest = SHA256.hash(data: SecCertificateCopyData(leaf) as Data)
    let hex = digest.map { String(format: "%02X", $0) }.joined()
    if hex == fingerprint {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }
}

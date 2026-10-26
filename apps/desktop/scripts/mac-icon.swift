import AppKit

// The app icon: the pilot from the design tokens on Claude's orange, as Claude's own icon sits.
// "mac" draws the macOS icon shape (an 824-point rounded square on a 1024 canvas, with its shadow);
// "phone" fills the square, which iOS rounds itself; "splash" is the phone's launch screen, the
// pilot small in the middle of the window's colour. Pixels kept sharp.
// Run by scripts/icon.ts (pnpm --filter @autopilot/desktop icon).
struct Art: Decodable {
  let rows: [String]
  let colours: [String: String]
  let ground: String
}

let args = CommandLine.arguments
guard args.count == 3, ["mac", "phone", "splash"].contains(args[1]),
  let art = try? JSONDecoder().decode(Art.self, from: FileHandle.standardInput.readDataToEndOfFile())
else {
  print("usage: swift mac-icon.swift <mac|phone|splash> <out.png> < pilot.json")
  exit(1)
}

func colour(_ hex: String) -> NSColor {
  let v = Int(hex.dropFirst(), radix: 16) ?? 0
  return NSColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                 blue: CGFloat(v & 0xFF) / 255, alpha: 1)
}

let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: size, height: size)
NSGraphicsContext.saveGraphicsState()
let context = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = context
context.imageInterpolation = .none

let mac = args[1] == "mac"
let tile = mac ? NSRect(x: 100, y: 100, width: 824, height: 824) : NSRect(x: 0, y: 0, width: size, height: size)

if mac {
  // The shadow every macOS icon sits on.
  NSGraphicsContext.saveGraphicsState()
  let shadow = NSShadow()
  shadow.shadowColor = NSColor(white: 0, alpha: 0.35)
  shadow.shadowBlurRadius = 24
  shadow.shadowOffset = NSSize(width: 0, height: -10)
  shadow.set()
  colour(art.ground).setFill()
  NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185).fill()
  NSGraphicsContext.restoreGraphicsState()
} else {
  colour(art.ground).setFill()
  tile.fill()
}

// The pilot, 16 cells across six tenths of the tile (three on the splash), centred.
let columns = art.rows.map(\.count).max() ?? 0
let cell = (tile.width * (args[1] == "splash" ? 0.3 : 0.6) / CGFloat(columns)).rounded()
let left = tile.midX - cell * CGFloat(columns) / 2
let top = tile.midY + cell * CGFloat(art.rows.count) / 2
for (y, row) in art.rows.enumerated() {
  for (x, key) in row.enumerated() {
    guard let hex = art.colours[String(key)] else { continue }
    colour(hex).setFill()
    NSRect(x: left + CGFloat(x) * cell, y: top - CGFloat(y + 1) * cell, width: cell, height: cell).fill()
  }
}

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("wrote \(args[2])")

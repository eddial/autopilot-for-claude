import AppKit

// The Mac app's icon, from the phone's: the pilot on Claude's light paper, as Claude's own icon
// sits, in the macOS icon shape (an 824-point rounded square on a 1024 canvas, with its shadow),
// pixels kept sharp. The phone's dark ground becomes the paper.
// swift scripts/mac-icon.swift <phone icon.png> <out.png>
let args = CommandLine.arguments
guard args.count == 3, let source = NSImage(contentsOfFile: args[1]) else {
  print("usage: swift mac-icon.swift <icon.png> <out.png>")
  exit(1)
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

let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let shape = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)

// The shadow every macOS icon sits on.
NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor(white: 0, alpha: 0.35)
shadow.shadowBlurRadius = 24
shadow.shadowOffset = NSSize(width: 0, height: -10)
shadow.set()
NSColor(srgbRed: 0xF0 / 255, green: 0xEE / 255, blue: 0xE6 / 255, alpha: 1).setFill()
shape.fill()
NSGraphicsContext.restoreGraphicsState()

// The phone's icon fills the tile: every pixel but its dark ground (the colour in its corner),
// copied across, so the pilot stands on the paper.
let phone = NSBitmapImageRep(data: source.tiffRepresentation!)!
let corner = phone.colorAt(x: 0, y: 0)!
let step = tile.width / CGFloat(phone.pixelsWide)
for y in 0..<phone.pixelsHigh {
  for x in 0..<phone.pixelsWide {
    guard let c = phone.colorAt(x: x, y: y) else { continue }
    let ground = abs(c.redComponent - corner.redComponent) + abs(c.greenComponent - corner.greenComponent)
      + abs(c.blueComponent - corner.blueComponent) < 0.006
    if ground { continue }
    c.setFill()
    NSRect(x: tile.minX + CGFloat(x) * step, y: tile.maxY - CGFloat(y + 1) * step, width: step + 0.5, height: step + 0.5).fill()
  }
}

// A hairline edge, so the light tile holds its shape on a light Dock.
NSColor(white: 0, alpha: 0.1).setStroke()
let edge = NSBezierPath(roundedRect: tile.insetBy(dx: 1, dy: 1), xRadius: 184, yRadius: 184)
edge.lineWidth = 2
edge.stroke()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("wrote \(args[2])")

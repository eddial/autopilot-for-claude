import AppKit

// The Mac app's icon, from the phone's: the pilot on the window colour in the macOS icon shape (an
// 824-point rounded square on a 1024 canvas, with its shadow), pixels kept sharp.
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
NSColor(srgbRed: 0x1F / 255, green: 0x1E / 255, blue: 0x1D / 255, alpha: 1).setFill()
shape.fill()
NSGraphicsContext.restoreGraphicsState()

// The phone's icon fills the tile; its ground is the same window colour.
NSGraphicsContext.saveGraphicsState()
shape.addClip()
source.draw(in: tile, from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()

// A hairline edge, so the dark tile holds its shape on a dark Dock.
NSColor(white: 1, alpha: 0.12).setStroke()
let edge = NSBezierPath(roundedRect: tile.insetBy(dx: 1, dy: 1), xRadius: 184, yRadius: 184)
edge.lineWidth = 2
edge.stroke()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("wrote \(args[2])")

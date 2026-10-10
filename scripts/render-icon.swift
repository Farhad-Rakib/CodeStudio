// Renders images/icon.svg to PNGs: swift scripts/render-icon.swift images/icon.svg <outDir>
import AppKit
let args = CommandLine.arguments
guard args.count == 3, let svg = NSImage(contentsOfFile: args[1]) else { fputs("cannot load svg\n", stderr); exit(1) }
for size in [128, 256, 512] {
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                                   hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSColor.clear.set()
  NSRect(x: 0, y: 0, width: size, height: size).fill()
  svg.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .sourceOver, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(args[2])/icon-\(size).png"))
}

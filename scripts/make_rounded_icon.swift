import AppKit

/*
Usage:
  1) Generate rounded source icon:
     swift scripts/make_rounded_icon.swift public/icons/1024x1024.png src-tauri/icons/app-icon-rounded-1024.png

  2) Regenerate Tauri icons (icns/ico/png):
     npm run tauri -- icon src-tauri/icons/app-icon-rounded-1024.png -o src-tauri/icons

Optional args:
  swift scripts/make_rounded_icon.swift <input.png> <output.png> [canvas] [inset] [radius] [zoom] [strength]

Arg details (all are in px):
  canvas: output canvas size, default 1024. Usually keep 1024 for app icons.
  inset:  inner margin on all 4 sides, default 80. Larger value => icon looks smaller.
  radius: rounded corner radius for the clipped icon area, default 200. Larger value => rounder corners.
  zoom:   extra manual zoom multiplier, default 1.0.
  strength: auto-compensation strength based on corner cut ratio, default 0.60.

Suggested ranges:
  inset:  48 ~ 140
  radius: 120 ~ 260
  zoom:   0.95 ~ 1.20
  strength: 0.30 ~ 0.90
*/

func parseCGFloat(_ args: [String], _ index: Int, _ defaultValue: CGFloat) -> CGFloat {
  guard args.count > index, let v = Double(args[index]) else { return defaultValue }
  return CGFloat(v)
}

func autoCompensationScale(side: CGFloat, radius: CGFloat, strength: CGFloat) -> CGFloat {
  if side <= 0 { return 1 }
  let ratio = max(0, min(radius / side, 0.5))
  let scale = 1 + max(0, strength) * ratio
  return max(1, min(scale, 1.35))
}

let args = CommandLine.arguments
if args.count < 3 {
  fputs(
    """
    Usage:
      swift scripts/make_rounded_icon.swift <input.png> <output.png> [canvas] [inset] [radius] [zoom] [strength]

    Defaults:
      canvas = 1024
      inset  = 80
      radius = 200
      zoom = 1.0
      strength = 0.60

    Argument details (px):
      canvas: output canvas size, usually keep 1024
      inset : margin from each edge; larger => icon appears smaller
      radius: corner radius; larger => rounder corners
      zoom  : extra manual zoom multiplier
      strength: auto-compensation strength for corner cut scaling

    Suggested ranges:
      inset : 48 ~ 140
      radius: 120 ~ 260
      zoom  : 0.95 ~ 1.20
      strength: 0.30 ~ 0.90

    Example:
      swift scripts/make_rounded_icon.swift public/icons/1024x1024.png src-tauri/icons/app-icon-rounded-1024.png
      npm run tauri -- icon src-tauri/icons/app-icon-rounded-1024.png -o src-tauri/icons

    More examples:
      # Keep icon slightly larger
      swift scripts/make_rounded_icon.swift in.png out.png 1024 64 180 1.0 0.60
      # Keep icon smaller with stronger rounding
      swift scripts/make_rounded_icon.swift in.png out.png 1024 110 230 1.0 0.60
      # Stronger center-content compensation
      swift scripts/make_rounded_icon.swift in.png out.png 1024 80 200 1.08 0.75
    """,
    stderr
  )
  fputs("\n", stderr)
  exit(1)
}

let inputPath = args[1]
let outputPath = args[2]
let canvas = parseCGFloat(args, 3, 1024)
let inset = parseCGFloat(args, 4, 80)
let radius = parseCGFloat(args, 5, 200)
let manualZoom = max(0.1, parseCGFloat(args, 6, 1.0))
let strength = parseCGFloat(args, 7, 0.60)

guard let sourceImage = NSImage(contentsOfFile: inputPath) else {
  fputs("Cannot load input image: \(inputPath)\n", stderr)
  exit(1)
}

guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: Int(canvas),
  pixelsHigh: Int(canvas),
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fputs("Cannot create bitmap\n", stderr)
  exit(1)
}

NSGraphicsContext.saveGraphicsState()
if let ctx = NSGraphicsContext(bitmapImageRep: bitmap) {
  NSGraphicsContext.current = ctx
  let canvasRect = NSRect(x: 0, y: 0, width: canvas, height: canvas)
  NSColor.clear.setFill()
  canvasRect.fill()

  let targetRect = NSRect(
    x: inset,
    y: inset,
    width: canvas - inset * 2,
    height: canvas - inset * 2
  )

  let clipPath = NSBezierPath(roundedRect: targetRect, xRadius: radius, yRadius: radius)
  clipPath.addClip()

  let autoZoom = autoCompensationScale(side: targetRect.width, radius: radius, strength: strength)
  let finalZoom = autoZoom * manualZoom
  let drawRect = NSRect(
    x: targetRect.midX - (targetRect.width * finalZoom) / 2,
    y: targetRect.midY - (targetRect.height * finalZoom) / 2,
    width: targetRect.width * finalZoom,
    height: targetRect.height * finalZoom
  )

  sourceImage.draw(
    in: drawRect,
    from: NSRect(x: 0, y: 0, width: sourceImage.size.width, height: sourceImage.size.height),
    operation: .sourceOver,
    fraction: 1
  )

  print(
    "Applied zoom: auto=\(String(format: "%.3f", autoZoom)) * manual=\(String(format: "%.3f", manualZoom)) = \(String(format: "%.3f", finalZoom))"
  )
}
NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
  fputs("Failed to encode PNG\n", stderr)
  exit(1)
}

do {
  try pngData.write(to: URL(fileURLWithPath: outputPath))
  print("Wrote \(outputPath)")
} catch {
  fputs("Failed to write output image: \(outputPath)\n", stderr)
  exit(1)
}

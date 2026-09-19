import Foundation
import AppKit
import CoreGraphics
import ApplicationServices

struct CursorSample: Codable {
    let timeMs: Int
    let cx: Double
    let cy: Double
    let interactionType: String?
    let cursorType: String?
}

struct CursorTelemetryFile: Codable {
    let version: Int
    let samples: [CursorSample]
}

var windowX: Double = 0
var windowY: Double = 0
var windowW: Double = 0
var windowH: Double = 0
var outputPath: String = ""

// Parse command line arguments
var args = CommandLine.arguments
var i = 1
while i < args.count {
    switch args[i] {
    case "--window-x":
        windowX = Double(args[i + 1]) ?? 0
        i += 2
    case "--window-y":
        windowY = Double(args[i + 1]) ?? 0
        i += 2
    case "--window-w":
        windowW = Double(args[i + 1]) ?? 0
        i += 2
    case "--window-h":
        windowH = Double(args[i + 1]) ?? 0
        i += 2
    case "--output":
        outputPath = args[i + 1]
        i += 2
    default:
        i += 1
    }
}

// If no window dimensions provided, use primary screen bounds
let mainDisplay = CGMainDisplayID()
let displayBounds = CGDisplayBounds(mainDisplay)
if windowW <= 0 || windowH <= 0 {
    windowX = displayBounds.origin.x
    windowY = displayBounds.origin.y
    windowW = displayBounds.width
    windowH = displayBounds.height
}

var samples: [CursorSample] = []
let sampleLock = NSLock()
let startTime = Date()

func elapsedMs() -> Int {
    return Int(Date().timeIntervalSince(startTime) * 1000)
}

func normalize(x: Double, y: Double) -> (cx: Double, cy: Double) {
    let rawCx = (x - windowX) / windowW
    let rawCy = (y - windowY) / windowH
    let cx = max(0.0, min(1.0, rawCx))
    let cy = max(0.0, min(1.0, rawCy))
    return (cx, cy)
}

// Mouse event tap for clicks
func mouseCallback(tap: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    let loc = event.location
    let time = elapsedMs()
    let (cx, cy) = normalize(x: loc.x, y: loc.y)
    
    var interaction: String? = nil
    switch type {
    case .leftMouseDown:
        interaction = "click"
    case .rightMouseDown:
        interaction = "right-click"
    case .otherMouseDown:
        interaction = "middle-click"
    case .leftMouseUp:
        interaction = "mouseup"
    default:
        break
    }
    
    if let interaction = interaction {
        sampleLock.lock()
        samples.append(CursorSample(timeMs: time, cx: cx, cy: cy, interactionType: interaction, cursorType: "arrow"))
        sampleLock.unlock()
    }
    
    return Unmanaged.passUnretained(event)
}

let eventMask = (1 << CGEventType.leftMouseDown.rawValue) |
                (1 << CGEventType.leftMouseUp.rawValue) |
                (1 << CGEventType.rightMouseDown.rawValue) |
                (1 << CGEventType.otherMouseDown.rawValue)

if let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: CGEventMask(eventMask), callback: mouseCallback, userInfo: nil) {
    let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
}

// 30Hz position sampler
let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
timer.schedule(deadline: .now(), repeating: .milliseconds(33))
timer.setEventHandler {
    guard let loc = CGEvent(source: nil)?.location else { return }
    let time = elapsedMs()
    let (cx, cy) = normalize(x: loc.x, y: loc.y)
    
    sampleLock.lock()
    // Only sample if cursor moved or every 300ms
    let last = samples.last
    if last == nil || abs(last!.cx - cx) > 0.002 || abs(last!.cy - cy) > 0.002 || (time - last!.timeMs > 300) {
        samples.append(CursorSample(timeMs: time, cx: cx, cy: cy, interactionType: "move", cursorType: "arrow"))
    }
    sampleLock.unlock()
}
timer.resume()

func saveAndExit() {
    timer.cancel()
    sampleLock.lock()
    let sortedSamples = samples.sorted { $0.timeMs < $1.timeMs }
    sampleLock.unlock()
    
    if !outputPath.isEmpty {
        let file = CursorTelemetryFile(version: 1, samples: sortedSamples)
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        if let data = try? encoder.encode(file) {
            try? data.write(to: URL(fileURLWithPath: outputPath))
            print("TELEMETRY_SAVED:\(sortedSamples.count)")
            fflush(stdout)
        }
    }
    exit(0)
}

// Handle signals
signal(SIGINT) { _ in saveAndExit() }
signal(SIGTERM) { _ in saveAndExit() }

// Read stdin for "stop"
DispatchQueue.global(qos: .utility).async {
    while let line = readLine(strippingNewline: true)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        if line == "stop" {
            saveAndExit()
        }
    }
    saveAndExit()
}

print("TRACKER_STARTED")
fflush(stdout)

RunLoop.main.run()

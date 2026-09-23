import CoreGraphics
import ApplicationServices
import Foundation

let permissions: [String: Bool] = [
    "screenRecording": CGPreflightScreenCaptureAccess(),
    "accessibility": AXIsProcessTrusted(),
]
let data = try JSONSerialization.data(withJSONObject: permissions, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))

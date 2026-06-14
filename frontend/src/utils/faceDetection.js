/*
 * Browser-side face detection for identity verification.
 *
 * FULLY SELF-HOSTED — zero external dependencies:
 *   - JS API:  @mediapipe/tasks-vision (npm) → bundled by Vite, served from app origin,
 *              loaded via dynamic import() so it stays a lazy runtime chunk.
 *   - WASM:    /public/mediapipe/wasm/*           (served from app origin)
 *   - Model:   /public/mediapipe/blaze_face_short_range.tflite  (served from app origin)
 *
 * No runtime requests to cdn.jsdelivr.net, storage.googleapis.com, or any third party.
 *
 * PRIVACY: detection runs entirely in browser memory on the live <video> frames.
 * Nothing is captured, uploaded, or stored — we only read detections.length.
 */

// BASE_URL is "/" by default; using it keeps paths correct even under a sub-path deploy.
const BASE = import.meta.env.BASE_URL || "/";
const WASM_PATH  = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}mediapipe/blaze_face_short_range.tflite`;

let detectorPromise = null;

// Load (once) and return a VIDEO-mode FaceDetector. Throws if local assets are missing.
export function loadFaceDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
    });
    try { return await FaceDetector.createFromOptions(fileset, opts("GPU")); }
    catch { return await FaceDetector.createFromOptions(fileset, opts("CPU")); } // GPU unavailable → CPU
  })();
  detectorPromise.catch(() => { detectorPromise = null; }); // allow retry after a failed load
  return detectorPromise;
}

// Returns the number of faces in the current video frame, or null if not ready.
export function detectFaceCount(detector, video, tsMs) {
  if (!detector || !video || video.readyState < 2 || !video.videoWidth) return null;
  try {
    const res = detector.detectForVideo(video, tsMs);
    return res?.detections?.length ?? 0;
  } catch {
    return null;
  }
}

export const FACE_MESSAGES = {
  none:  "No face detected. Please position your face clearly in front of the camera.",
  multi: "Multiple faces detected. Only the candidate should be visible during verification.",
};

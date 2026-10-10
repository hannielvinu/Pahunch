// On-device object detection (MediaPipe Tasks Vision, EfficientDet-Lite0 int8, 4.4 MB, COCO classes).
// Runs on the live camera several times a second; boxes are drawn by the overlay so the rider (and the jury)
// can see what the phone recognises: people, vehicles, doors' surroundings, shop objects.

const here = (p) => new URL(p, location.href).href;

export class Detector {
  constructor(video) {
    this.video = video;
    this.det = null;
    this.ready = false;
    this.ms = 0;
    this.delegate = null;
    this.last = [];
  }

  async load() {
    if (this.ready) return;
    const { FilesetResolver, ObjectDetector } = await import('../lib/mediapipe/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(here('lib/mediapipe/wasm'));
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: here('lib/detector/efficientdet_lite0.tflite'), delegate },
      runningMode: 'VIDEO', scoreThreshold: 0.35, maxResults: 10,
    });
    try {
      this.det = await ObjectDetector.createFromOptions(files, opts('GPU'));
      this.delegate = 'GPU';
    } catch {
      this.det = await ObjectDetector.createFromOptions(files, opts('CPU'));
      this.delegate = 'CPU';
    }
    this.ready = true;
  }

  // -> [{ label, score, x, y, w, h }] with x/y/w/h as fractions of the camera frame.
  detect() {
    const v = this.video;
    if (!this.ready || !v.videoWidth || v.readyState < 2) return this.last;
    const t0 = performance.now();
    const res = this.det.detectForVideo(v, t0);
    this.ms = Math.round(performance.now() - t0);
    const W = v.videoWidth, H = v.videoHeight;
    this.last = (res.detections || []).map((d) => {
      const b = d.boundingBox, c = d.categories[0];
      return { label: c.categoryName || c.displayName || 'object', score: c.score, x: b.originX / W, y: b.originY / H, w: b.width / W, h: b.height / H };
    });
    return this.last;
  }
}

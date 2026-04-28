/**
 * handTracker.js 
 * ─────────────────────────────────────────────────────
 */
class HandTracker {
  constructor(videoEl, videoCanvas, options = {}) {
    this.video = videoEl;
    this.vcanvas = videoCanvas;
    this.vctx = videoCanvas.getContext('2d', { alpha: false });

    this.cbs = [];
    this.running = false;
    this.showFeed = true;
    this.feedAlpha = options.feedAlpha ?? 0.22;
    this.dpr = options.dpr ?? 1;

    this.cfg = {
      maxNumHands: 1,
      modelComplexity: options.fast ? 0 : 1,
      minDetectionConfidence: 0.72,
      minTrackingConfidence: 0.65,
    };
    this.camW = options.w ?? 1280;
    this.camH = options.h ?? 720;

    this._hands = null;
    this._camera = null;
    this._rvfcId = null;
    this._rafId = null;

    // Physical canvas dimensions (set in start/resize)
    this._physW = 0;
    this._physH = 0;
  }

  onResults(cb) { this.cbs.push(cb); return this; }

  async start(onProgress) {
    await this._initMP(onProgress);
    await this._startCam();
    this.running = true;
    this._startVideoLoop();
  }

  stop() {
    this.running = false;
    if (this._camera) this._camera.stop();
    if (this._rvfcId) this.video.cancelVideoFrameCallback(this._rvfcId);
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  setFeed(v) { this.showFeed = v; }
  setAlpha(v) { this.feedAlpha = v; }

  /* ─── Update physical canvas dimensions ─────────── */
  updateSize(physW, physH) {
    this._physW = physW;
    this._physH = physH;
  }

  /* ─── Video render loop ─────────────────────────────
   * Draws the video feed mirrored into the video canvas.
   * Canvas is at physical pixel size (e.g., 3840×2160 on 2K screen).
   * We draw directly at physical size — no DPR division needed
   * because getContext('2d') context is at raw pixel space
   * (no setTransform applied to vctx).
   */
  _startVideoLoop() {
    const drawFrame = () => {
      if (!this.running) return;

      const ctx = this.vctx;
      const W = this.vcanvas.width;   // physical px
      const H = this.vcanvas.height;  // physical px

      if (this.showFeed && this.video.readyState >= 2) {
        // Clear first to avoid ghosting
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.globalAlpha = this.feedAlpha;
        // Mirror horizontally: translate to right edge then scale -1
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
        // Draw video stretched to physical canvas size
        ctx.drawImage(this.video, 0, 0, W, H);
        ctx.restore();
      } else if (!this.showFeed) {
        ctx.clearRect(0, 0, W, H);
      }

      if ('requestVideoFrameCallback' in this.video) {
        this._rvfcId = this.video.requestVideoFrameCallback(drawFrame);
      } else {
        this._rafId = requestAnimationFrame(drawFrame);
      }
    };

    if ('requestVideoFrameCallback' in this.video) {
      this._rvfcId = this.video.requestVideoFrameCallback(drawFrame);
    } else {
      this._rafId = requestAnimationFrame(drawFrame);
    }
  }

  /* ─── MediaPipe init ─────────────────────────────── */
  _initMP(onProgress) {
    return new Promise((resolve, reject) => {
      this._hands = new Hands({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}`,
      });
      this._hands.setOptions(this.cfg);
      this._hands.onResults(r => this._dispatch(r));

      if (onProgress) {
        onProgress(0.2);
        setTimeout(() => onProgress(0.5), 700);
        setTimeout(() => onProgress(0.82), 1500);
      }
      this._hands.initialize()
        .then(() => { onProgress?.(1.0); resolve(); })
        .catch(reject);
    });
  }

  _startCam() {
    return new Promise((resolve, reject) => {
      this._camera = new Camera(this.video, {
        onFrame: async () => {
          if (this._hands && this.running)
            await this._hands.send({ image: this.video });
        },
        width: this.camW, height: this.camH, facingMode: 'user',
      });
      this._camera.start().then(resolve).catch(reject);
    });
  }

  _dispatch(r) {
    const p = {
      multiHandLandmarks: r.multiHandLandmarks ?? [],
      multiHandedness: r.multiHandedness ?? [],
      landmarks: r.multiHandLandmarks?.[0] ?? null,
      handedness: r.multiHandedness?.[0] ?? null,
    };
    for (const cb of this.cbs) { try { cb(p); } catch (e) { console.error(e); } }
  }
}

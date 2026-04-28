/**
 * canvasManager.js 
 * ─────────────────────────────────────────────────
 */
class CanvasManager {
  constructor(canvas, dpr = 1) {
    this.canvas = canvas;
    this.dpr = dpr;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });

    this.drawing = false;
    this.erasing = false;
    this.pts = [];

    this.history = [];
    this.hidx = -1;
    this.maxH = 50;

    this.S = {
      color: '#00d4ff', size: 8, glow: 28,
      opacity: 1.0, style: 'solid', blend: 'source-over',
    };
    this.eraserR = 30;

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  /* ─── Resize ─────────────────────────────────────── */
  resize(logicalW, logicalH, newDpr) {
    if (newDpr !== undefined) this.dpr = newDpr;

    const snap = this.canvas.width > 1
      ? this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
      : null;

    this.canvas.width = Math.round(logicalW * this.dpr);
    this.canvas.height = Math.round(logicalH * this.dpr);
    this.canvas.style.width = logicalW + 'px';
    this.canvas.style.height = logicalH + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    if (snap) this.ctx.putImageData(snap, 0, 0);
  }

  /* ─── Stroke ─────────────────────────────────────── */
  startStroke(x, y) {
    this._snap();
    this.drawing = true;
    this.pts = [{ x, y }];
    this._brush();
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
  }

  continueStroke(x, y) {
    if (!this.drawing) return;
    const prev = this.pts[this.pts.length - 1];
    if (!prev) { this.pts.push({ x, y }); return; }

    const dist = Math.hypot(x - prev.x, y - prev.y);

    if (dist > 2) {
      // ── FIX: call _drawTail() after EACH interpolated point ──
      // Previously _drawTail() was called only once after the whole
      // loop, so intermediate Catmull-Rom segments were never drawn,
      // producing visible gaps / dotted appearance.
      const steps = Math.ceil(dist / 2);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this.pts.push({
          x: prev.x + (x - prev.x) * t,
          y: prev.y + (y - prev.y) * t,
        });
        this._drawTail(); // ← one segment per sub-point, not one total
      }
    } else {
      this.pts.push({ x, y });
      this._drawTail();  // ← was missing for the non-interpolated path
    }
  }

  endStroke() {
    if (!this.drawing) return;
    const p = this.pts[this.pts.length - 1];
    if (p) {
      this.ctx.lineTo(p.x, p.y);
      this.ctx.stroke();
    }
    this.drawing = false;
    this.pts = [];
  }

  /* ─── Catmull-Rom → cubic Bézier ────────────────── */
  _drawTail() {
    const n = this.pts.length;
    if (n < 2) return;

    if (n < 4) {
      const p0 = this.pts[n - 2], p1 = this.pts[n - 1];
      this.ctx.beginPath();
      this.ctx.moveTo(p0.x, p0.y);
      this.ctx.lineTo(p1.x, p1.y);
      this.ctx.stroke();
      this._brightCore(p0.x, p0.y, p1.x, p1.y, 0, 0, 0, 0, false);
      return;
    }

    const p0 = this.pts[n - 4];
    const p1 = this.pts[n - 3];
    const p2 = this.pts[n - 2];
    const p3 = this.pts[n - 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    this.ctx.beginPath();
    this.ctx.moveTo(p1.x, p1.y);
    this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    this.ctx.stroke();
    this._brightCore(p1.x, p1.y, p2.x, p2.y, cp1x, cp1y, cp2x, cp2y, true);
  }

  /* ─── Eraser ─────────────────────────────────────── */
  startErase(x, y) { this._snap(); this.erasing = true; this._erase(x, y); }
  continueErase(x, y) { if (this.erasing) this._erase(x, y); }
  endErase() { this.erasing = false; }

  _erase(x, y) {
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.eraserR, 0, Math.PI * 2);
    this.ctx.fillStyle = 'rgba(0,0,0,1)';
    this.ctx.fill();
    this.ctx.restore();
  }

  /* ─── Brush setup ────────────────────────────────── */
  _brush() {
    const ctx = this.ctx, S = this.S;
    ctx.globalAlpha = S.opacity;
    ctx.globalCompositeOperation = S.blend;
    ctx.strokeStyle = S.color;
    ctx.lineWidth = S.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (S.style === 'glow') {
      ctx.shadowBlur = S.glow * 4.5;
      ctx.shadowColor = S.color;
    } else {
      // Solid/dashed/dotted: use a stronger glow so strokes are clearly visible
      ctx.shadowBlur = S.glow * 2;
      ctx.shadowColor = S.color;
    }

    switch (S.style) {
      case 'dashed': ctx.setLineDash([S.size * 3.5, S.size * 1.8]); break;
      case 'dotted': ctx.setLineDash([2, S.size * 2]); break;
      default: ctx.setLineDash([]);
    }
  }

  /* ─── Draw a bright inner-core pass over a segment ── */
  // Renders a thin, fully-opaque white-tinted line on top of the coloured
  // stroke so it reads as luminous even on bright backgrounds.
  _brightCore(x1, y1, x2, y2, cp1x, cp1y, cp2x, cp2y, isBezier) {
    const ctx = this.ctx, S = this.S;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(S.opacity * 0.55, 0.55);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(S.size * 0.30, 1.2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (isBezier) {
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
    } else {
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ─── History ────────────────────────────────────── */
  _snap() {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const snap = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.history = this.history.slice(0, this.hidx + 1);
    this.history.push(snap);
    if (this.history.length > this.maxH) this.history.shift();
    this.hidx = this.history.length - 1;
  }

  _restore(snap) {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.putImageData(snap, 0, 0);
    this.ctx.restore();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  undo() {
    if (this.hidx <= 0) {
      this.ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
      this.history = []; this.hidx = -1; return;
    }
    this.hidx--;
    this._restore(this.history[this.hidx]);
  }

  redo() {
    if (this.hidx >= this.history.length - 1) return;
    this.hidx++;
    this._restore(this.history[this.hidx]);
  }

  clear() {
    this._snap();
    this.ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
  }

  /* ─── Setters ────────────────────────────────────── */
  setColor(c) { this.S.color = c; }
  setSize(n) { this.S.size = n; this.eraserR = Math.max(n * 3.5, 30); }
  setGlow(n) { this.S.glow = n; }
  setOpacity(n) { this.S.opacity = n; }
  setStyle(s) { this.S.style = s; }
  setBlend(m) { this.S.blend = m; }

  /* ─── Export ─────────────────────────────────────── */
  export(extraCanvases = [], filename = 'airsketch.png') {
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const oc = out.getContext('2d');

    oc.fillStyle = '#030308';
    oc.fillRect(0, 0, out.width, out.height);
    oc.drawImage(this.canvas, 0, 0);

    for (const c of extraCanvases) oc.drawImage(c, 0, 0);

    const url = out.toDataURL('image/png');
    Object.assign(document.createElement('a'), { href: url, download: filename }).click();
    return url;
  }

  getLogicalSize() {
    return {
      w: this.canvas.width / this.dpr,
      h: this.canvas.height / this.dpr,
    };
  }
}

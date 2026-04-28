/**
 * textManager.js 
 * ─────────────────────────────────────────────────
 * TEXT IS ON ITS OWN CANVAS LAYER (c-text).
 * ─────────────────────────────────────────────────
 */
class TextManager {
  constructor(textCanvas, dpr = 1) {
    this.canvas = textCanvas;
    this.dpr = dpr;
    this.ctx = textCanvas.getContext('2d');

    this.items = [];
    this.nextId = 1;
    this.dragId = null;
    this.dragOff = { x: 0, y: 0 };

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ─── Resize ─────────────────────────────────────── */
  resize(lw, lh, newDpr) {
    if (newDpr !== undefined) this.dpr = newDpr;
    this.canvas.width = Math.round(lw * this.dpr);
    this.canvas.height = Math.round(lh * this.dpr);
    this.canvas.style.width = lw + 'px';
    this.canvas.style.height = lh + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.renderAll();
  }

  /* ─── Add ────────────────────────────────────────── */
  add(x, y, content, opts = {}) {
    this.items.push({
      id: this.nextId++,
      x, y,
      content: content.trim() || 'Text',
      font: opts.font || 'Chakra Petch',
      size: opts.size || 64,
      color: opts.color || '#ffffff',
      selected: false,
    });
    this.renderAll();
  }

  /* ─── Grab: exact hit then nearest-fallback ──────── */
  tryGrab(x, y) {
    this.items.forEach(i => i.selected = false);

    // 1) Exact hit test
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const bb = this._bb(item);
      if (x >= bb.l && x <= bb.r && y >= bb.t && y <= bb.b) {
        return this._grab(item, x, y);
      }
    }

    // 2) Nearest within 120 logical px (handles gesture jitter)
    let best = null, bestDist = 120;
    for (const item of this.items) {
      const cx = item.x + this._measureWidth(item) / 2;
      const cy = item.y - item.size / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestDist) { bestDist = d; best = item; }
    }
    if (best) return this._grab(best, x, y);

    this.renderAll();
    return false;
  }

  _grab(item, x, y) {
    item.selected = true;
    this.dragId = item.id;
    this.dragOff = { x: x - item.x, y: y - item.y };
    this.renderAll();
    return true;
  }

  moveDrag(x, y) {
    if (!this.dragId) return false;
    const item = this._find(this.dragId);
    if (!item) return false;
    item.x = x - this.dragOff.x;
    item.y = y - this.dragOff.y;
    this.renderAll();
    return true;
  }

  endDrag() {
    if (this.dragId) {
      const item = this._find(this.dragId);
      if (item) item.selected = false;
      this.dragId = null;
      this.renderAll();
    }
  }

  isDragging() { return this.dragId !== null; }

  /* ─── Render ─────────────────────────────────────── */
  renderAll() {
    const ctx = this.ctx;
    const lw = this.canvas.width / this.dpr;
    const lh = this.canvas.height / this.dpr;
    ctx.clearRect(0, 0, lw, lh);
    for (const item of this.items) this._draw(ctx, item);
  }

  _draw(ctx, item) {
    ctx.save();
    ctx.font = `bold ${item.size}px '${item.font}', sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
    ctx.fillStyle = item.color;

    // Outer glow pass
    ctx.shadowBlur = 22;
    ctx.shadowColor = item.color;
    ctx.fillText(item.content, item.x, item.y);

    // Sharp inner pass
    ctx.shadowBlur = 5;
    ctx.fillText(item.content, item.x, item.y);

    // Selection overlay
    if (item.selected) {
      const bb = this._bb(item);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.shadowBlur = 0;
      ctx.strokeRect(bb.l, bb.t, bb.r - bb.l, bb.b - bb.t);

      ctx.setLineDash([]);
      ctx.fillStyle = '#00d4ff';
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#00d4ff';
      const corners = [[bb.l, bb.t], [bb.r, bb.t], [bb.l, bb.b], [bb.r, bb.b]];
      for (const [cx, cy] of corners) {
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ─── Bounding box (enlarged pad = 40px) ────────── */
  _bb(item) {
    const w = this._measureWidth(item);
    const pad = 40;   // was 10 — larger = easier to grab
    return {
      l: item.x - pad,
      r: item.x + w + pad,
      t: item.y - item.size - pad,
      b: item.y + pad,
    };
  }

  _measureWidth(item) {
    this.ctx.save();
    this.ctx.font = `bold ${item.size}px '${item.font}', sans-serif`;
    const w = this.ctx.measureText(item.content).width;
    this.ctx.restore();
    return w;
  }

  _find(id) { return this.items.find(i => i.id === id) || null; }
  remove(id) { this.items = this.items.filter(i => i.id !== id); this.renderAll(); }
  clear() { this.items = []; this.dragId = null; this.renderAll(); }
}

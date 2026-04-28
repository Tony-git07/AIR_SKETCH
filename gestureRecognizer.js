/**
 * gestureRecognizer.js 
 * ─────────────────────────────────────────────────
 */

const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

const G = {
  NONE: 'NONE', UNKNOWN: 'UNKNOWN',
  DRAW: 'DRAW', ERASE: 'ERASE', PINCH: 'PINCH',
  FIST: 'FIST', OPEN_PALM: 'OPEN_PALM',
  THUMB_UP: 'THUMB_UP', CROSS: 'CROSS',
};

/* ── Exponential Moving Average ──────────────────── */
class EMA {
  constructor(a = 0.45) { this.a = a; this.v = null; }
  push(p) {
    if (!this.v) { this.v = { x: p.x, y: p.y, z: p.z || 0 }; return { ...this.v }; }
    this.v.x += this.a * (p.x - this.v.x);
    this.v.y += this.a * (p.y - this.v.y);
    this.v.z += this.a * ((p.z || 0) - this.v.z);
    return { ...this.v };
  }
  reset() { this.v = null; }
}

/* ── Majority-vote filter (window = 4) ──────────── */
class VoteFilter {
  constructor(n = 4) { this.n = n; this.buf = []; }
  push(g) {
    this.buf.push(g);
    if (this.buf.length > this.n) this.buf.shift();
    const freq = {};
    for (const x of this.buf) freq[x] = (freq[x] || 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    return top[1] >= 2 ? top[0] : g;
  }
  reset() { this.buf = []; }
}

class GestureRecognizer {
  constructor() {
    this.iEMA = new EMA(0.45);  // index tip
    this.tEMA = new EMA(0.45);  // thumb tip
    this.mEMA = new EMA(0.45);  // middle tip
    this.wEMA = new EMA(0.28);  // wrist (slower — less jitter)
    this.vote = new VoteFilter(4);
    this.last = G.NONE;
  }

  recognize(lms, handedness) {
    if (!lms || lms.length < 21) {
      this.iEMA.reset(); this.vote.reset();
      return this._empty();
    }

    const indexTip = this.iEMA.push(lms[LM.INDEX_TIP]);
    const thumbTip = this.tEMA.push(lms[LM.THUMB_TIP]);
    const middleTip = this.mEMA.push(lms[LM.MIDDLE_TIP]);
    const wrist = this.wEMA.push(lms[LM.WRIST]);

    const isRight = handedness?.label === 'Right';
    const ext = this._ext(lms, isRight);
    const raw = this._classify(ext, lms);
    const gesture = this.vote.push(raw);
    this.last = gesture;

    // Palm center: average of palm base landmarks (0,5,9,13,17)
    const palmLMs = [0, 5, 9, 13, 17].map(i => lms[i]);
    const palmCenter = {
      x: palmLMs.reduce((s, p) => s + p.x, 0) / palmLMs.length,
      y: palmLMs.reduce((s, p) => s + p.y, 0) / palmLMs.length,
      z: palmLMs.reduce((s, p) => s + (p.z || 0), 0) / palmLMs.length,
    };

    return {
      gesture, raw, ext,
      indexTip, thumbTip, middleTip, wrist,
      palmCenter,
      lms, hand: handedness?.label ?? '?',
      pinchDist: d2(lms[LM.THUMB_TIP], lms[LM.INDEX_TIP]),
      isRight,
    };
  }

  _empty() {
    return {
      gesture: G.NONE, raw: G.NONE, ext: {},
      indexTip: null, thumbTip: null, middleTip: null,
      wrist: null, palmCenter: null,
      lms: null, hand: null, pinchDist: 1, isRight: false,
    };
  }

  _ext(lm, isRight) {
    // Thumb: tip must be clearly lateral to MCP
    const thumbExt = isRight
      ? lm[LM.THUMB_TIP].x < lm[LM.THUMB_MCP].x - 0.025
      : lm[LM.THUMB_TIP].x > lm[LM.THUMB_MCP].x + 0.025;

    const thr = 0.035; // index must be clearly above PIP
    return {
      thumb: thumbExt,
      index: lm[LM.INDEX_TIP].y < lm[LM.INDEX_PIP].y - thr,
      middle: lm[LM.MIDDLE_TIP].y < lm[LM.MIDDLE_PIP].y - thr,
      ring: lm[LM.RING_TIP].y < lm[LM.RING_PIP].y - thr,
      pinky: lm[LM.PINKY_TIP].y < lm[LM.PINKY_PIP].y - thr,
    };
  }

  _classify(ext, lm) {
    const { thumb, index, middle, ring, pinky } = ext;

    // Pinch check first (overrides all)
    if (d2(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) < 0.06) return G.PINCH;

    const n = [thumb, index, middle, ring, pinky].filter(Boolean).length;

    if (n === 0) return G.FIST;

    // Open palm: all 5 + generous spread
    if (n === 5) {
      const spread = d2(lm[LM.INDEX_TIP], lm[LM.PINKY_TIP]);
      return spread > 0.12 ? G.OPEN_PALM : G.UNKNOWN;
    }

    // Draw: only index extended
    if (!thumb && index && !middle && !ring && !pinky) return G.DRAW;

    // Erase / Cross: index + middle
    if (!thumb && index && middle && !ring && !pinky) {
      const dx = Math.abs(lm[LM.INDEX_TIP].x - lm[LM.MIDDLE_TIP].x);
      return dx < 0.025 ? G.CROSS : G.ERASE;
    }

    // Thumb up: only thumb
    if (thumb && !index && !middle && !ring && !pinky) return G.THUMB_UP;

    return G.UNKNOWN;
  }
}

function d2(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

const GESTURES = G;

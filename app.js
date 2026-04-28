/**
 * app.js -- Main pipeline
 * ─────────────────────────────────────────────────
 */

(async function () {

  /* ═══════════════════════════════════════════════
     0.  CANVAS SETUP  (DPR-aware = 2K support)
  ═══════════════════════════════════════════════ */
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const camEl = document.getElementById('cam');
  const cVideo = document.getElementById('c-video');
  const cDraw = document.getElementById('c-draw');
  const cText = document.getElementById('c-text');
  const cOverlay = document.getElementById('c-overlay');

  const oCtx = cOverlay.getContext('2d');

  function resizeAll() {
    const LW = window.innerWidth, LH = window.innerHeight;

    cVideo.style.width = LW + 'px';
    cVideo.style.height = LH + 'px';
    cVideo.width = Math.round(LW * DPR);
    cVideo.height = Math.round(LH * DPR);
    tracker.updateSize(cVideo.width, cVideo.height);

    cOverlay.style.width = LW + 'px';
    cOverlay.style.height = LH + 'px';
    cOverlay.width = Math.round(LW * DPR);
    cOverlay.height = Math.round(LH * DPR);
    oCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

    draw.resize(LW, LH, DPR);
    text.resize(LW, LH, DPR);

    ui.setRes(`${Math.round(LW * DPR)}×${Math.round(LH * DPR)}`);
  }

  /* ═══════════════════════════════════════════════
     1.  MODULES
  ═══════════════════════════════════════════════ */
  const ui = new UIManager();
  const draw = new CanvasManager(cDraw, DPR);
  const text = new TextManager(cText, DPR);
  const rec = new GestureRecognizer();
  const tracker = new HandTracker(camEl, cVideo, {
    dpr: DPR, w: 1280, h: 720, feedAlpha: 0.20,
    fast: false,
  });

  /* ═══════════════════════════════════════════════
     2.  STATE
  ═══════════════════════════════════════════════ */
  const S = {
    tool: 'draw',
    gesture: 'NONE',

    drawQ: [],
    eraseQ: [],

    stroking: false,
    erasing: false,

    thumbCD: 0,
    undoCD: 0,
    crossStart: 0,

    result: null,
    hasHand: false,

    // ── Cursor lerp ──────────────────────────────
    cx: -100, cy: -100,
    tx: -100, ty: -100,

    palmX: -100, palmY: -100,
    palmGrabbed: false,

    // ── Grace-period timestamps (v4.1) ───────────
    // lastDrawPush: last time a point was queued for drawing.
    // lastHandSeen: last time a valid hand frame arrived.
    // Strokes are NOT ended until these are stale by GRACE_MS.
    lastDrawPush: 0,
    lastHandSeen: 0,
  };

  // How long (ms) to wait before ending a stroke after
  // the draw queue goes dry or the hand disappears.
  const GRACE_MS = 120;

  /* ═══════════════════════════════════════════════
     3.  COORD HELPERS
  ═══════════════════════════════════════════════ */
  function toLogical(lm) {
    return {
      x: (1 - lm.x) * window.innerWidth,
      y: lm.y * window.innerHeight,
    };
  }

  /* ═══════════════════════════════════════════════
     4.  LANDMARK OVERLAY
  ═══════════════════════════════════════════════ */
  const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17], [0, 5], [5, 9], [9, 13],
  ];
  const GCOL = {
    DRAW: '#00d4ff', ERASE: '#ff0080', PINCH: '#ff6600',
    FIST: '#444466', OPEN_PALM: '#cc44ff', THUMB_UP: '#aaff00',
    CROSS: '#ffee00', UNKNOWN: '#888', NONE: '#888',
  };

  function drawOverlay(lms, gesture) {
    const LW = window.innerWidth, LH = window.innerHeight;
    oCtx.clearRect(0, 0, LW, LH);
    if (!lms) return;

    const col = GCOL[gesture] || '#fff';
    const TIPS = [4, 8, 12, 16, 20];

    oCtx.save();

    oCtx.strokeStyle = col;
    oCtx.lineWidth = 1.6;
    oCtx.globalAlpha = 0.45;
    oCtx.shadowBlur = 6;
    oCtx.shadowColor = col;
    for (const [a, b] of CONNECTIONS) {
      const pa = toLogical(lms[a]), pb = toLogical(lms[b]);
      oCtx.beginPath();
      oCtx.moveTo(pa.x, pa.y);
      oCtx.lineTo(pb.x, pb.y);
      oCtx.stroke();
    }

    oCtx.globalAlpha = 1;
    oCtx.shadowBlur = 0;
    for (let i = 0; i < lms.length; i++) {
      const p = toLogical(lms[i]);
      const isTip = TIPS.includes(i);
      oCtx.beginPath();
      oCtx.arc(p.x, p.y, isTip ? 4.5 : 2.5, 0, Math.PI * 2);
      oCtx.fillStyle = isTip ? '#fff' : col;
      oCtx.shadowBlur = isTip ? 10 : 4;
      oCtx.shadowColor = col;
      oCtx.fill();
    }

    oCtx.globalAlpha = 0.92;
    oCtx.shadowBlur = 18;
    oCtx.shadowColor = col;
    oCtx.strokeStyle = '#fff';
    oCtx.lineWidth = 1.6;
    oCtx.beginPath();
    oCtx.arc(S.cx, S.cy, 14, 0, Math.PI * 2);
    oCtx.stroke();

    oCtx.beginPath();
    oCtx.arc(S.cx, S.cy, 4, 0, Math.PI * 2);
    oCtx.fillStyle = col;
    oCtx.shadowBlur = 10;
    oCtx.fill();

    oCtx.restore();
  }

  /* ═══════════════════════════════════════════════
     5.  MAIN rAF LOOP — locked to 60 fps
         ─────────────────────────────────────────
         FIX 1: Target frame interval = 1000/60 ≈ 16.67ms.
         Any rAF callback that arrives before that threshold
         is skipped with an early return, so the loop
         reliably runs at ~60fps on 120/144Hz displays.

         FIX 2: ui.tickFPS() is called here (render loop),
         not in the MediaPipe callback, so the counter
         reflects true render fps.

         FIX 3: Stroke end uses a grace period — if the
         draw queue is empty but GRACE_MS hasn't elapsed
         since the last push, we keep the stroke open.
         This bridges the natural gap between successive
         MediaPipe frames and stops the stroke from being
         split into disconnected dots/dashes.
  ═══════════════════════════════════════════════ */
  const TARGET_MS = 1000 / 60;   // ≈ 16.667 ms
  let _lastFrameTs = 0;

  function mainLoop(ts) {
    requestAnimationFrame(mainLoop);

    // ── 60fps cap: skip this frame if too soon ────
    const elapsed = ts - _lastFrameTs;
    if (elapsed < TARGET_MS - 0.5) return;       // too early — skip
    _lastFrameTs = ts - (elapsed % TARGET_MS);    // stay phase-aligned

    // ── FPS counter (now in render loop) ─────────
    ui.tickFPS();

    // ── Cursor lerp ───────────────────────────────
    const LERP = 0.35;
    S.cx += (S.tx - S.cx) * LERP;
    S.cy += (S.ty - S.cy) * LERP;

    const now = performance.now();

    // ── Drain draw queue ──────────────────────────
    if (S.drawQ.length > 0) {
      const pts = S.drawQ.splice(0);
      for (const pt of pts) {
        if (!S.stroking) {
          draw.startStroke(pt.x, pt.y);
          S.stroking = true;
        } else {
          draw.continueStroke(pt.x, pt.y);
        }
      }
    } else if (S.stroking) {
      // FIX 3: only end the stroke after GRACE_MS of no new points
      // (covers both hand-tracking blips and natural MP frame gaps)
      const sinceLastPush = now - S.lastDrawPush;
      const gestureEnded = S.gesture !== 'DRAW';
      const handLost = !S.hasHand && (now - S.lastHandSeen) > GRACE_MS;

      if (gestureEnded && (sinceLastPush > GRACE_MS || handLost)) {
        draw.endStroke();
        S.stroking = false;
      }
    }

    // ── Drain erase queue ─────────────────────────
    if (S.eraseQ.length > 0) {
      const pts = S.eraseQ.splice(0);
      for (const pt of pts) {
        if (!S.erasing) {
          draw.startErase(pt.x, pt.y);
          S.erasing = true;
        } else {
          draw.continueErase(pt.x, pt.y);
        }
      }
    } else if (S.erasing && S.gesture !== 'ERASE') {
      draw.endErase();
      S.erasing = false;
    }

    // ── Overlay ───────────────────────────────────
    if (S.hasHand && S.result) {
      drawOverlay(S.result.lms, S.result.gesture);
    } else {
      oCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  /* ═══════════════════════════════════════════════
     6.  MEDIAPIPE RESULTS HANDLER
         Runs at ~20-30fps (MP rate).
         Just updates state + queues — rendering is
         handled by the 60fps rAF loop above.
  ═══════════════════════════════════════════════ */
  tracker.onResults((data) => {
    // NOTE: tickFPS() removed from here — moved to rAF loop (fix 2)

    if (!data.landmarks) {
      // FIX 4: record when we last had a hand, not just a flag.
      // The rAF loop uses lastHandSeen for the stroke grace period.
      if (S.hasHand) S.lastHandSeen = performance.now();
      S.hasHand = false;
      S.result = null;
      S.gesture = 'NONE';
      S.drawQ = [];
      S.eraseQ = [];
      // Don't immediately kill the stroke — let the grace period
      // in mainLoop decide (covers single-frame tracking drops).
      // But DO end erase immediately (no grace needed).
      if (S.erasing) { draw.endErase(); S.erasing = false; }
      if (text.isDragging()) text.endDrag();
      ui.setHand(false);
      ui.setGesture('NONE');
      return;
    }

    S.hasHand = true;
    S.lastHandSeen = performance.now();
    ui.setHand(true);

    const result = rec.recognize(data.landmarks, data.handedness);
    S.result = result;

    const { gesture, indexTip, palmCenter } = result;
    const changed = gesture !== S.gesture;

    if (changed) {
      S.gesture = gesture;
      // Only flush stroke if gesture changes away from DRAW
      if (S.stroking && gesture !== 'DRAW') {
        draw.endStroke(); S.stroking = false; S.drawQ = [];
      }
      if (S.erasing && gesture !== 'ERASE') {
        draw.endErase(); S.erasing = false; S.eraseQ = [];
      }
      if (text.isDragging() && gesture !== 'OPEN_PALM') {
        text.endDrag();
        S.palmGrabbed = false;
      }
      if (gesture !== 'OPEN_PALM') S.palmGrabbed = false;
    }

    if (!indexTip) return;

    const pos = toLogical(indexTip);
    const palmPos = palmCenter ? toLogical(palmCenter) : pos;

    S.tx = pos.x;
    S.ty = pos.y;
    S.palmX = palmPos.x;
    S.palmY = palmPos.y;

    ui.setCoords(Math.round(pos.x), Math.round(pos.y));
    ui.setGesture(gesture);

    const now = performance.now();

    /* ── FIST: pause all input ──────────────────── */
    if (gesture === 'FIST') {
      ui.setMode('paused');
      return;
    }

    /* ── PINCH: lift pen ────────────────────────── */
    if (gesture === 'PINCH') {
      ui.setMode('draw');
      return;
    }

    /* ── THUMB_UP: cycle color ──────────────────── */
    if (gesture === 'THUMB_UP') {
      if (now - S.thumbCD > 950) {
        S.thumbCD = now;
        const col = ui.cycleColor();
        draw.setColor(col);
      }
      return;
    }

    /* ── CROSS: undo after hold ─────────────────── */
    if (gesture === 'CROSS') {
      if (changed) S.crossStart = now;
      if (now - S.crossStart > 400 && now - S.undoCD > 750) {
        S.undoCD = now;
        S.crossStart = now + 99999;
        draw.undo();
        ui.toast('↩ Undo');
      }
      return;
    }

    /* ── OPEN_PALM: move text ───────────────────── */
    if (gesture === 'OPEN_PALM') {
      if (!S.palmGrabbed) {
        const grabbed = text.tryGrab(S.palmX, S.palmY);
        if (grabbed) S.palmGrabbed = true;
      } else {
        text.moveDrag(S.palmX, S.palmY);
      }
      ui.setMode('move');
      return;
    }

    /* ── ERASE ──────────────────────────────────── */
    const doErase = gesture === 'ERASE' || S.tool === 'erase';
    if (doErase) {
      S.eraseQ.push(pos);
      ui.setMode('erase');
      return;
    }

    /* ── DRAW ───────────────────────────────────── */
    const doDraw = gesture === 'DRAW' ||
      (S.tool === 'draw' && gesture === 'UNKNOWN');
    if (doDraw && S.tool === 'draw') {
      S.drawQ.push(pos);
      S.lastDrawPush = now;   // ← update grace-period timestamp
      ui.setMode('draw');
      return;
    }
  });

  /* ═══════════════════════════════════════════════
     7.  UI EVENT BINDINGS
  ═══════════════════════════════════════════════ */
  ui
    .on('colorChange', c => draw.setColor(c))
    .on('sizeChange', n => draw.setSize(n))
    .on('glowChange', n => draw.setGlow(n))
    .on('opacityChange', n => draw.setOpacity(n))
    .on('styleChange', s => draw.setStyle(s))
    .on('blendChange', m => draw.setBlend(m))
    .on('undo', () => draw.undo())
    .on('redo', () => draw.redo())
    .on('clear', () => { draw.clear(); text.clear(); })
    .on('save', () => {
      draw.export([cText], 'airsketch-' + Date.now() + '.png');
      ui.toast('⬇ Saved!');
    })
    .on('toolChange', tool => {
      S.tool = tool;
      ui.setMode(tool === 'select' ? 'move' : tool);
    })
    .on('toggleFeed', show => tracker.setFeed(show))
    .on('addText', opts => {
      const cx = window.innerWidth / 2 - 80;
      const cy = window.innerHeight / 2;
      text.add(cx, cy, opts.content, opts);
      ui.toast('🖐️ Open palm over text to move it');
    });

  /* ═══════════════════════════════════════════════
     8.  MOUSE / TOUCH FALLBACK
  ═══════════════════════════════════════════════ */
  let mDown = false;

  cOverlay.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const p = _mp(e);
    if (S.tool === 'draw') { draw.startStroke(p.x, p.y); mDown = true; }
    if (S.tool === 'erase') { draw.startErase(p.x, p.y); mDown = true; }
    if (S.tool === 'select') { text.tryGrab(p.x, p.y); mDown = true; }
  });

  cOverlay.addEventListener('mousemove', e => {
    if (!mDown) return;
    const p = _mp(e);
    ui.setCoords(Math.round(p.x), Math.round(p.y));
    if (S.tool === 'draw') draw.continueStroke(p.x, p.y);
    if (S.tool === 'erase') draw.continueErase(p.x, p.y);
    if (S.tool === 'select') text.moveDrag(p.x, p.y);
  });

  ['mouseup', 'mouseleave'].forEach(ev =>
    cOverlay.addEventListener(ev, () => {
      if (!mDown) return;
      mDown = false;
      draw.endStroke();
      draw.endErase();
      text.endDrag();
    })
  );

  cOverlay.addEventListener('touchstart', e => {
    e.preventDefault();
    const r = cOverlay.getBoundingClientRect(), t = e.touches[0];
    const p = { x: t.clientX - r.left, y: t.clientY - r.top };
    if (S.tool === 'erase') draw.startErase(p.x, p.y);
    else draw.startStroke(p.x, p.y);
    mDown = true;
  }, { passive: false });

  cOverlay.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!mDown) return;
    const r = cOverlay.getBoundingClientRect(), t = e.touches[0];
    const p = { x: t.clientX - r.left, y: t.clientY - r.top };
    if (S.tool === 'erase') draw.continueErase(p.x, p.y);
    else draw.continueStroke(p.x, p.y);
  }, { passive: false });

  cOverlay.addEventListener('touchend', () => {
    draw.endStroke();
    draw.endErase();
    mDown = false;
  });

  function _mp(e) {
    const r = cOverlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /* ═══════════════════════════════════════════════
     9.  RESIZE
  ═══════════════════════════════════════════════ */
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(resizeAll, 80);
  });

  /* ═══════════════════════════════════════════════
     10. BOOT SEQUENCE
  ═══════════════════════════════════════════════ */
  ui.init();
  resizeAll();

  ui.setLoading(0.08, 'Setting up canvases…');
  await new Promise(r => setTimeout(r, 150));
  ui.setLoading(0.18, 'Loading MediaPipe Hands…');

  try {
    await tracker.start(p => {
      ui.setLoading(
        0.18 + p * 0.72,
        p < 0.35 ? 'Downloading WASM module…' :
          p < 0.75 ? 'Compiling hand model…' : 'Calibrating…'
      );
    });
  } catch (err) {
    console.warn('[AirSketch] Camera denied — mouse/touch mode active', err);
    ui.setLoading(1, 'Camera unavailable — using mouse/touch');
    setTimeout(() => ui.hideLoader(), 1200);
    requestAnimationFrame(mainLoop);
    return;
  }

  ui.setLoading(1, 'Ready!');
  await new Promise(r => setTimeout(r, 400));
  ui.hideLoader();

  requestAnimationFrame(mainLoop);

  ui.toast('✦ AirSketch ready — show your hand!');
  ui.setMode('draw');

  console.log('%c✦ AirSketch v4.1', 'color:#00d4ff;font-size:16px;font-family:monospace;font-weight:bold');
  console.log(
    `%cCanvas: ${Math.round(window.innerWidth * DPR)}×${Math.round(window.innerHeight * DPR)}px  DPR=${DPR}  target: 60fps`,
    'color:#aaff00;font-family:monospace'
  );

})();

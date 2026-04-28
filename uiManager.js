/**
 * uiManager.js 
 * Welcome modal with tabs, don't-show-again,
 * guide panel, and all existing UI bindings.
 */
class UIManager {
  constructor() {
    this.$ = id => document.getElementById(id);

    this.hDot = this.$('h-dot');
    this.hLabel = this.$('h-label');
    this.gChip = this.$('gesture-chip');
    this.gIcon = this.$('g-icon');
    this.gName = this.$('g-name');
    this.modeTag = this.$('mode-tag');

    this.coords = this.$('coords');
    this.fpsNum = this.$('fps-num');
    this.resVal = this.$('res-val');
    this.tipEl = this.$('tip');

    this.swatches = document.querySelectorAll('.sw');
    this.tools = document.querySelectorAll('.tool');
    this.stkBtns = document.querySelectorAll('.stk');

    this.rSize = this.$('r-size');
    this.rGlow = this.$('r-glow');
    this.rOpacity = this.$('r-opacity');
    this.blendSel = this.$('blend-sel');
    this.custColor = this.$('custom-color');

    this.lblSize = this.$('lbl-size');
    this.lblGlow = this.$('lbl-glow');
    this.lblOpacity = this.$('lbl-opacity');

    this.modal = this.$('text-modal');
    this.tiContent = this.$('ti-content');
    this.tiFont = this.$('ti-font');
    this.tiSize = this.$('ti-size');
    this.tiSizeLbl = this.$('ti-size-lbl');
    this.tiColor = this.$('ti-color');
    this.tiOK = this.$('ti-ok');
    this.tiCancel = this.$('ti-cancel');

    this.btnUndo = this.$('btn-undo');
    this.btnRedo = this.$('btn-redo');
    this.btnSave = this.$('btn-save');
    this.btnClear = this.$('btn-clear');
    this.btnFeed = this.$('btn-togglefeed');
    this.btnGuide = this.$('btn-guide');
    this.btnAddTxt = this.$('btn-addtext');
    this.toolTxt = this.$('tool-text');

    // Welcome modal
    this.welcomeModal = this.$('welcome-modal');
    this.btnWelcomeClose = this.$('btn-welcome-close');
    this.chkNoShow = this.$('chk-noshow');
    this.wTabs = document.querySelectorAll('.w-tab');
    this.wPanes = document.querySelectorAll('.w-pane');

    this.loader = this.$('loader');
    this.ldrFill = this.$('ldr-fill');
    this.ldrMsg = this.$('ldr-msg');
    this.toastEl = this.$('toasts');

    this._fps = 0; this._fpsF = 0; this._fpsT = performance.now();
    this._cbs = {};

    this.colorList = ['#00d4ff', '#ff0080', '#aaff00', '#ff6600', '#cc44ff', '#00ffcc', '#ffffff', '#ff3333', '#ffee00', '#4488ff'];
    this.colorIdx = 0;
    this.feedOn = true;

    // Keep sidebar labels in sync with canvasManager defaults
    // (size=8, glow=28 — must match canvasManager.js S defaults)
    this._defaultSize = 8;
    this._defaultGlow = 28;
  }

  init() {
    this._bind();
    this._initWelcome();
  }

  /* ─── Welcome modal ───────────────────────────────── */
  _initWelcome() {
    // Show unless user opted out
    const hidden = localStorage.getItem('airsketch_welcome_hidden') === '1';
    if (hidden) {
      this.welcomeModal.classList.add('hidden');
    }

    // Tab switching
    this.wTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.wTabs.forEach(t => t.classList.remove('active'));
        this.wPanes.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const target = document.getElementById('tab-' + tab.dataset.tab);
        if (target) target.classList.add('active');
      });
    });

    // Close button
    this.btnWelcomeClose.addEventListener('click', () => {
      if (this.chkNoShow && this.chkNoShow.checked) {
        localStorage.setItem('airsketch_welcome_hidden', '1');
      }
      this.welcomeModal.classList.add('hidden');
    });

    // Guide button re-opens welcome
    this.btnGuide.addEventListener('click', () => {
      this.welcomeModal.classList.remove('hidden');
    });

    // Dismiss on backdrop click
    this.welcomeModal.addEventListener('click', e => {
      if (e.target === this.welcomeModal) {
        if (this.chkNoShow && this.chkNoShow.checked) {
          localStorage.setItem('airsketch_welcome_hidden', '1');
        }
        this.welcomeModal.classList.add('hidden');
      }
    });
  }

  _bind() {
    // Swatches
    this.swatches.forEach(s => {
      s.addEventListener('click', () => {
        this._setColor(s.dataset.c);
        this._emit('colorChange', s.dataset.c);
      });
    });
    this.custColor.addEventListener('input', e => {
      this._setColor(e.target.value);
      this._emit('colorChange', e.target.value);
    });

    // Tools
    this.tools.forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.tool === 'text') { this.openModal(); return; }
        this._setTool(b.dataset.tool);
        this._emit('toolChange', b.dataset.tool);
      });
    });

    // Stroke styles
    this.stkBtns.forEach(b => {
      b.addEventListener('click', () => {
        this.stkBtns.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this._emit('styleChange', b.dataset.s);
      });
    });

    // Sliders
    this.rSize.addEventListener('input', e => {
      this.lblSize.textContent = e.target.value;
      this._emit('sizeChange', +e.target.value);
    });
    this.rGlow.addEventListener('input', e => {
      this.lblGlow.textContent = e.target.value;
      this._emit('glowChange', +e.target.value);
    });
    this.rOpacity.addEventListener('input', e => {
      this.lblOpacity.textContent = e.target.value;
      this._emit('opacityChange', +e.target.value / 100);
    });
    this.blendSel.addEventListener('change', e => {
      this._emit('blendChange', e.target.value);
    });

    // Top bar
    this.btnUndo.addEventListener('click', () => this._emit('undo'));
    this.btnRedo.addEventListener('click', () => this._emit('redo'));
    this.btnSave.addEventListener('click', () => this._emit('save'));
    this.btnClear.addEventListener('click', () => {
      if (confirm('Clear the canvas?')) this._emit('clear');
    });

    // Feed toggle
    this.btnFeed.addEventListener('click', () => {
      this.feedOn = !this.feedOn;
      this.btnFeed.textContent = this.feedOn ? '📷' : '📷✕';
      this._emit('toggleFeed', this.feedOn);
    });

    // Add text
    this.btnAddTxt.addEventListener('click', () => this.openModal());

    // Modal
    this.tiSize.addEventListener('input', e => {
      this.tiSizeLbl.textContent = e.target.value + 'px';
    });
    this.tiOK.addEventListener('click', () => this._submitText());
    this.tiCancel.addEventListener('click', () => this.closeModal());
    this.tiContent.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._submitText();
      if (e.key === 'Escape') this.closeModal();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      // Skip if any modal is open
      if (!this.modal.classList.contains('hidden')) return;
      if (!this.welcomeModal.classList.contains('hidden')) {
        if (e.key === 'Escape') this.welcomeModal.classList.add('hidden');
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); this._emit('undo'); }
        if (e.key === 'y') { e.preventDefault(); this._emit('redo'); }
        if (e.key === 's') { e.preventDefault(); this._emit('save'); }
      }
      if (e.key === 'e') { this._setTool('erase'); this._emit('toolChange', 'erase'); }
      if (e.key === 'd') { this._setTool('draw'); this._emit('toolChange', 'draw'); }
      if (e.key === 't') this.openModal();
      if (e.key === 'Escape') this.closeModal();
      if (e.key === '?') {
        this.welcomeModal.classList.toggle('hidden');
      }
    });
  }

  _submitText() {
    const c = this.tiContent.value.trim();
    if (!c) { this.tiContent.focus(); return; }
    this._emit('addText', {
      content: c,
      font: this.tiFont.value,
      size: +this.tiSize.value,
      color: this.tiColor.value,
    });
    this.closeModal();
  }

  /* ─── Loader ─────────────────────────────────────── */
  setLoading(pct, msg) {
    this.ldrFill.style.width = Math.round(pct * 100) + '%';
    if (msg) this.ldrMsg.textContent = msg;
  }
  hideLoader() {
    this.loader.classList.add('out');
    setTimeout(() => this.loader.style.display = 'none', 750);
  }

  /* ─── Hand / gesture ─────────────────────────────── */
  setHand(on) {
    this.hDot.className = 'h-dot ' + (on ? 'on' : 'lost');
    this.hLabel.textContent = on ? 'Tracking' : 'Searching…';
    this.tipEl.textContent = on ? 'Drawing with gestures ✦' : 'Show ☝️ to draw';
  }

  setGesture(g) {
    const M = {
      DRAW: { i: '☝️', n: 'Drawing' },
      ERASE: { i: '✌️', n: 'Erasing' },
      PINCH: { i: '🤏', n: 'Pen Up' },
      FIST: { i: '✊', n: 'Paused' },
      OPEN_PALM: { i: '🖐️', n: 'Move Text' },
      THUMB_UP: { i: '👍', n: 'Color' },
      CROSS: { i: '🤞', n: 'Undo…' },
      UNKNOWN: { i: '✋', n: 'Tracking' },
      NONE: { i: '—', n: 'Idle' },
    };
    const info = M[g] || M.NONE;
    this.gIcon.textContent = info.i;
    this.gName.textContent = info.n;
    this.gChip.classList.toggle('lit', g !== 'NONE' && g !== 'UNKNOWN');
  }

  setMode(m) {
    this.modeTag.textContent = m.toUpperCase();
    this.modeTag.className = 'mode-tag ' + m.toLowerCase();
    this.tools.forEach(b => b.classList.toggle('active', b.dataset.tool === m));
  }

  setCoords(x, y) { this.coords.textContent = `x:${x} y:${y}`; }
  setRes(str) { this.resVal.textContent = str; }

  /* ─── FPS ────────────────────────────────────────── */
  tickFPS() {
    this._fpsF++;
    const now = performance.now();
    if (now - this._fpsT >= 1000) {
      this.fpsNum.textContent = this._fpsF;
      this._fpsF = 0; this._fpsT = now;
    }
  }

  /* ─── Color ─────────────────────────────────────── */
  _setColor(c) {
    this.swatches.forEach(s => s.classList.toggle('active', s.dataset.c === c));
    this.custColor.value = c;
  }

  cycleColor() {
    this.colorIdx = (this.colorIdx + 1) % this.colorList.length;
    const c = this.colorList[this.colorIdx];
    this._setColor(c);
    this._emit('colorChange', c);
    this.toast('Color → ' + c);
    return c;
  }

  /* ─── Tool ──────────────────────────────────────── */
  _setTool(t) {
    this.tools.forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  }

  /* ─── Modal ─────────────────────────────────────── */
  openModal() {
    this.tiContent.value = '';
    this.modal.classList.remove('hidden');
    setTimeout(() => this.tiContent.focus(), 60);
  }
  closeModal() { this.modal.classList.add('hidden'); }

  /* ─── Toast ─────────────────────────────────────── */
  toast(msg, ms = 3000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    this.toastEl.appendChild(el);
    setTimeout(() => el.remove(), ms + 300);
  }

  /* ─── Event bus ─────────────────────────────────── */
  on(ev, cb) {
    if (!this._cbs[ev]) this._cbs[ev] = [];
    this._cbs[ev].push(cb);
    return this;
  }
  _emit(ev, data) { (this._cbs[ev] || []).forEach(cb => cb(data)); }
}

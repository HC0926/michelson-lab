/**
 * Michelson Interferometer Lab Assistant — Embeddable Web Widget
 * ===============================================================
 * Usage: <script src=".../widget.js"></script>
 *        <michelson-assistant></michelson-assistant>
 *
 * Three modes: Chat (AI Q&A), Photo (image analysis), Fringe (live counter)
 */
class MichelsonAssistant extends HTMLElement {
  constructor() {
    super();
    this.apiBase = this.getAttribute("api-base") ?? "";
    this._open = false;
    this._tab = "chat";
    this._messages = [];
    this._fringeRunning = false;
    this._fringeCount = 0;
    this._segmentCount = 0;
    this._alertInterval = 50;
    this._intensityHistory = [];
    this._baseline = null;
    this._lastState = null;
    this._halfCycle = false;
    this._animFrameId = null;
    // Fringe detection params (optimized from real interferometer videos)
    this._noiseGate = 4;
    this._smoothWindow = 2;
    this._emaAlpha = 0.03;
    this._attachShadow();
  }

  _attachShadow() {
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._render();
    this._bindEvents();
  }

  // ── Render ──────────────────────────────────────────────────

  _render() {
    const style = /*css*/ `
      :host { --mc-primary: #6c5ce7; --mc-bg: #1a1a2e; --mc-surface: #16213e; --mc-text: #e0e0e0; --mc-border: #2a2a4a; --mc-danger: #e74c3c; font-family: 'Segoe UI', system-ui, sans-serif; }
      .bubble { position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px; border-radius: 50%; background: var(--mc-primary); color: #fff; border: none; cursor: pointer; font-size: 24px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(108,92,231,0.4); z-index: 99998; transition: transform 0.2s; -webkit-tap-highlight-color: transparent; }
      .bubble:hover { transform: scale(1.1); }
      .bubble.open { display: none; }
      .panel { display: none; position: fixed; bottom: 0; right: 0; width: 420px; height: 600px; max-height: 100vh; max-width: 100vw; background: var(--mc-bg); border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); z-index: 99999; flex-direction: column; overflow: hidden; border: 1px solid var(--mc-border); }
      .panel.open { display: flex; }
      .header { background: var(--mc-primary); color: #fff; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
      .header h3 { margin: 0; font-size: 15px; font-weight: 600; }
      .header button { background: none; border: none; color: #fff; font-size: 24px; cursor: pointer; padding: 0 8px; line-height: 1; -webkit-tap-highlight-color: transparent; }
      .tabs { display: flex; background: var(--mc-surface); border-bottom: 1px solid var(--mc-border); flex-shrink: 0; }
      .tab { flex: 1; padding: 12px 8px; background: none; border: none; color: #888; cursor: pointer; font-size: 14px; border-bottom: 2px solid transparent; transition: all 0.2s; -webkit-tap-highlight-color: transparent; }
      .tab.active { color: var(--mc-primary); border-bottom-color: var(--mc-primary); }
      .content { flex: 1; overflow-y: auto; padding: 12px; display: none; -webkit-overflow-scrolling: touch; }
      .content.active { display: flex; flex-direction: column; }
      .messages { flex: 1; overflow-y: auto; margin-bottom: 8px; -webkit-overflow-scrolling: touch; }
      .msg { margin-bottom: 10px; padding: 8px 12px; border-radius: 10px; max-width: 85%; font-size: 14px; line-height: 1.5; word-break: break-word; }
      .msg.user { background: var(--mc-primary); color: #fff; align-self: flex-end; }
      .msg.assistant { background: var(--mc-surface); color: var(--mc-text); align-self: flex-start; }
      .msg.assistant p { margin: 4px 0; }
      .msg.assistant code { background: rgba(0,0,0,0.3); padding: 2px 5px; border-radius: 3px; font-size: 12px; }
      .msg.assistant table { font-size: 11px; border-collapse: collapse; width: 100%; margin: 6px 0; }
      .msg.assistant td, .msg.assistant th { border: 1px solid var(--mc-border); padding: 4px 6px; }
      .input-row { display: flex; gap: 8px; flex-shrink: 0; }
      .input-row input { flex: 1; padding: 12px; border: 1px solid var(--mc-border); border-radius: 8px; background: var(--mc-surface); color: var(--mc-text); font-size: 16px; outline: none; }
      .input-row input:focus { border-color: var(--mc-primary); }
      .input-row button { background: var(--mc-primary); color: #fff; border: none; padding: 12px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
      .input-row button:disabled { opacity: 0.5; cursor: not-allowed; }
      .photo-drop { border: 2px dashed var(--mc-border); border-radius: 12px; padding: 30px; text-align: center; color: #888; cursor: pointer; transition: border-color 0.2s; -webkit-tap-highlight-color: transparent; }
      .photo-drop:hover { border-color: var(--mc-primary); }
      .photo-drop img { max-width: 100%; max-height: 200px; border-radius: 8px; margin-top: 10px; }
      .diagnosis { margin-top: 12px; padding: 12px; background: var(--mc-surface); border-radius: 8px; font-size: 14px; line-height: 1.5; color: var(--mc-text); }
      .fringe-view { position: relative; flex: 1; background: #000; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 200px; }
      .fringe-view video { display: none; }
      .fringe-view canvas { width: 100%; height: 100%; object-fit: cover; }
      .fringe-count { position: absolute; top: 10px; left: 10px; color: #0f0; font-family: monospace; font-size: 16px; text-shadow: 0 0 6px rgba(0,255,0,0.5); background: rgba(0,0,0,0.6); padding: 6px 12px; border-radius: 6px; }
      .fringe-controls { display: flex; gap: 8px; padding: 10px 0; flex-shrink: 0; }
      .fringe-controls button { flex: 1; padding: 12px 8px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; -webkit-tap-highlight-color: transparent; }
      .btn-start { background: #27ae60; color: #fff; }
      .btn-stop { background: var(--mc-danger); color: #fff; }
      .btn-reset { background: #555; color: #fff; }
      .loading { text-align: center; padding: 20px; color: #888; }
      .loading::after { content: "..."; animation: dots 1.4s infinite; }
      @keyframes dots { 0%,20% { content: "."; } 40% { content: ".."; } 60%,100% { content: "..."; } }
      .empty-state { text-align: center; color: #666; padding: 30px 20px; font-size: 14px; }
      /* Mobile: full-screen panel + larger touch targets */
      @media (max-width: 480px) {
        .bubble { bottom: 16px; right: 16px; width: 52px; height: 52px; font-size: 22px; }
        .panel { top: 0; left: 0; bottom: 0; right: 0; width: 100%; height: 100%; max-height: 100vh; max-width: 100vw; border-radius: 0; border: none; }
        .header { padding: 14px 16px; }
        .header h3 { font-size: 16px; }
        .header button { font-size: 28px; padding: 0 12px; }
        .tab { padding: 14px 8px; font-size: 15px; }
        .content { padding: 10px; }
        .input-row input { padding: 14px 12px; font-size: 16px; }
        .input-row button { padding: 14px 16px; font-size: 15px; }
        .photo-drop { padding: 40px 20px; }
        .msg { font-size: 15px; }
        .fringe-count { font-size: 14px; top: 6px; left: 6px; padding: 4px 10px; }
        .fringe-controls button { padding: 14px 8px; font-size: 14px; }
      }
      /* Tablet: mid-size panel */
      @media (min-width: 481px) and (max-width: 768px) {
        .panel { bottom: 16px; right: 16px; left: 16px; top: auto; width: auto; height: 65vh; border-radius: 16px 16px 0 0; }
      }
    `;
    this.shadow.innerHTML = /*html*/ `
      <style>${style}</style>
      <button class="bubble" id="bubble">&#9883;</button>
      <div class="panel" id="panel">
        <div class="header">
          <h3>&#9883; 迈克尔逊干涉实验助手</h3>
          <button id="btn-close">&times;</button>
        </div>
        <div class="tabs">
          <button class="tab active" data-tab="chat">&#128172; 对话</button>
          <button class="tab" data-tab="photo">&#128247; 拍照</button>
          <button class="tab" data-tab="fringe">&#128065; 条纹</button>
        </div>
        <div class="content active" id="tab-chat">
          <div class="messages" id="messages"><div class="empty-state">有任何迈克尔逊干涉实验的问题，随时问我。</div></div>
          <div class="input-row"><input id="chat-input" placeholder="输入你的问题..." /><button id="btn-send">发送</button></div>
        </div>
        <div class="content" id="tab-photo">
          <div class="photo-drop" id="photo-drop">点击或拖拽干涉条纹照片到这里</div>
          <input type="file" id="photo-input" accept="image/*" style="display:none" />
          <button id="btn-analyze" style="display:none;width:100%;padding:10px;margin-top:8px;background:var(--mc-primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">开始分析</button>
          <div class="diagnosis" id="diagnosis" style="display:none;"></div>
        </div>
        <div class="content" id="tab-fringe">
          <div class="fringe-view" id="fringe-view">
            <video id="fringe-video" autoplay playsinline></video>
            <canvas id="fringe-canvas"></canvas>
            <div class="fringe-count" id="fringe-count">计数: 0 | 分段: 0/50</div>
          </div>
          <div class="fringe-controls">
            <button class="btn-start" id="btn-fringe-start">打开摄像头</button>
            <button class="btn-stop" id="btn-fringe-stop" disabled>停止</button>
            <button class="btn-reset" id="btn-fringe-reset">重置计数</button>
          </div>
        </div>
      </div>`;
  }

  // ── Events ──────────────────────────────────────────────────

  _bindEvents() {
    const s = this.shadow;
    s.getElementById("bubble").addEventListener("click", () => this._togglePanel(true));
    s.getElementById("btn-close").addEventListener("click", () => this._togglePanel(false));
    s.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => this._switchTab(t.dataset.tab)));
    s.getElementById("btn-send").addEventListener("click", () => this._sendChat());
    s.getElementById("chat-input").addEventListener("keydown", e => { if (e.key === "Enter") this._sendChat(); });
    s.getElementById("photo-drop").addEventListener("click", () => s.getElementById("photo-input").click());
    s.getElementById("photo-input").addEventListener("change", e => this._previewPhoto(e.target.files[0]));
    s.getElementById("photo-drop").addEventListener("dragover", e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--mc-primary)"; });
    s.getElementById("photo-drop").addEventListener("dragleave", e => { e.currentTarget.style.borderColor = "var(--mc-border)"; });
    s.getElementById("photo-drop").addEventListener("drop", e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--mc-border)"; const f = e.dataTransfer.files[0]; if (f) this._previewPhoto(f); });
    s.getElementById("btn-analyze").addEventListener("click", () => this._analyzePhoto());
    s.getElementById("btn-fringe-start").addEventListener("click", () => this._startFringe());
    s.getElementById("btn-fringe-stop").addEventListener("click", () => this._stopFringe());
    s.getElementById("btn-fringe-reset").addEventListener("click", () => { this._fringeCount = 0; this._segmentCount = 0; this._updateFringeDisplay(); });
  }

  // ── Panel ───────────────────────────────────────────────────

  _togglePanel(open) {
    this._open = open;
    this.shadow.getElementById("bubble").classList.toggle("open", open);
    this.shadow.getElementById("panel").classList.toggle("open", open);
  }

  _switchTab(tab) {
    this._tab = tab;
    this.shadow.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    this.shadow.querySelectorAll(".content").forEach(c => c.classList.toggle("active", c.id === "tab-" + tab));
    if (tab === "fringe") this._initFringeCanvas();
  }

  // ── Chat ────────────────────────────────────────────────────

  async _sendChat() {
    const input = this.shadow.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";

    const msgs = this.shadow.getElementById("messages");
    const empty = msgs.querySelector(".empty-state");
    if (empty) empty.remove();
    this._addMessage("user", text);
    this._addMessage("assistant", '<span class="loading"></span>', true);

    const lastMsg = msgs.querySelector(".msg.assistant:last-child");
    let fullText = "";

    try {
      const resp = await fetch(`${this.apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
      });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullText += parsed.content;
                if (lastMsg) lastMsg.innerHTML = this._formatMarkdown(fullText);
              }
            } catch (e) { /* skip partial */ }
          }
        }
      }
    } catch (e) {
      if (lastMsg) lastMsg.innerHTML = `<span style="color:var(--mc-danger)">出错了: ${e.message}</span>`;
    }

    this._messages.push({ role: "user", content: text });
    this._messages.push({ role: "assistant", content: fullText });
    msgs.scrollTop = msgs.scrollHeight;
  }

  _addMessage(role, text, isTemp) {
    const msgs = this.shadow.getElementById("messages");
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.innerHTML = role === "assistant" ? text : this._escapeHtml(text);
    if (isTemp) div.setAttribute("data-temp", "1");
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  _formatMarkdown(text) {
    return text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>")
      .replace(/\|(.+)\|/g, (m) => { const cells = m.split("|").filter(c => c.trim()); return `<tr>${cells.map(c => `<td>${c.trim()}</td>`).join("")}</tr>`; });
  }

  _escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  // ── Photo ────────────────────────────────────────────────────

  _previewPhoto(file) {
    if (!file) return;
    const drop = this.shadow.getElementById("photo-drop");
    const btn = this.shadow.getElementById("btn-analyze");
    const reader = new FileReader();
    reader.onload = e => { drop.innerHTML = `<img src="${e.target.result}" alt="Preview" />`; };
    reader.readAsDataURL(file);
    btn.style.display = "block";
    btn.dataset.fileData = null;
    this._photoFile = file;
    this.shadow.getElementById("diagnosis").style.display = "none";
  }

  async _analyzePhoto() {
    if (!this._photoFile) return;
    const diagnosis = this.shadow.getElementById("diagnosis");
    diagnosis.style.display = "block";
    diagnosis.innerHTML = '<span class="loading">分析中</span>';

    const form = new FormData();
    form.append("file", this._photoFile);

    try {
      const resp = await fetch(`${this.apiBase}/api/analyze-image`, { method: "POST", body: form });
      const data = await resp.json();
      diagnosis.innerHTML = this._formatMarkdown(data.analysis || "未返回分析结果。");
    } catch (e) {
      diagnosis.innerHTML = `<span style="color:var(--mc-danger)">出错了: ${e.message}</span>`;
    }
  }

  // ── Fringe Counter (browser-side) ────────────────────────────

  _initFringeCanvas() {
    const canvas = this.shadow.getElementById("fringe-canvas");
    const container = this.shadow.getElementById("fringe-view");
    if (!canvas.width) {
      canvas.width = container.clientWidth || 400;
      canvas.height = container.clientHeight || 300;
    }
  }

  async _startFringe() {
    const video = this.shadow.getElementById("fringe-video");
    this._stopFringe();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      this._fringeRunning = true;
      this._baseline = null;
      this._lastState = null;
      this._halfCycle = false;
      this._intensityHistory = [];

      this.shadow.getElementById("btn-fringe-start").disabled = true;
      this.shadow.getElementById("btn-fringe-stop").disabled = false;
      this._processFringeFrame();
    } catch (e) {
      alert("摄像头访问被拒绝: " + e.message);
    }
  }

  _stopFringe() {
    this._fringeRunning = false;
    if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
    const video = this.shadow.getElementById("fringe-video");
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    this.shadow.getElementById("btn-fringe-start").disabled = false;
    this.shadow.getElementById("btn-fringe-stop").disabled = true;
  }

  _processFringeFrame() {
    if (!this._fringeRunning) return;

    const video = this.shadow.getElementById("fringe-video");
    const canvas = this.shadow.getElementById("fringe-canvas");
    const ctx = canvas.getContext("2d");

    // Match canvas to video
    if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Extract central ROI
    const roiSize = 100;
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const half = Math.floor(roiSize / 2);
    const roi = ctx.getImageData(cx - half, cy - half, roiSize, roiSize);

    // Compute mean intensity with local contrast amplification
    let sum = 0, mn = 255, mx = 0;
    const pixels = roi.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const g = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      if (g < mn) mn = g;
      if (g > mx) mx = g;
      sum += g;
    }
    const rawMean = sum / (roiSize * roiSize);
    // Amplify weak signals: stretch local contrast to full range
    const localRange = mx - mn;
    const intensity = localRange > 0.5 ? 255 * ((rawMean - mn) / localRange) : rawMean;

    // Signal processing
    this._intensityHistory.push(intensity);
    if (this._intensityHistory.length > 200) this._intensityHistory.shift();

    let smoothed = intensity;
    if (this._intensityHistory.length >= this._smoothWindow) {
      smoothed = this._intensityHistory.slice(-this._smoothWindow).reduce((a, b) => a + b, 0) / this._smoothWindow;
    }

    if (this._baseline === null) this._baseline = smoothed;
    this._baseline += this._emaAlpha * (smoothed - this._baseline);

    const diff = smoothed - this._baseline;

    // Fringe detection
    if (Math.abs(diff) > this._noiseGate && this._intensityHistory.length > 10) {
      const state = diff > 0 ? "above" : "below";
      if (this._lastState && state !== this._lastState) {
        if (this._halfCycle) {
          this._fringeCount++;
          this._segmentCount++;
          this._halfCycle = false;
          if (this._segmentCount >= this._alertInterval) {
            this._doAlert();
            this._segmentCount = 0;
          }
        } else {
          this._halfCycle = true;
        }
      }
      this._lastState = state;
    }

    // Draw overlay
    ctx.strokeStyle = "#0f0";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - half, cy - half, roiSize, roiSize);
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();

    // Signal graph
    const gx = canvas.width - 220, gy = 10, gw = 200, gh = 80;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(gx, gy, gw, gh);
    ctx.strokeStyle = "#444";
    ctx.strokeRect(gx, gy, gw, gh);
    if (this._intensityHistory.length > 1) {
      const data = this._intensityHistory.slice(-gw);
      const mn = Math.min(...data), mx = Math.max(...data) || mn + 1;
      ctx.strokeStyle = "#0f0";
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = gx + i;
        const y = gy + gh - ((data[i] - mn) / (mx - mn)) * gh;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      const by = gy + gh - ((this._baseline - mn) / (mx - mn)) * gh;
      ctx.strokeStyle = "#ff0";
      ctx.beginPath();
      ctx.moveTo(gx, by);
      ctx.lineTo(gx + gw, by);
      ctx.stroke();
    }

    // Alert flash
    if (this._segmentCount === 0 && this._fringeCount > 0) {
      const flash = Math.abs(Math.sin(Date.now() / 100));
      ctx.fillStyle = `rgba(0,${Math.floor(flash * 255)},255,0.3)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    this._updateFringeDisplay();
    this._animFrameId = requestAnimationFrame(() => this._processFringeFrame());
  }

  _updateFringeDisplay() {
    this.shadow.getElementById("fringe-count").textContent =
      `计数: ${this._fringeCount} | 分段: ${this._segmentCount}/${this._alertInterval}`;
  }

  _doAlert() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "square";
      gain.gain.value = 0.1;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) { /* audio not available */ }
  }

  // ── Cleanup ──────────────────────────────────────────────────

  disconnectedCallback() {
    this._stopFringe();
  }
}

// Register the custom element
if (!customElements.get("michelson-assistant")) {
  customElements.define("michelson-assistant", MichelsonAssistant);
}

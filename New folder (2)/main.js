// ==========================================
// STATE & CONFIGURATION
// ==========================================
const LABEL_OFFSET = 110;
const TRACK_HEIGHT = 44;
const EXPORT_FPS = 30;
const EXPORT_WIDTH = 1280;
const EXPORT_HEIGHT = 720;

const TRACK_KEYS = [
  "overlay-1", "overlay-2", "overlay-3",
  "video-1", "video-2", "video-3",
  "audio-1", "audio-2", "audio-3",
];

let pxPerSec = 60;
let currentTime = 0;
let isPlaying = false;
let lastFrameTimestamp = null;

let mediaAssets = [];
let clips = [];
let selectedClipId = null;
let clipboardClip = null;

// DOM Elements
const canvas = document.getElementById("preview-canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const playheadEl = document.getElementById("playhead");
const rulerEl = document.getElementById("timeline-ruler");
const timelineScroll = document.getElementById("timeline-scroll");
const timeDisplay = document.getElementById("time-display");
const contextMenu = document.getElementById("context-menu");

const lanes = Object.fromEntries(
  TRACK_KEYS.map((key) => [key, document.getElementById(`lane-${key}`)])
);

function getTrackCategory(trackKey) {
  if (trackKey.startsWith("video")) return "video";
  if (trackKey.startsWith("audio")) return "audio";
  return "overlay"; // overlay-1..3 hosts both images & text clips
}

function getFirstAvailableTrack(category) {
  const candidates = TRACK_KEYS.filter((k) => getTrackCategory(k) === category);
  for (const key of candidates) {
    const hasClips = clips.some((c) => c.track === key);
    if (!hasClips) return key;
  }
  return candidates[0];
}

// ==========================================
// TEXT CLIPS & STYLING CONTROLS
// ==========================================
document.getElementById("btn-add-text").addEventListener("click", () => {
  const trackKey = getFirstAvailableTrack("overlay");
  const laneClips = clips.filter((c) => c.track === trackKey);
  const startAt = laneClips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);

  const textClip = {
    id: "clip_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    name: "Text: Hello World",
    track: trackKey,
    kind: "text",
    text: "Hello World",
    fontFamily: "Arial, sans-serif",
    fontSize: 56,
    color: "#ffffff",
    glowColor: "#8b3dff",
    glowBlur: 14,
    edgeWidth: 3,
    start: startAt,
    offset: 0,
    duration: 5,
    maxDuration: 120,
    effect: "word-pop",
    volume: 1,
    x: EXPORT_WIDTH / 2,
    y: EXPORT_HEIGHT / 2,
  };

  clips.push(textClip);
  selectedClipId = textClip.id;
  syncInspectorUI();
  renderTimeline();
  renderCanvasFrame(currentTime);
});

const textContentInput = document.getElementById("text-content-input");
const textFontSelect = document.getElementById("text-font-select");
const textSizeSlider = document.getElementById("text-size-slider");
const textSizeLabel = document.getElementById("text-size-label");
const textColorInput = document.getElementById("text-color-input");
const textGlowColorInput = document.getElementById("text-glow-color");
const textGlowSlider = document.getElementById("text-glow-slider");
const textGlowLabel = document.getElementById("text-glow-label");
const textEdgeSlider = document.getElementById("text-edge-slider");
const textEdgeLabel = document.getElementById("text-edge-label");

const volumeSlider = document.getElementById("volume-slider");
const volumeLabel = document.getElementById("volume-label");

function syncInspectorUI() {
  const clip = clips.find((c) => c.id === selectedClipId);
  const fx = clip ? (clip.effect || "none") : "none";
  document.querySelectorAll(".fx-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.effect === fx);
  });

  const volPct = clip ? Math.round((clip.volume ?? 1) * 100) : 100;
  volumeSlider.value = volPct;
  volumeLabel.textContent = `${volPct}%`;

  if (clip && clip.kind === "text") {
    textContentInput.value = clip.text || "";
    textFontSelect.value = clip.fontFamily || "Arial, sans-serif";
    textSizeSlider.value = clip.fontSize || 56;
    textSizeLabel.textContent = clip.fontSize || 56;
    textColorInput.value = clip.color || "#ffffff";
    textGlowColorInput.value = clip.glowColor || "#8b3dff";
    textGlowSlider.value = clip.glowBlur ?? 14;
    textGlowLabel.textContent = clip.glowBlur ?? 14;
    textEdgeSlider.value = clip.edgeWidth ?? 3;
    textEdgeLabel.textContent = clip.edgeWidth ?? 3;
  }
}

function updateSelectedTextProp(updater) {
  const clip = clips.find((c) => c.id === selectedClipId);
  if (!clip || clip.kind !== "text") return;
  updater(clip);
  syncInspectorUI();
  renderTimeline();
  renderCanvasFrame(currentTime);
}

textContentInput.addEventListener("input", (e) => {
  updateSelectedTextProp((c) => {
    c.text = e.target.value;
    c.name = `Text: ${e.target.value || "Empty"}`;
  });
});

textFontSelect.addEventListener("change", (e) => {
  updateSelectedTextProp((c) => { c.fontFamily = e.target.value; });
});

textSizeSlider.addEventListener("input", (e) => {
  updateSelectedTextProp((c) => { c.fontSize = Number(e.target.value); });
});

textColorInput.addEventListener("input", (e) => {
  updateSelectedTextProp((c) => { c.color = e.target.value; });
});

textGlowColorInput.addEventListener("input", (e) => {
  updateSelectedTextProp((c) => { c.glowColor = e.target.value; });
});

textGlowSlider.addEventListener("input", (e) => {
  updateSelectedTextProp((c) => { c.glowBlur = Number(e.target.value); });
});

textEdgeSlider.addEventListener("input", (e) => {
  updateSelectedTextProp((c) => { c.edgeWidth = Number(e.target.value); });
});

volumeSlider.addEventListener("input", (e) => {
  const clip = clips.find((c) => c.id === selectedClipId);
  const pct = Number(e.target.value);
  volumeLabel.textContent = `${pct}%`;
  if (!clip) return;
  clip.volume = pct / 100;
  if (clip.media && "volume" in clip.media) {
    clip.media.volume = Math.min(1, clip.volume);
  }
});

// ==========================================
// EFFECTS (zoom-in, zoom-out, crop, typewriter, word-pop)
// ==========================================
function setClipEffect(effectName) {
  const clip = clips.find((c) => c.id === selectedClipId);
  if (!clip) return alert("Pehle timeline par koi clip select karein.");
  if (getTrackCategory(clip.track) === "audio") {
    return alert("Visual effects sirf Video, Image ya Text clips par lagte hain.");
  }
  clip.effect = effectName;
  syncInspectorUI();
  renderTimeline();
  renderCanvasFrame(currentTime);
}

document.querySelectorAll(".fx-btn").forEach((btn) => {
  btn.addEventListener("click", () => setClipEffect(btn.dataset.effect));
});

function formatEffectLabel(effect) {
  const map = {
    "zoom-in": "?? Zoom In",
    "zoom-out": "?? Zoom Out",
    "crop": "?? Crop",
    "typewriter": "?? Typewriter",
    "word-pop": "? Word Pop",
  };
  return map[effect] || "";
}

function drawVisualClip(clip, time) {
  const progress = Math.max(0, Math.min(1, (time - clip.start) / Math.max(0.01, clip.duration)));
  const effect = clip.effect || "none";

  if (clip.kind === "text") {
    drawTextClip(clip, progress, effect);
    return;
  }

  ctx.save();
  let dx = clip.x;
  let dy = clip.y;
  let dw = clip.w;
  let dh = clip.h;

  const srcW = clip.kind === "video"
    ? (clip.media.videoWidth || clip.w)
    : (clip.media.naturalWidth || clip.w);
  const srcH = clip.kind === "video"
    ? (clip.media.videoHeight || clip.h)
    : (clip.media.naturalHeight || clip.h);

  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;

  if (effect === "crop") {
    sw = srcW * 0.7;
    sh = srcH * 0.7;
    sx = (srcW - sw) / 2;
    sy = (srcH - sh) / 2;
  }

  let scale = 1;
  if (effect === "zoom-in") scale = 1 + progress * 0.45;
  else if (effect === "zoom-out") scale = 1.45 - progress * 0.45;

  if (scale !== 1) {
    const cx = dx + dw / 2;
    const cy = dy + dh / 2;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  ctx.drawImage(clip.media, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

function drawTextClip(clip, progress, effect) {
  const fullText = clip.text || "";
  if (!fullText) return;

  ctx.save();
  const fontSize = clip.fontSize || 56;
  const fontFamily = clip.fontFamily || "Arial, sans-serif";
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "middle";

  // Glow & Edge settings
  const glowBlur = clip.glowBlur ?? 14;
  const edgeWidth = clip.edgeWidth ?? 3;
  const glowColor = clip.glowColor || "#8b3dff";
  const textColor = clip.color || "#ffffff";

  ctx.shadowColor = glowColor;
  ctx.shadowBlur = glowBlur;
  ctx.lineJoin = "round";
  ctx.lineWidth = edgeWidth * 2;
  ctx.strokeStyle = "#000000";

  if (effect === "typewriter") {
    const visibleChars = Math.max(1, Math.ceil(progress * fullText.length));
    const shown = fullText.slice(0, visibleChars);
    ctx.textAlign = "center";
    if (edgeWidth > 0) ctx.strokeText(shown, clip.x, clip.y);
    ctx.fillStyle = textColor;
    ctx.fillText(shown, clip.x, clip.y);
  } else if (effect === "word-pop") {
    // Word-by-word animation (Apple-style sequential reveal)
    const words = fullText.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      ctx.restore();
      return;
    }
    const activeWordIndex = Math.min(words.length - 1, Math.floor(progress * words.length * 1.15));
    const spaceWidth = ctx.measureText(" ").width;
    const wordWidths = words.map((w) => ctx.measureText(w).width);
    const totalWidth =
      wordWidths.reduce((a, b) => a + b, 0) + spaceWidth * Math.max(0, words.length - 1);

    let cursorX = clip.x - totalWidth / 2;
    ctx.textAlign = "left";

    words.forEach((word, idx) => {
      if (idx <= activeWordIndex) {
        const wordStart = idx / words.length;
        const localP = Math.max(0, Math.min(1, (progress - wordStart) * words.length * 2));
        const popScale = 0.8 + 0.2 * localP;

        ctx.save();
        const wx = cursorX + wordWidths[idx] / 2;
        ctx.translate(wx, clip.y);
        ctx.scale(popScale, popScale);
        ctx.globalAlpha = Math.min(1, 0.25 + localP * 0.75);
        if (edgeWidth > 0) ctx.strokeText(word, -wordWidths[idx] / 2, 0);
        ctx.fillStyle = textColor;
        ctx.fillText(word, -wordWidths[idx] / 2, 0);
        ctx.restore();
      }
      cursorX += wordWidths[idx] + spaceWidth;
    });
  } else {
    ctx.textAlign = "center";
    if (edgeWidth > 0) ctx.strokeText(fullText, clip.x, clip.y);
    ctx.fillStyle = textColor;
    ctx.fillText(fullText, clip.x, clip.y);
  }

  ctx.restore();
}

// ==========================================
// 1. MEDIA UPLOAD & ASSET POOL
// ==========================================
document.getElementById("upload-video").addEventListener("change", (e) => handleFileUpload(e, "video"));
document.getElementById("upload-image").addEventListener("change", (e) => handleFileUpload(e, "overlay"));
document.getElementById("upload-audio").addEventListener("change", (e) => handleFileUpload(e, "audio"));

function handleFileUpload(event, category) {
  const file = event.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const assetId = "asset_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

  if (category === "video") {
    const vid = document.createElement("video");
    vid.src = url;
    vid.preload = "auto";
    vid.onloadedmetadata = () => {
      const asset = { id: assetId, name: file.name, category: "video", url, duration: vid.duration || 5, element: vid };
      mediaAssets.push(asset);
      renderMediaPool();
      addClipFromAsset(asset);
    };
  } else if (category === "overlay") {
    const img = new Image();
    img.src = url;
    img.onload = () => {
      const asset = { id: assetId, name: file.name, category: "overlay", url, duration: 4, element: img };
      mediaAssets.push(asset);
      renderMediaPool();
      addClipFromAsset(asset);
    };
  } else if (category === "audio") {
    const aud = new Audio(url);
    aud.preload = "auto";
    aud.onloadedmetadata = () => {
      const asset = { id: assetId, name: file.name, category: "audio", url, duration: aud.duration || 6, element: aud };
      mediaAssets.push(asset);
      renderMediaPool();
      addClipFromAsset(asset);
    };
  }
  event.target.value = "";
}

function renderMediaPool() {
  const pool = document.getElementById("media-pool");
  pool.innerHTML = "";
  mediaAssets.forEach((asset) => {
    const card = document.createElement("div");
    card.className = "media-item";
    card.title = "Click to add to timeline";

    const thumb = document.createElement("div");
    thumb.className = "media-thumb";
    if (asset.category === "overlay") {
      const img = document.createElement("img");
      img.src = asset.url;
      thumb.appendChild(img);
    } else {
      thumb.textContent = asset.category === "video" ? "??" : "??";
    }

    const name = document.createElement("div");
    name.className = "media-name";
    name.textContent = asset.name;

    card.append(thumb, name);
    card.onclick = () => addClipFromAsset(asset);
    pool.appendChild(card);
  });
}

// ==========================================
// 2. TIMELINE CLIPS MANAGEMENT
// ==========================================
function cloneMediaForClip(kind, url, existingMedia) {
  if (kind === "video") {
    const vid = document.createElement("video");
    vid.src = url;
    vid.preload = "auto";
    return vid;
  }
  if (kind === "audio") {
    const aud = new Audio(url);
    aud.preload = "auto";
    return aud;
  }
  return existingMedia;
}

function addClipFromAsset(asset) {
  const targetTrack = getFirstAvailableTrack(asset.category);
  const laneClips = clips.filter((c) => c.track === targetTrack);
  const startAt = laneClips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);

  const newClip = {
    id: "clip_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    assetId: asset.id,
    name: asset.name,
    track: targetTrack,
    kind: asset.category,
    url: asset.url,
    start: startAt,
    offset: 0,
    duration: asset.duration,
    maxDuration: asset.category === "overlay" ? 120 : asset.duration,
    media: cloneMediaForClip(asset.category, asset.url, asset.element),
    effect: "none",
    volume: 1,
    x: asset.category === "overlay" ? 440 : 0,
    y: asset.category === "overlay" ? 180 : 0,
    w: asset.category === "overlay" ? 400 : EXPORT_WIDTH,
    h: asset.category === "overlay" ? 360 : EXPORT_HEIGHT,
  };

  clips.push(newClip);
  selectedClipId = newClip.id;
  syncInspectorUI();
  renderTimeline();
  renderCanvasFrame(currentTime);
}

function getTotalDuration() {
  const maxClipEnd = clips.reduce((max, c) => Math.max(max, c.start + c.duration), 15);
  return Math.max(15, maxClipEnd);
}

// ==========================================
// 3. TIMELINE RENDERING, MULTI-TRACK DRAG & TRIM
// ==========================================
function renderRuler() {
  rulerEl.innerHTML = "";
  const totalSec = Math.ceil(getTotalDuration()) + 10;
  for (let s = 0; s <= totalSec; s++) {
    const tick = document.createElement("div");
    tick.className = "ruler-tick";
    tick.style.left = `${s * pxPerSec}px`;
    tick.textContent = `${s}s`;
    rulerEl.appendChild(tick);
  }
}

function renderTimeline() {
  renderRuler();
  Object.values(lanes).forEach((lane) => (lane.innerHTML = ""));

  clips.forEach((clip) => {
    const cssClass = clip.kind === "text" ? "text" : getTrackCategory(clip.track);
    const el = document.createElement("div");
    el.className = `clip ${cssClass} ${clip.id === selectedClipId ? "selected" : ""}`;
    el.style.left = `${clip.start * pxPerSec}px`;
    el.style.width = `${Math.max(14, clip.duration * pxPerSec)}px`;

    const title = document.createElement("span");
    title.className = "clip-title";
    title.textContent = clip.name;

    const leftTrim = document.createElement("div");
    leftTrim.className = "trim-handle left";

    const rightTrim = document.createElement("div");
    rightTrim.className = "trim-handle right";

    el.append(leftTrim, title);

    if (clip.effect && clip.effect !== "none") {
      const badge = document.createElement("span");
      badge.className = "clip-fx-badge";
      badge.textContent = formatEffectLabel(clip.effect);
      el.appendChild(badge);
    }

    el.append(rightTrim);

    el.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      selectedClipId = clip.id;
      syncInspectorUI();
      renderTimeline();
    });

    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedClipId = clip.id;
      syncInspectorUI();
      renderTimeline();
      showContextMenu(e.clientX, e.clientY);
    });

    // Move Clip horizontally & across compatible lanes (e.g., Audio 1 <-> Audio 2 <-> Audio 3)
    el.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("trim-handle")) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const initialStart = clip.start;
      const allowedCategory = getTrackCategory(clip.track);
      const compatibleTracks = TRACK_KEYS.filter((k) => getTrackCategory(k) === allowedCategory);
      const initialIdx = compatibleTracks.indexOf(clip.track);

      const onMove = (moveEvt) => {
        const deltaSec = (moveEvt.clientX - startX) / pxPerSec;
        clip.start = Math.max(0, initialStart + deltaSec);
        el.style.left = `${clip.start * pxPerSec}px`;

        const laneShift = Math.round((moveEvt.clientY - startY) / TRACK_HEIGHT);
        const nextIdx = Math.max(0, Math.min(compatibleTracks.length - 1, initialIdx + laneShift));
        const nextTrack = compatibleTracks[nextIdx];
        if (nextTrack !== clip.track) {
          clip.track = nextTrack;
          lanes[nextTrack].appendChild(el);
        }

        updateTimeDisplay();
        renderCanvasFrame(currentTime);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        renderTimeline();
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    // Left Trim
    leftTrim.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const origStart = clip.start;
      const origOffset = clip.offset;
      const origDur = clip.duration;

      const onMove = (moveEvt) => {
        let deltaSec = (moveEvt.clientX - startX) / pxPerSec;
        deltaSec = Math.max(-origOffset, Math.min(deltaSec, origDur - 0.2));
        if (origStart + deltaSec < 0) deltaSec = -origStart;

        clip.start = origStart + deltaSec;
        clip.offset = origOffset + deltaSec;
        clip.duration = origDur - deltaSec;
        el.style.left = `${clip.start * pxPerSec}px`;
        el.style.width = `${clip.duration * pxPerSec}px`;
        renderCanvasFrame(currentTime);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        renderTimeline();
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    // Right Trim
    rightTrim.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const origDur = clip.duration;

      const onMove = (moveEvt) => {
        const deltaSec = (moveEvt.clientX - startX) / pxPerSec;
        const maxAllowed = clip.maxDuration - clip.offset;
        clip.duration = Math.max(0.2, Math.min(origDur + deltaSec, maxAllowed));
        el.style.width = `${clip.duration * pxPerSec}px`;
        renderCanvasFrame(currentTime);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        renderTimeline();
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    lanes[clip.track].appendChild(el);
  });

  updatePlayheadPosition();
}

// ==========================================
// 4. PLAYHEAD SCRUBBING
// ==========================================
function updatePlayheadPosition() {
  playheadEl.style.left = `${LABEL_OFFSET + currentTime * pxPerSec}px`;
  updateTimeDisplay();
}

function seekToClientX(clientX) {
  const rect = timelineScroll.getBoundingClientRect();
  const xInside = clientX - rect.left + timelineScroll.scrollLeft - LABEL_OFFSET;
  currentTime = Math.max(0, Math.min(xInside / pxPerSec, getTotalDuration()));
  updatePlayheadPosition();
  syncMediaToTime(currentTime, false);
  renderCanvasFrame(currentTime);
}

playheadEl.querySelector(".playhead-handle").addEventListener("mousedown", (e) => {
  e.stopPropagation();
  if (isPlaying) togglePlay();

  const onMove = (moveEvt) => seekToClientX(moveEvt.clientX);
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
});

rulerEl.addEventListener("mousedown", (e) => {
  if (isPlaying) togglePlay();
  seekToClientX(e.clientX);
});

document.getElementById("zoom-slider").addEventListener("input", (e) => {
  pxPerSec = Number(e.target.value);
  renderTimeline();
});

// ==========================================
// 5. SPLIT, COPY, PASTE, DUPLICATE, DELETE
// ==========================================
function splitSelectedClip() {
  const clip = clips.find((c) => c.id === selectedClipId);
  if (!clip) return alert("Select a clip on the timeline first.");

  const clipEnd = clip.start + clip.duration;
  if (currentTime <= clip.start + 0.05 || currentTime >= clipEnd - 0.05) {
    return alert("Move the red playhead line over the selected clip to split it.");
  }

  const firstPartDuration = currentTime - clip.start;
  const secondPartDuration = clip.duration - firstPartDuration;

  const rightClip = {
    ...clip,
    id: "clip_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    start: currentTime,
    offset: clip.offset + firstPartDuration,
    duration: secondPartDuration,
    media: cloneMediaForClip(clip.kind, clip.url, clip.media),
  };

  clip.duration = firstPartDuration;
  clips.push(rightClip);
  selectedClipId = rightClip.id;

  syncInspectorUI();
  renderTimeline();
  renderCanvasFrame(currentTime);
}

function copySelectedClip() {
  const clip = clips.find((c) => c.id === selectedClipId);
  if (!clip) return;
  clipboardClip = { ...clip };
}

function pasteClip(atTime = currentTime) {
  if (!clipboardClip) return;

  const pasted = {
    ...clipboardClip,
    id: "clip_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    start: atTime,
    media: cloneMediaForClip(clipboardClip.kind, clipboardClip.url, clipboardClip.media),
  };

  clips.push(pasted);
  selectedClipId = pasted.id;
  syncInspectorUI();
  renderTimeline();
  renderCanvasFrame(currentTime);
}

function duplicateSelectedClip() {
  const clip = clips.find((c) => c.id === selectedClipId);
  if (!clip) return;
  clipboardClip = { ...clip };
  pasteClip(clip.start + clip.duration + 0.1);
}

function deleteSelectedClip() {
  if (!selectedClipId) return;
  const clip = clips.find((c) => c.id === selectedClipId);
  if (clip && clip.media && clip.media.pause) clip.media.pause();
  clips = clips.filter((c) => c.id !== selectedClipId);
  selectedClipId = null;
  syncInspectorUI();
  renderTimeline();
  renderCanvasFrame(currentTime);
}

document.getElementById("tool-split").onclick = splitSelectedClip;
document.getElementById("tool-copy").onclick = copySelectedClip;
document.getElementById("tool-paste").onclick = () => pasteClip(currentTime);
document.getElementById("tool-duplicate").onclick = duplicateSelectedClip;
document.getElementById("tool-delete").onclick = deleteSelectedClip;

document.getElementById("btn-clear").onclick = () => {
  clips.forEach((c) => { if (c.media && c.media.pause) c.media.pause(); });
  clips = [];
  selectedClipId = null;
  currentTime = 0;
  syncInspectorUI();
  renderTimeline();
  renderCanvasFrame(0);
};

// Right-Click Context Menu
function showContextMenu(x, y) {
  contextMenu.style.left = `${Math.min(x, window.innerWidth - 210)}px`;
  contextMenu.style.top = `${Math.min(y, window.innerHeight - 360)}px`;
  contextMenu.classList.remove("hidden");
}

window.addEventListener("click", () => contextMenu.classList.add("hidden"));

contextMenu.addEventListener("click", (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  if (action === "split") splitSelectedClip();
  if (action === "copy") copySelectedClip();
  if (action === "paste") pasteClip(currentTime);
  if (action === "duplicate") duplicateSelectedClip();
  if (action === "fx-zoom-in") setClipEffect("zoom-in");
  if (action === "fx-zoom-out") setClipEffect("zoom-out");
  if (action === "fx-crop") setClipEffect("crop");
  if (action === "fx-typewriter") setClipEffect("typewriter");
  if (action === "fx-word-pop") setClipEffect("word-pop");
  if (action === "fx-none") setClipEffect("none");
  if (action === "delete") deleteSelectedClip();
  contextMenu.classList.add("hidden");
});

window.addEventListener("keydown", (e) => {
  if (document.activeElement === textContentInput) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    deleteSelectedClip();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
    copySelectedClip();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
    pasteClip(currentTime);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    duplicateSelectedClip();
  } else if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey) {
    splitSelectedClip();
  }
});

// ==========================================
// 6. PLAYBACK & CANVAS COMPOSITING
// ==========================================
const playBtn = document.getElementById("btn-play");
playBtn.onclick = togglePlay;

function togglePlay() {
  isPlaying = !isPlaying;
  playBtn.textContent = isPlaying ? "? Pause" : "? Play";

  if (isPlaying) {
    if (currentTime >= getTotalDuration()) currentTime = 0;
    lastFrameTimestamp = performance.now();
    requestAnimationFrame(playbackLoop);
  } else {
    clips.forEach((c) => {
      if (c.media && !c.media.paused) c.media.pause();
    });
  }
}

function playbackLoop(now) {
  if (!isPlaying) return;
  const dt = (now - lastFrameTimestamp) / 1000;
  lastFrameTimestamp = now;
  currentTime += dt;

  const end = getTotalDuration();
  if (currentTime >= end) {
    currentTime = end;
    updatePlayheadPosition();
    renderCanvasFrame(currentTime);
    togglePlay();
    return;
  }

  updatePlayheadPosition();
  syncMediaToTime(currentTime, true);
  renderCanvasFrame(currentTime);
  requestAnimationFrame(playbackLoop);
}

function syncMediaToTime(time, playing) {
  clips.forEach((clip) => {
    if (clip.kind !== "video" && clip.kind !== "audio") return;
    const isActive = time >= clip.start && time < clip.start + clip.duration;
    const targetMediaTime = clip.offset + (time - clip.start);

    if ("volume" in clip.media) {
      clip.media.volume = Math.min(1, clip.volume ?? 1);
    }

    if (isActive) {
      if (Math.abs(clip.media.currentTime - targetMediaTime) > 0.25) {
        clip.media.currentTime = targetMediaTime;
      }
      if (playing && clip.media.paused) {
        clip.media.play().catch(() => {});
      }
    } else {
      if (!clip.media.paused) clip.media.pause();
    }
  });
}

function renderCanvasFrame(time) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Render Video tracks 1 -> 3
  ["video-1", "video-2", "video-3"].forEach((trackKey) => {
    clips
      .filter((c) => c.track === trackKey && time >= c.start && time < c.start + c.duration)
      .forEach((clip) => {
        if (clip.media && clip.media.readyState >= 2) {
          drawVisualClip(clip, time);
        }
      });
  });

  // Render Image & Text overlay tracks 1 -> 3 on top
  ["overlay-1", "overlay-2", "overlay-3"].forEach((trackKey) => {
    clips
      .filter((c) => c.track === trackKey && time >= c.start && time < c.start + c.duration)
      .forEach((clip) => {
        drawVisualClip(clip, time);
      });
  });
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  const ms = Math.floor((sec % 1) * 10);
  return `${m}:${s}.${ms}`;
}

function updateTimeDisplay() {
  timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(getTotalDuration())}`;
}

// ==========================================
// 7. MIX ALL AUDIO TRACKS WITH PER-CLIP VOLUME
// ==========================================
async function renderMixedAudioBuffer(activeClips, totalDuration, sampleRate = 44100) {
  const length = Math.max(1, Math.ceil(totalDuration * sampleRate));
  const offlineCtx = new OfflineAudioContext(2, length, sampleRate);

  const audioClips = activeClips.filter((c) => c.kind === "audio" || c.kind === "video");
  for (const clip of audioClips) {
    try {
      const resp = await fetch(clip.url);
      const arrBuf = await resp.arrayBuffer();
      const decoded = await offlineCtx.decodeAudioData(arrBuf);

      const src = offlineCtx.createBufferSource();
      src.buffer = decoded;

      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = clip.volume ?? 1;

      src.connect(gainNode);
      gainNode.connect(offlineCtx.destination);
      src.start(clip.start, clip.offset, clip.duration);
    } catch (e) {
      // Silent video or unsupported audio stream
    }
  }

  return await offlineCtx.startRendering();
}

function waitForSeek(videoEl, targetTime) {
  return new Promise((resolve) => {
    if (Math.abs(videoEl.currentTime - targetTime) < 0.02 && videoEl.readyState >= 2) {
      return resolve();
    }
    const onSeeked = () => {
      videoEl.removeEventListener("seeked", onSeeked);
      resolve();
    };
    videoEl.addEventListener("seeked", onSeeked);
    videoEl.currentTime = Math.min(targetTime, Math.max(0, (videoEl.duration || targetTime) - 0.01));
  });
}

// ==========================================
// 8. MP4 & AVI EXPORT
// ==========================================
document.getElementById("btn-export-mp4").onclick = () => exportTimeline("mp4");
document.getElementById("btn-export-avi").onclick = () => exportTimeline("avi");

async function exportTimeline(format) {
  const activeClips = clips.filter((c) => c.duration > 0);
  if (activeClips.length === 0) {
    return alert("Timeline mein kam az kam ek clip add karein.");
  }

  if (isPlaying) togglePlay();

  const exportDuration = activeClips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
  const totalFrames = Math.max(1, Math.ceil(exportDuration * EXPORT_FPS));

  const modal = document.getElementById("export-modal");
  const titleEl = document.getElementById("export-title");
  const statusEl = document.getElementById("export-status");
  const progressEl = document.getElementById("export-progress");

  modal.classList.remove("hidden");
  titleEl.textContent = format === "mp4" ? "Exporting Windows-Compatible MP4..." : "Exporting AVI Video...";
  progressEl.style.width = "0%";

  if (format === "mp4" && typeof VideoEncoder !== "undefined" && typeof Mp4Muxer !== "undefined") {
    try {
      statusEl.textContent = "Mixing all audio tracks & volume levels...";
      const audioBuffer = await renderMixedAudioBuffer(activeClips, exportDuration, 44100);

      const muxerTarget = new Mp4Muxer.ArrayBufferTarget();
      const hasAudio = audioBuffer.length > 0;

      const muxer = new Mp4Muxer.Muxer({
        target: muxerTarget,
        video: { codec: "avc", width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
        audio: hasAudio ? { codec: "aac", numberOfChannels: 2, sampleRate: 44100 } : undefined,
        fastStart: "in-memory",
      });

      const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (err) => console.error("VideoEncoder error:", err),
      });

      videoEncoder.configure({
        codec: "avc1.42001F",
        width: EXPORT_WIDTH,
        height: EXPORT_HEIGHT,
        bitrate: 5_000_000,
        framerate: EXPORT_FPS,
      });

      let audioEncoder = null;
      if (hasAudio && typeof AudioEncoder !== "undefined") {
        audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (err) => console.error("AudioEncoder error:", err),
        });

        audioEncoder.configure({
          codec: "mp4a.40.2",
          sampleRate: 44100,
          numberOfChannels: 2,
          bitrate: 128_000,
        });

        const sampleRate = 44100;
        const chunkSize = 1024;
        const left = audioBuffer.getChannelData(0);
        const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;

        for (let i = 0; i < left.length; i += chunkSize) {
          const len = Math.min(chunkSize, left.length - i);
          const interleaved = new Float32Array(len * 2);
          for (let j = 0; j < len; j++) {
            interleaved[j * 2] = left[i + j];
            interleaved[j * 2 + 1] = right[i + j];
          }

          const timestampUs = Math.round((i / sampleRate) * 1_000_000);
          const audioData = new AudioData({
            format: "f32",
            sampleRate,
            numberOfFrames: len,
            numberOfChannels: 2,
            timestamp: timestampUs,
            data: interleaved,
          });
          audioEncoder.encode(audioData);
          audioData.close();
        }
      }

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        const frameTime = frameIdx / EXPORT_FPS;

        const activeVideos = activeClips.filter(
          (c) => c.kind === "video" && frameTime >= c.start && frameTime < c.start + c.duration
        );
        for (const vc of activeVideos) {
          vc.media.pause();
          await waitForSeek(vc.media, vc.offset + (frameTime - vc.start));
        }

        renderCanvasFrame(frameTime);

        const timestampUs = Math.round(frameTime * 1_000_000);
        const durationUs = Math.round(1_000_000 / EXPORT_FPS);
        const frame = new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
        videoEncoder.encode(frame, { keyFrame: frameIdx % (EXPORT_FPS * 2) === 0 });
        frame.close();

        const pct = Math.min(98, Math.round(((frameIdx + 1) / totalFrames) * 98));
        progressEl.style.width = `${pct}%`;
        statusEl.textContent = `Encoding MP4 frame ${frameIdx + 1} / ${totalFrames} (${pct}%)`;
      }

      await videoEncoder.flush();
      if (audioEncoder) await audioEncoder.flush();
      muxer.finalize();

      const mp4Blob = new Blob([muxerTarget.buffer], { type: "video/mp4" });
      triggerDownload(mp4Blob, `StudioCut_Export_${Date.now()}.mp4`);
      progressEl.style.width = "100%";
    } catch (err) {
      console.error(err);
      alert("MP4 encoding error: " + err.message);
    } finally {
      modal.classList.add("hidden");
      renderCanvasFrame(currentTime);
    }
    return;
  }

  if (format === "avi") {
    try {
      const aviW = 640;
      const aviH = 360;
      const aviFps = 15;
      const aviTotalFrames = Math.min(900, Math.max(1, Math.ceil(exportDuration * aviFps)));

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = aviW;
      tempCanvas.height = aviH;
      const tempCtx = tempCanvas.getContext("2d");

      const framesBgr = [];
      for (let i = 0; i < aviTotalFrames; i++) {
        const t = i / aviFps;
        const activeVideos = activeClips.filter(
          (c) => c.kind === "video" && t >= c.start && t < c.start + c.duration
        );
        for (const vc of activeVideos) {
          vc.media.pause();
          await waitForSeek(vc.media, vc.offset + (t - vc.start));
        }
        renderCanvasFrame(t);
        tempCtx.drawImage(canvas, 0, 0, aviW, aviH);
        const imgData = tempCtx.getImageData(0, 0, aviW, aviH).data;
        framesBgr.push(rgbaToBottomUpBgr24(imgData, aviW, aviH));

        const pct = Math.min(95, Math.round(((i + 1) / aviTotalFrames) * 95));
        progressEl.style.width = `${pct}%`;
        statusEl.textContent = `Rendering AVI frame ${i + 1} / ${aviTotalFrames} (${pct}%)`;
      }

      statusEl.textContent = "Packaging AVI file...";
      const aviBlob = buildUncompressedAviBlob(framesBgr, aviW, aviH, aviFps);
      triggerDownload(aviBlob, `StudioCut_Export_${Date.now()}.avi`);
      progressEl.style.width = "100%";
    } catch (err) {
      console.error(err);
      alert("AVI export error: " + err.message);
    } finally {
      modal.classList.add("hidden");
      renderCanvasFrame(currentTime);
    }
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function rgbaToBottomUpBgr24(rgba, width, height) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const out = new Uint8Array(rowStride * height);

  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    const dstOffset = y * rowStride;
    for (let x = 0; x < width; x++) {
      const srcIdx = (srcRow * width + x) * 4;
      const dstIdx = dstOffset + x * 3;
      out[dstIdx] = rgba[srcIdx + 2];
      out[dstIdx + 1] = rgba[srcIdx + 1];
      out[dstIdx + 2] = rgba[srcIdx];
    }
  }
  return out;
}

function buildUncompressedAviBlob(frames, width, height, fps) {
  const frameSize = frames[0].length;
  const numFrames = frames.length;
  const usecPerFrame = Math.round(1_000_000 / fps);

  const writeFourCC = (buf, offset, str) => {
    for (let i = 0; i < 4; i++) buf[offset + i] = str.charCodeAt(i);
  };
  const writeU32 = (view, offset, val) => view.setUint32(offset, val, true);
  const writeI32 = (view, offset, val) => view.setInt32(offset, val, true);
  const writeU16 = (view, offset, val) => view.setUint16(offset, val, true);

  const avihData = new Uint8Array(56);
  const avihView = new DataView(avihData.buffer);
  writeU32(avihView, 0, usecPerFrame);
  writeU32(avihView, 4, frameSize * fps);
  writeU32(avihView, 16, 0x10);
  writeU32(avihView, 24, numFrames);
  writeU32(avihView, 32, 1);
  writeU32(avihView, 40, width);
  writeU32(avihView, 44, height);

  const strhData = new Uint8Array(56);
  const strhView = new DataView(strhData.buffer);
  writeFourCC(strhData, 0, "vids");
  writeU32(strhView, 20, 1);
  writeU32(strhView, 24, fps);
  writeU32(strhView, 32, numFrames);
  writeU32(strhView, 44, 10000);

  const strfData = new Uint8Array(40);
  const strfView = new DataView(strfData.buffer);
  writeU32(strfView, 0, 40);
  writeI32(strfView, 4, width);
  writeI32(strfView, 8, height);
  writeU16(strfView, 12, 1);
  writeU16(strfView, 14, 24);
  writeU32(strfView, 16, 0);
  writeU32(strfView, 20, frameSize);

  const makeChunk = (fourcc, payload) => {
    const chunk = new Uint8Array(8 + payload.length);
    writeFourCC(chunk, 0, fourcc);
    new DataView(chunk.buffer).setUint32(4, payload.length, true);
    chunk.set(payload, 8);
    return chunk;
  };

  const strlListPayload = concatUint8Arrays([
    makeChunk("strh", strhData),
    makeChunk("strf", strfData),
  ]);
  const strlList = makeList("strl", strlListPayload);
  const hdrlList = makeList("hdrl", concatUint8Arrays([makeChunk("avih", avihData), strlList]));

  const moviChunks = [];
  const idxEntries = [];
  let moviOffset = 4;

  for (let i = 0; i < numFrames; i++) {
    const chunk = makeChunk("00db", frames[i]);
    moviChunks.push(chunk);

    const entry = new Uint8Array(16);
    const ev = new DataView(entry.buffer);
    writeFourCC(entry, 0, "00db");
    writeU32(ev, 4, 0x10);
    writeU32(ev, 8, moviOffset);
    writeU32(ev, 12, frames[i].length);
    idxEntries.push(entry);

    moviOffset += chunk.length;
  }

  const moviList = makeList("movi", concatUint8Arrays(moviChunks));
  const idx1Chunk = makeChunk("idx1", concatUint8Arrays(idxEntries));

  const body = concatUint8Arrays([hdrlList, moviList, idx1Chunk]);
  const riff = new Uint8Array(12 + body.length);
  writeFourCC(riff, 0, "RIFF");
  new DataView(riff.buffer).setUint32(4, 4 + body.length, true);
  writeFourCC(riff, 8, "AVI ");
  riff.set(body, 12);

  return new Blob([riff], { type: "video/avi" });
}

function makeList(listType, contentBytes) {
  const out = new Uint8Array(12 + contentBytes.length);
  out[0] = "L".charCodeAt(0);
  out[1] = "I".charCodeAt(1);
  out[2] = "S".charCodeAt(2);
  out[3] = "T".charCodeAt(3);
  new DataView(out.buffer).setUint32(4, 4 + contentBytes.length, true);
  for (let i = 0; i < 4; i++) out[8 + i] = listType.charCodeAt(i);
  out.set(contentBytes, 12);
  return out;
}

function concatUint8Arrays(arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const arr of arrays) {
    result.set(arr, pos);
    pos += arr.length;
  }
  return result;
}

// Initial Render
syncInspectorUI();
renderTimeline();
renderCanvasFrame(0);
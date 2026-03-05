const app = window.comfyAPI?.app?.app || window.app;

const DEBUG = true;
const TARGET_INTERNAL = "PTQuadInitNode";
const TARGET_DISPLAY = "PT Quad Init";
const DOM_WIDGET_NAME = "pt_quad_editor_nodes2";
const DOM_WIDGET_HEIGHT = 240;
const QUAD_WIDGET_NAME = "quad_json";

function debugLog(message, payload = null) {
  if (!DEBUG) {
    return;
  }
  if (payload === null) {
    console.log("[PTQuadNodes2]", message);
  } else {
    console.log("[PTQuadNodes2]", message, payload);
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function defaultQuadNormalized() {
  return [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ];
}

function matchTargetValue(value) {
  if (!value) {
    return false;
  }
  const s = String(value);
  return s === TARGET_INTERNAL || s === TARGET_DISPLAY || s.includes(TARGET_INTERNAL) || s.includes(TARGET_DISPLAY);
}

function isTargetNodeData(nodeData) {
  return [
    nodeData?.name,
    nodeData?.display_name,
    nodeData?.displayName,
    nodeData?.class,
    nodeData?.comfyClass,
    nodeData?.type,
  ].some(matchTargetValue);
}

function isTargetNodeInstance(node) {
  return [
    node?.type,
    node?.comfyClass,
    node?.title,
    node?.constructor?.type,
  ].some(matchTargetValue);
}

function getQuadWidget(node) {
  return node.widgets?.find((w) => w.name === QUAD_WIDGET_NAME) || null;
}

function hideWidgetForNodes2(node, widget, suffix = "") {
  if (!widget || widget.__pt_nodes2_hidden) {
    return;
  }

  widget.__pt_nodes2_hidden = true;
  widget.origType = widget.type;
  widget.origComputeSize = widget.computeSize;
  widget.type = `converted-widget${suffix}`;
  widget.computeSize = () => [0, -4];
  widget.hidden = true;

  if (widget.element) {
    widget.element.style.display = "none";
    widget.element.style.visibility = "hidden";
  }
}

function ensureQuadWidget(node) {
  let widget = getQuadWidget(node);

  if (!widget && typeof node.addWidget === "function") {
    widget = node.addWidget("text", QUAD_WIDGET_NAME, "", () => {});
  }

  if (widget) {
    hideWidgetForNodes2(node, widget);
  }

  return widget;
}

function serializeQuadForWidget(quad) {
  const pts = quad.map(([x, y]) => [
    Number(clamp(x, 0, 1).toFixed(6)),
    Number(clamp(y, 0, 1).toFixed(6)),
  ]);
  return JSON.stringify({ pts });
}

function writeQuadToWidget(node, quad) {
  const widget = ensureQuadWidget(node);
  if (!widget) {
    return;
  }

  const value = serializeQuadForWidget(quad);
  widget.value = value;
  if (typeof widget.callback === "function") {
    widget.callback(value);
  }
}

function normalizeParsedQuad(points) {
  if (!Array.isArray(points) || points.length !== 4) {
    return null;
  }

  let maxAbs = 0;
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2) {
      return null;
    }
    maxAbs = Math.max(maxAbs, Math.abs(Number(point[0]) || 0), Math.abs(Number(point[1]) || 0));
  }

  if (maxAbs > 1.000001) {
    // Legacy pixel format fallback: assume 0..511-ish points.
    return points.map(([x, y]) => [
      clamp((Number(x) || 0) / 511.0, 0, 1),
      clamp((Number(y) || 0) / 511.0, 0, 1),
    ]);
  }

  return points.map(([x, y]) => [
    clamp(Number(x) || 0, 0, 1),
    clamp(Number(y) || 0, 0, 1),
  ]);
}

function parseQuadWidgetValue(rawValue) {
  if (!rawValue || !String(rawValue).trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (Array.isArray(parsed)) {
      return normalizeParsedQuad(parsed);
    }

    if (parsed && Array.isArray(parsed.pts)) {
      return normalizeParsedQuad(parsed.pts);
    }

    return null;
  } catch (error) {
    return null;
  }
}

function restoreQuadFromWidget(node, editor) {
  const widget = ensureQuadWidget(node);
  const rawValue = widget ? String(widget.value ?? "") : "";
  const restored = parseQuadWidgetValue(rawValue);

  if (restored) {
    editor.setQuadNormalized(restored);
    return;
  }

  editor.setQuadNormalized(defaultQuadNormalized());
  writeQuadToWidget(node, editor.quad);
}

function createDomContainer() {
  const container = document.createElement("div");
  container.style.position = "relative";
  container.style.width = "100%";
  container.style.height = `${DOM_WIDGET_HEIGHT}px`;
  container.style.minHeight = `${DOM_WIDGET_HEIGHT}px`;
  container.style.overflow = "hidden";
  container.style.borderRadius = "6px";
  container.style.background = "#181818";

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.textContent = "Reset";
  resetButton.style.position = "absolute";
  resetButton.style.right = "8px";
  resetButton.style.bottom = "8px";
  resetButton.style.padding = "2px 8px";
  resetButton.style.fontSize = "11px";
  resetButton.style.lineHeight = "1.4";
  resetButton.style.border = "1px solid rgba(255,255,255,0.25)";
  resetButton.style.background = "rgba(0,0,0,0.45)";
  resetButton.style.color = "#fff";
  resetButton.style.borderRadius = "4px";
  resetButton.style.cursor = "pointer";

  container.appendChild(canvas);
  container.appendChild(resetButton);
  return { container, canvas, resetButton };
}

function attachDomWidget(node, container) {
  if (typeof node.addDOMWidget === "function") {
    const widget = node.addDOMWidget(DOM_WIDGET_NAME, DOM_WIDGET_NAME, container, {
      serialize: false,
      hideOnZoom: false,
    });

    if (widget && typeof widget.computeSize === "function") {
      widget.computeSize = (width) => [width, DOM_WIDGET_HEIGHT];
    }

    return widget;
  }

  debugLog("addDOMWidget not available, fallback path");

  if (typeof node.addCustomWidget === "function") {
    node.addCustomWidget({
      name: DOM_WIDGET_NAME,
      type: "pt-dom-fallback",
      computeSize(width) {
        return [width, DOM_WIDGET_HEIGHT];
      },
      draw() {},
    });
  }

  return null;
}

class PTQuadEditor {
  constructor(node, state) {
    this.node = node;
    this.state = state;
    this.canvas = state.canvas;
    this.ctx = state.ctx;

    this.width = 1;
    this.height = 1;
    this.dpr = 1;

    this.image = null;
    this.imageRect = { x: 0, y: 0, w: 1, h: 1 };

    this.quad = defaultQuadNormalized();

    this.activeHandle = -1;
    this.hoverHandle = -1;
    this.dragMode = null;
    this.dragState = null;
    this.pointerId = null;

    this.onChange = null;

    this.setCursor("crosshair");
    this.bindPointerEvents();
  }

  setOnChange(callback) {
    this.onChange = callback;
  }

  emitChange() {
    if (typeof this.onChange === "function") {
      this.onChange(this.quad.map(([x, y]) => [x, y]));
    }
  }

  setCursor(value) {
    this.canvas.style.cursor = value;
  }

  updateCursorFromHit(hit) {
    if (this.dragMode) {
      this.setCursor("grabbing");
      return;
    }

    if (hit?.type === "handle") {
      this.setCursor("grab");
      return;
    }

    if (hit?.type === "inside") {
      this.setCursor("move");
      return;
    }

    this.setCursor("crosshair");
  }

  // TODO: hook point for future preview integration, e.g. from /view URL.
  setImage(url) {
    if (!url) {
      this.image = null;
      this.draw();
      return;
    }

    const img = new Image();
    img.onload = () => {
      this.image = img;
      this.draw();
    };
    img.onerror = () => {
      this.image = null;
      this.draw();
    };
    img.src = url;
  }

  setQuadNormalized(points) {
    if (!Array.isArray(points) || points.length !== 4) {
      return;
    }

    this.quad = points.map(([x, y]) => [
      clamp(Number(x) || 0, 0, 1),
      clamp(Number(y) || 0, 0, 1),
    ]);

    this.draw();
  }

  resize(cssWidth, cssHeight, dpr) {
    this.width = cssWidth;
    this.height = cssHeight;
    this.dpr = dpr;

    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.draw();
  }

  bindPointerEvents() {
    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this.onPointerCancel(e));
    this.canvas.addEventListener("lostpointercapture", () => this.stopDrag());
    this.canvas.addEventListener("pointerleave", () => {
      if (!this.dragMode) {
        this.hoverHandle = -1;
        this.setCursor("crosshair");
        this.draw();
      }
    });
  }

  getCanvasCoords(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  computeImageRect() {
    const w = this.width;
    const h = this.height;

    if (!this.image || !this.image.naturalWidth || !this.image.naturalHeight) {
      this.imageRect = { x: 0, y: 0, w, h };
      return;
    }

    const iw = this.image.naturalWidth;
    const ih = this.image.naturalHeight;

    const scale = Math.min(w / Math.max(1, iw), h / Math.max(1, ih));
    const drawW = iw * scale;
    const drawH = ih * scale;

    this.imageRect = {
      x: (w - drawW) * 0.5,
      y: (h - drawH) * 0.5,
      w: drawW,
      h: drawH,
    };
  }

  normToCanvas(point) {
    const r = this.imageRect;
    return [
      r.x + point[0] * r.w,
      r.y + point[1] * r.h,
    ];
  }

  canvasToNorm(x, y) {
    const r = this.imageRect;
    if (r.w <= 0 || r.h <= 0) {
      return [0.5, 0.5];
    }

    const nx = clamp((x - r.x) / r.w, 0, 1);
    const ny = clamp((y - r.y) / r.h, 0, 1);
    return [nx, ny];
  }

  distancePointToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = (abx * abx) + (aby * aby);

    if (ab2 <= 1e-8) {
      return Math.hypot(px - ax, py - ay);
    }

    const t = clamp(((apx * abx) + (apy * aby)) / ab2, 0, 1);
    const qx = ax + (abx * t);
    const qy = ay + (aby * t);
    return Math.hypot(px - qx, py - qy);
  }

  pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];

      const intersect = ((yi > y) !== (yj > y))
        && (x < (((xj - xi) * (y - yi)) / ((yj - yi) || 1e-8)) + xi);
      if (intersect) {
        inside = !inside;
      }
    }
    return inside;
  }

  hitTest(x, y) {
    const handleRadius = 10;

    const points = this.quad.map((p) => this.normToCanvas(p));
    for (let i = 0; i < points.length; i += 1) {
      const [hx, hy] = points[i];
      if (Math.hypot(x - hx, y - hy) <= handleRadius) {
        return { type: "handle", index: i };
      }
    }

    if (this.pointInPolygon(x, y, points)) {
      return { type: "inside", index: -1 };
    }

    const edgeThreshold = 8;
    for (let i = 0; i < points.length; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if (this.distancePointToSegment(x, y, ax, ay, bx, by) <= edgeThreshold) {
        return { type: "edge", index: i };
      }
    }

    return { type: "none", index: -1 };
  }

  applyClampedQuad(points) {
    this.quad = points.map(([x, y]) => [
      clamp(x, 0, 1),
      clamp(y, 0, 1),
    ]);
  }

  onPointerDown(event) {
    event.preventDefault();

    const { x, y } = this.getCanvasCoords(event);
    const hit = this.hitTest(x, y);

    debugLog("pointer events", { phase: "down", hit, x, y });

    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);

    if (hit.type === "handle") {
      this.dragMode = "handle";
      this.activeHandle = hit.index;
      this.dragState = null;
    } else if (hit.type === "inside") {
      this.dragMode = "quad";
      this.activeHandle = -1;

      const [nx, ny] = this.canvasToNorm(x, y);
      this.dragState = {
        startNorm: [nx, ny],
        startQuad: this.quad.map(([qx, qy]) => [qx, qy]),
      };
    } else {
      this.dragMode = null;
      this.activeHandle = -1;
      this.dragState = null;
    }

    this.updateCursorFromHit(hit);
    this.draw();
  }

  onPointerMove(event) {
    const { x, y } = this.getCanvasCoords(event);

    if (this.dragMode && this.pointerId === event.pointerId) {
      event.preventDefault();

      if (this.dragMode === "handle" && this.activeHandle >= 0) {
        const [nx, ny] = this.canvasToNorm(x, y);
        this.quad[this.activeHandle] = [nx, ny];
        this.emitChange();
      } else if (this.dragMode === "quad" && this.dragState) {
        const [nx, ny] = this.canvasToNorm(x, y);
        const dx = nx - this.dragState.startNorm[0];
        const dy = ny - this.dragState.startNorm[1];

        const next = this.dragState.startQuad.map(([qx, qy]) => [qx + dx, qy + dy]);
        this.applyClampedQuad(next);
        this.emitChange();
      }

      this.setCursor("grabbing");
      this.draw();
      debugLog("pointer events", { phase: "move", dragMode: this.dragMode, x, y });
      return;
    }

    const hit = this.hitTest(x, y);
    this.hoverHandle = hit.type === "handle" ? hit.index : -1;
    this.updateCursorFromHit(hit);
    this.draw();
  }

  stopDrag() {
    this.dragMode = null;
    this.dragState = null;
    this.activeHandle = -1;
    this.pointerId = null;
    this.setCursor("crosshair");
    this.draw();
  }

  onPointerUp(event) {
    if (this.pointerId === event.pointerId) {
      event.preventDefault();
      this.canvas.releasePointerCapture(event.pointerId);
      this.stopDrag();
      debugLog("pointer events", { phase: "up" });
    }
  }

  onPointerCancel(event) {
    if (this.pointerId === event.pointerId) {
      event.preventDefault();
      this.stopDrag();
      debugLog("pointer events", { phase: "cancel" });
    }
  }

  drawCheckerboard() {
    const { ctx, width, height } = this;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(0, 0, width, height);

    const step = 16;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const dark = ((x / step) + (y / step)) % 2 === 0;
        ctx.fillStyle = dark ? "#222" : "#2c2c2c";
        ctx.fillRect(x, y, step, step);
      }
    }
  }

  drawImageAndFrame() {
    const { ctx } = this;
    this.computeImageRect();

    if (this.image) {
      const r = this.imageRect;
      ctx.drawImage(this.image, r.x, r.y, r.w, r.h);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.strokeRect(0.5, 0.5, this.width - 1, this.height - 1);
  }

  drawQuad() {
    const { ctx } = this;
    const points = this.quad.map((p) => this.normToCanvas(p));

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.strokeStyle = "rgba(64,255,170,0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.stroke();

    points.forEach(([x, y], i) => {
      const isActive = this.activeHandle === i;
      const isHovered = this.hoverHandle === i;

      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "#ffffff" : (isHovered ? "#ffe599" : "#ff6a5f");
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    });

    ctx.restore();
  }

  draw() {
    this.drawCheckerboard();
    this.drawImageAndFrame();
    this.drawQuad();

    this.ctx.fillStyle = "rgba(255,255,255,0.65)";
    this.ctx.font = "12px monospace";
    this.ctx.fillText("PT Quad Editor (Nodes 2.0)", 10, 20);
  }
}

function resizeCanvas(node) {
  const state = node.__pt_nodes2_dom;
  if (!state || !state.editor) {
    return;
  }

  const rect = state.container.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  debugLog("resize", { cssWidth, cssHeight, dpr });
  state.editor.resize(cssWidth, cssHeight, dpr);
}

function setupNodes2Widget(node) {
  if (!node || node.__pt_nodes2_setup_done) {
    return;
  }

  node.__pt_nodes2_setup_done = true;

  const { container, canvas, resetButton } = createDomContainer();
  const ctx = canvas.getContext("2d");

  const widget = attachDomWidget(node, container);
  const quadWidget = ensureQuadWidget(node);

  node.__pt_nodes2_dom = {
    container,
    canvas,
    resetButton,
    ctx,
    widget,
    quadWidget,
    resizeObserver: null,
    editor: null,
  };

  const editor = new PTQuadEditor(node, node.__pt_nodes2_dom);
  editor.setOnChange((quad) => {
    writeQuadToWidget(node, quad);
  });
  node.__pt_nodes2_dom.editor = editor;

  restoreQuadFromWidget(node, editor);

  resetButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    editor.setQuadNormalized(defaultQuadNormalized());
    editor.emitChange();
    debugLog("pointer events", { phase: "reset" });
  });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      resizeCanvas(node);
    });
    ro.observe(container);
    node.__pt_nodes2_dom.resizeObserver = ro;
  }

  requestAnimationFrame(() => resizeCanvas(node));
  setTimeout(() => resizeCanvas(node), 50);

  debugLog("dom widget created", {
    id: node.id,
    type: node.type,
    hasWidget: Boolean(widget),
    hasQuadWidget: Boolean(quadWidget),
  });
}

if (app) {
  debugLog("extension loaded");

  app.registerExtension({
    name: "PT.QuadEditor.Nodes2",

    setup() {
      for (const node of app?.graph?._nodes || []) {
        if (isTargetNodeInstance(node)) {
          setupNodes2Widget(node);
        }
      }
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
      if (!isTargetNodeData(nodeData)) {
        return;
      }

      debugLog("target node matched", {
        nodeDataName: nodeData?.name,
        nodeDataClass: nodeData?.class,
        nodeDataComfyClass: nodeData?.comfyClass,
      });

      const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function onNodeCreated() {
        const result = originalOnNodeCreated?.apply(this, arguments);
        if (isTargetNodeInstance(this) || isTargetNodeData(nodeData)) {
          setupNodes2Widget(this);
        }
        return result;
      };
    },
  });
} else {
  console.warn("[PTQuadNodes2] app not found, extension not registered");
}

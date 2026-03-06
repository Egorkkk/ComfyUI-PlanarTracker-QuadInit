const app = window.comfyAPI?.app?.app || window.app;

const DEBUG = true;
const TARGET_INTERNAL = "PTQuadInitNode";
const TARGET_DISPLAY = "PT Quad Init";
const DOM_WIDGET_NAME = "pt_quad_editor_nodes2";
const DOM_WIDGET_WIDTH = 1280;
const DOM_WIDGET_HEIGHT = 720;
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

function markNodeChanged(node) {
  node?.setDirtyCanvas?.(true, true);
  node?.graph?.setDirtyCanvas?.(true, true);
  node?.graph?.change?.();
  app?.graph?.setDirtyCanvas?.(true, true);
  app?.graph?.change?.();
}

function writeQuadToWidget(node, quad) {
  const widget = ensureQuadWidget(node);
  if (!widget) {
    return { changed: false, value: "", reason: "missing_widget" };
  }

  const value = serializeQuadForWidget(quad);
  const previous = String(widget.value ?? "");
  const changed = previous !== value;
  if (!changed) {
    if (DEBUG) {
      debugLog("sync quad_json", { changed: false, value: `${value.slice(0, 96)}${value.length > 96 ? "..." : ""}` });
    }
    return { changed: false, value, reason: "same_value" };
  }

  widget.value = value;
  if (typeof widget.callback === "function") {
    widget.callback(value);
  }
  if (DEBUG) {
    debugLog("sync quad_json", { changed: true, value: `${value.slice(0, 96)}${value.length > 96 ? "..." : ""}` });
  }
  return { changed: true, value, reason: "updated" };
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
    editor.setNormalizedQuad(restored);
    if (DEBUG) {
      debugLog("restore quad_json", { status: "parsed", pts: restored });
    }
    return;
  }

  const fallback = defaultQuadNormalized();
  editor.setNormalizedQuad(fallback);
  if (DEBUG) {
    debugLog("restore quad_json", {
      status: "fallback_default",
      reason: rawValue.trim() ? "invalid_json_or_shape" : "empty_value",
    });
  }
  const syncResult = writeQuadToWidget(node, editor.getNormalizedQuad());
  if (syncResult?.changed) {
    markNodeChanged(node);
  }
}

function isImageDescriptor(value) {
  return Boolean(value && typeof value === "object" && typeof value.filename === "string");
}

function firstImageDescriptorInArray(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.find((item) => isImageDescriptor(item)) || null;
}

function scanObjectValuesForImageDescriptor(obj) {
  if (!obj || typeof obj !== "object") {
    return null;
  }
  for (const value of Object.values(obj)) {
    const descriptor = firstImageDescriptorInArray(value);
    if (descriptor) {
      return descriptor;
    }
  }
  return null;
}

function findPreviewImageDescriptor(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  let descriptor = firstImageDescriptorInArray(data.images);
  if (descriptor) {
    return descriptor;
  }

  descriptor = firstImageDescriptorInArray(data.output?.images);
  if (descriptor) {
    return descriptor;
  }

  descriptor = scanObjectValuesForImageDescriptor(data);
  if (descriptor) {
    return descriptor;
  }

  descriptor = scanObjectValuesForImageDescriptor(data.output);
  if (descriptor) {
    return descriptor;
  }

  return null;
}

function findUpstreamImageNodeId(node) {
  if (!node || !Array.isArray(node.inputs)) {
    return null;
  }

  const imagesInput = node.inputs.find((input) => input?.name === "images");
  const fallbackInput = node.inputs.find((input) => input && input.link != null);
  const input = imagesInput || fallbackInput;
  const linkId = input?.link;
  if (linkId == null) {
    return null;
  }

  const links = node.graph?.links;
  const link = links?.[linkId] || links?.[String(linkId)];
  return link?.origin_id ?? link?.originId ?? null;
}

function getCachedOutputs(nodeId) {
  if (nodeId == null) {
    return null;
  }

  const readById = (obj) => {
    if (!obj || typeof obj !== "object") {
      return null;
    }
    return obj[nodeId] || obj[String(nodeId)] || null;
  };

  return readById(app?.nodeOutputs)
    || readById(app?.graph?.nodeOutputs)
    || readById(app?.lastNodeOutputs)
    || null;
}

function extractImageDescriptorFromCachedOutputs(outputs) {
  return findPreviewImageDescriptor(outputs);
}

function buildComfyViewUrl(descriptor) {
  if (!isImageDescriptor(descriptor)) {
    return null;
  }
  const filename = descriptor.filename;
  const subfolder = descriptor.subfolder || "";
  const type = descriptor.type || "output";
  return `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
}

function extractPreviewImage(node, data) {
  try {
    if (!node?.__pt_nodes2_dom?.editor) {
      return;
    }

    if (data && typeof data === "object") {
      debugLog("onExecuted received", Object.keys(data || {}));
    }

    let descriptor = data && typeof data === "object" ? findPreviewImageDescriptor(data) : null;

    if (!descriptor) {
      const originId = findUpstreamImageNodeId(node);
      debugLog("preview upstream origin", { nodeId: node?.id, originId });

      const cachedOutputs = getCachedOutputs(originId);
      if (cachedOutputs && typeof cachedOutputs === "object") {
        debugLog("preview cache hit", {
          originId,
          keys: Object.keys(cachedOutputs),
        });
      } else {
        debugLog("preview cache miss", { originId });
      }
      descriptor = extractImageDescriptorFromCachedOutputs(cachedOutputs);
    }

    if (!descriptor) {
      return;
    }

    debugLog("preview image found", {
      filename: descriptor.filename,
      subfolder: descriptor.subfolder || "",
      type: descriptor.type || "output",
    });

    const url = buildComfyViewUrl(descriptor);
    if (!url) {
      return;
    }
    if (node.__pt_nodes2_dom.editor.imageUrl === url) {
      return;
    }

    debugLog("preview url", url);
    node.__pt_nodes2_dom.editor.setImage(url);
  } catch (error) {
    if (DEBUG) {
      console.warn("[PTQuadNodes2] extractPreviewImage failed", error);
    }
  }
}

function createDomContainer() {
  const container = document.createElement("div");
  container.style.position = "relative";
  container.style.width = `${DOM_WIDGET_WIDTH}px`;
  container.style.minWidth = `${DOM_WIDGET_WIDTH}px`;
  container.style.maxWidth = `${DOM_WIDGET_WIDTH}px`;
  container.style.height = `${DOM_WIDGET_HEIGHT}px`;
  container.style.minHeight = `${DOM_WIDGET_HEIGHT}px`;
  container.style.maxHeight = `${DOM_WIDGET_HEIGHT}px`;
  container.style.padding = "0";
  container.style.margin = "0";
  container.style.border = "0";
  container.style.boxSizing = "border-box";
  container.style.transform = "none";
  container.style.overflow = "hidden";
  container.style.borderRadius = "6px";
  container.style.background = "#181818";

  const canvas = document.createElement("canvas");
  canvas.style.width = `${DOM_WIDGET_WIDTH}px`;
  canvas.style.height = `${DOM_WIDGET_HEIGHT}px`;
  canvas.style.minWidth = `${DOM_WIDGET_WIDTH}px`;
  canvas.style.maxWidth = `${DOM_WIDGET_WIDTH}px`;
  canvas.style.minHeight = `${DOM_WIDGET_HEIGHT}px`;
  canvas.style.maxHeight = `${DOM_WIDGET_HEIGHT}px`;
  canvas.style.padding = "0";
  canvas.style.margin = "0";
  canvas.style.border = "0";
  canvas.style.boxSizing = "border-box";
  canvas.style.transform = "none";
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
      widget.computeSize = () => [DOM_WIDGET_WIDTH, DOM_WIDGET_HEIGHT];
    }

    return widget;
  }

  debugLog("addDOMWidget not available, fallback path");

  if (typeof node.addCustomWidget === "function") {
    node.addCustomWidget({
      name: DOM_WIDGET_NAME,
      type: "pt-dom-fallback",
      computeSize() {
        return [DOM_WIDGET_WIDTH, DOM_WIDGET_HEIGHT];
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
    this.imageUrl = "";
    this.imageRect = { x: 0, y: 0, w: 1, h: 1 };

    this.quad = defaultQuadNormalized();
    this.lastValidQuad = this.copyQuad(this.quad);

    this.activeHandle = -1;
    this.hoverHandle = -1;
    this.dragMode = null;
    this.dragState = null;
    this.pointerId = null;
    this.pointerDebugPos = null;
    this.lastPointerLogTs = 0;
    this.lastRectLogTs = 0;

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
      this.imageUrl = "";
      this.draw();
      return;
    }

    this.imageUrl = url;
    const requestedUrl = url;
    const img = new Image();
    img.onload = () => {
      if (this.imageUrl !== requestedUrl) {
        return;
      }
      this.image = img;
      this.draw();
    };
    img.onerror = () => {
      if (this.imageUrl !== requestedUrl) {
        return;
      }
      this.image = null;
      this.draw();
    };
    img.src = url;
  }

  getNormalizedQuad() {
    return this.quad.map(([x, y]) => [x, y]);
  }

  copyQuad(points) {
    return points.map(([x, y]) => [x, y]);
  }

  setNormalizedQuad(points) {
    if (!Array.isArray(points) || points.length !== 4) {
      return;
    }

    const next = points.map(([x, y]) => [
      clamp(Number(x) || 0, 0, 1),
      clamp(Number(y) || 0, 0, 1),
    ]);
    this.quad = next;
    if (this.isValidQuad(next)) {
      this.lastValidQuad = this.copyQuad(next);
    }

    this.draw();
  }

  // Backward-compatible alias.
  setQuadNormalized(points) {
    this.setNormalizedQuad(points);
  }

  syncToNodeWidget() {
    const result = writeQuadToWidget(this.node, this.getNormalizedQuad());
    if (result?.changed) {
      this.markChanged();
    }
    return result;
  }

  restoreFromNodeWidget() {
    restoreQuadFromWidget(this.node, this);
    this.lastValidQuad = this.copyQuad(this.quad);
  }

  markChanged() {
    markNodeChanged(this.node);
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
        this.pointerDebugPos = null;
        this.setCursor("crosshair");
        this.draw();
      }
    });
  }

  getCanvasCoords(event) {
    const rect = this.canvas.getBoundingClientRect();
    const safeWidth = rect.width > 0 ? rect.width : DOM_WIDGET_WIDTH;
    const safeHeight = rect.height > 0 ? rect.height : DOM_WIDGET_HEIGHT;
    const scaleX = DOM_WIDGET_WIDTH / safeWidth;
    const scaleY = DOM_WIDGET_HEIGHT / safeHeight;

    if (DEBUG) {
      const now = performance.now();
      if ((now - this.lastRectLogTs) > 200) {
        debugLog("pointer rect->logical", {
          rectW: Number(rect.width.toFixed(2)),
          rectH: Number(rect.height.toFixed(2)),
          scaleX: Number(scaleX.toFixed(4)),
          scaleY: Number(scaleY.toFixed(4)),
        });
        this.lastRectLogTs = now;
      }
    }

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
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

  pointsEqual(a, b, eps = 1e-6) {
    return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
  }

  cross(a, b, c) {
    return ((b[0] - a[0]) * (c[1] - a[1])) - ((b[1] - a[1]) * (c[0] - a[0]));
  }

  pointOnSegment(a, b, p, eps = 1e-8) {
    if (Math.abs(this.cross(a, b, p)) > eps) {
      return false;
    }
    const minX = Math.min(a[0], b[0]) - eps;
    const maxX = Math.max(a[0], b[0]) + eps;
    const minY = Math.min(a[1], b[1]) - eps;
    const maxY = Math.max(a[1], b[1]) + eps;
    return p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;
  }

  orientationSign(value, eps = 1e-8) {
    if (Math.abs(value) <= eps) {
      return 0;
    }
    return value > 0 ? 1 : -1;
  }

  segmentsIntersect(a, b, c, d) {
    const eps = 1e-8;

    // Exclude touching at shared endpoints.
    if (
      this.pointsEqual(a, c, eps)
      || this.pointsEqual(a, d, eps)
      || this.pointsEqual(b, c, eps)
      || this.pointsEqual(b, d, eps)
    ) {
      return false;
    }

    const o1 = this.cross(a, b, c);
    const o2 = this.cross(a, b, d);
    const o3 = this.cross(c, d, a);
    const o4 = this.cross(c, d, b);
    const s1 = this.orientationSign(o1, eps);
    const s2 = this.orientationSign(o2, eps);
    const s3 = this.orientationSign(o3, eps);
    const s4 = this.orientationSign(o4, eps);

    if (s1 * s2 < 0 && s3 * s4 < 0) {
      return true;
    }
    if (s1 === 0 && this.pointOnSegment(a, b, c, eps)) {
      return true;
    }
    if (s2 === 0 && this.pointOnSegment(a, b, d, eps)) {
      return true;
    }
    if (s3 === 0 && this.pointOnSegment(c, d, a, eps)) {
      return true;
    }
    if (s4 === 0 && this.pointOnSegment(c, d, b, eps)) {
      return true;
    }
    return false;
  }

  isSelfIntersecting(pts) {
    if (!Array.isArray(pts) || pts.length !== 4) {
      return true;
    }
    return this.segmentsIntersect(pts[0], pts[1], pts[2], pts[3])
      || this.segmentsIntersect(pts[1], pts[2], pts[3], pts[0]);
  }

  isConvexQuad(pts) {
    if (!Array.isArray(pts) || pts.length !== 4) {
      return false;
    }

    const eps = 1e-8;
    let sign = 0;
    let nonZeroCount = 0;

    for (let i = 0; i < 4; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const c = pts[(i + 2) % 4];
      const value = this.cross(a, b, c);
      const s = this.orientationSign(value, eps);
      if (s === 0) {
        continue;
      }
      nonZeroCount += 1;
      if (sign === 0) {
        sign = s;
      } else if (sign !== s) {
        return false;
      }
    }

    return nonZeroCount >= 3;
  }

  isValidQuad(pts) {
    return !this.isSelfIntersecting(pts) && this.isConvexQuad(pts);
  }

  finishPointerInteraction() {
    const hadDrag = Boolean(this.dragMode);
    if (!hadDrag) {
      this.stopDrag();
      return;
    }

    if (this.isValidQuad(this.quad)) {
      this.lastValidQuad = this.copyQuad(this.quad);
    } else {
      if (DEBUG) {
        console.warn("[PTQuadNodes2] Invalid quad (concave/self-intersecting) — reverting");
      }
      this.quad = this.copyQuad(this.lastValidQuad);
    }

    this.stopDrag();
    this.syncToNodeWidget();
    this.markChanged();
    this.draw();
  }

  onPointerDown(event) {
    event.preventDefault();

    const { x, y } = this.getCanvasCoords(event);
    this.pointerDebugPos = { x, y };
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

    if (this.dragMode) {
      this.lastValidQuad = this.copyQuad(this.quad);
    }

    this.updateCursorFromHit(hit);
    this.draw();
  }

  onPointerMove(event) {
    const { x, y } = this.getCanvasCoords(event);
    this.pointerDebugPos = { x, y };

    if (DEBUG) {
      const now = performance.now();
      if ((now - this.lastPointerLogTs) > 60) {
        debugLog("pointer coords", {
          x: Number(x.toFixed(2)),
          y: Number(y.toFixed(2)),
        });
        this.lastPointerLogTs = now;
      }
    }

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
      const { x, y } = this.getCanvasCoords(event);
      this.pointerDebugPos = { x, y };
      this.finishPointerInteraction();
      debugLog("pointer events", { phase: "up" });
    }
  }

  onPointerCancel(event) {
    if (this.pointerId === event.pointerId) {
      event.preventDefault();
      this.finishPointerInteraction();
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

    // Visual centroid marker (mean of 4 quad vertices).
    const centroidX = points.reduce((sum, p) => sum + p[0], 0) / 4;
    const centroidY = points.reduce((sum, p) => sum + p[1], 0) / 4;
    ctx.beginPath();
    ctx.arc(centroidX, centroidY, 5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(70,150,255,0.98)";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 1.25;
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  draw() {
    // Keep CSS-space drawing with DPR transform reset every frame.
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawCheckerboard();
    this.drawImageAndFrame();
    this.drawQuad();

    if (DEBUG && this.pointerDebugPos) {
      const { x, y } = this.pointerDebugPos;
      this.ctx.save();
      this.ctx.strokeStyle = "rgba(255,64,64,0.95)";
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(x - 8, y);
      this.ctx.lineTo(x + 8, y);
      this.ctx.moveTo(x, y - 8);
      this.ctx.lineTo(x, y + 8);
      this.ctx.stroke();
      this.ctx.restore();
    }

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

  const cssWidth = DOM_WIDGET_WIDTH;
  const cssHeight = DOM_WIDGET_HEIGHT;
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
  editor.setOnChange(() => {
    editor.syncToNodeWidget();
  });
  node.__pt_nodes2_dom.editor = editor;

  editor.restoreFromNodeWidget();
  extractPreviewImage(node, null);

  resetButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    editor.setNormalizedQuad(defaultQuadNormalized());
    editor.lastValidQuad = editor.copyQuad(editor.getNormalizedQuad());
    editor.syncToNodeWidget();
    editor.markChanged();
    editor.draw();
    debugLog("pointer events", { phase: "reset" });
  });

  const originalOnResize = node.onResize;
  node.onResize = function onResize() {
    const result = originalOnResize?.apply(this, arguments);
    debugLog("node resize", {
      nodeId: this?.id,
      nodeSize: this?.size,
    });
    // Keep fixed editor height; only canvas width responds to node width.
    resizeCanvas(this);
    return result;
  };

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

      const originalOnExecuted = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function onExecuted(data) {
        const result = originalOnExecuted?.apply(this, arguments);
        if (this?.__pt_nodes2_dom?.editor) {
          extractPreviewImage(this, data);
        }
        return result;
      };

      const originalOnConnectionsChange = nodeType.prototype.onConnectionsChange;
      nodeType.prototype.onConnectionsChange = function onConnectionsChange() {
        const result = originalOnConnectionsChange?.apply(this, arguments);
        if (this?.__pt_nodes2_dom?.editor) {
          extractPreviewImage(this, null);
        }
        return result;
      };
    },
  });
} else {
  console.warn("[PTQuadNodes2] app not found, extension not registered");
}

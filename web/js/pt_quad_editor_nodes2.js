const app = window.comfyAPI?.app?.app || window.app;

const DEBUG = true;
const TARGET_INTERNAL = "PTQuadInitNode";
const TARGET_DISPLAY = "PT Quad Init";
const DOM_WIDGET_NAME = "pt_quad_editor_nodes2";
const DOM_WIDGET_HEIGHT = 240;

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

  container.appendChild(canvas);
  return { container, canvas };
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

    this.quad = [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ];

    this.activeHandle = -1;
    this.dragMode = null;
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

  hitTest(x, y) {
    const handleRadius = 10;

    const points = this.quad.map((p) => this.normToCanvas(p));
    for (let i = 0; i < points.length; i += 1) {
      const [hx, hy] = points[i];
      if (Math.hypot(x - hx, y - hy) <= handleRadius) {
        return { type: "handle", index: i };
      }
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
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "#ffffff" : "#ff6a5f";
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

  const { container, canvas } = createDomContainer();
  const ctx = canvas.getContext("2d");

  const widget = attachDomWidget(node, container);

  node.__pt_nodes2_dom = {
    container,
    canvas,
    ctx,
    widget,
    resizeObserver: null,
    editor: null,
  };

  node.__pt_nodes2_dom.editor = new PTQuadEditor(node, node.__pt_nodes2_dom);

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

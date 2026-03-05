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

function drawPlaceholder(node) {
  const state = node.__pt_nodes2_dom;
  if (!state || !state.ctx) {
    return;
  }

  const { ctx, width, height } = state;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#1c1c1c";
  ctx.fillRect(0, 0, width, height);

  const step = 16;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const isDark = ((x / step) + (y / step)) % 2 === 0;
      ctx.fillStyle = isDark ? "#222" : "#2c2c2c";
      ctx.fillRect(x, y, step, step);
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "12px monospace";
  ctx.fillText("PT Quad Editor (Nodes 2.0)", 10, 20);
}

function resizeCanvas(node) {
  const state = node.__pt_nodes2_dom;
  if (!state) {
    return;
  }

  const rect = state.container.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  const targetW = Math.round(cssWidth * dpr);
  const targetH = Math.round(cssHeight * dpr);

  if (state.canvas.width !== targetW || state.canvas.height !== targetH) {
    state.canvas.width = targetW;
    state.canvas.height = targetH;
  }

  state.width = cssWidth;
  state.height = cssHeight;
  state.dpr = dpr;

  state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  debugLog("resize", { cssWidth, cssHeight, dpr });

  drawPlaceholder(node);
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
    width: 1,
    height: 1,
    dpr: 1,
    resizeObserver: null,
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

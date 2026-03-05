const app = window.comfyAPI?.app?.app || window.app;

const TARGET_NODE = "PTQuadInitNode";
const QUAD_WIDGET = "quad_json";
const CANVAS_SIZE = 512;
const PADDING = 8;
const HANDLE_RADIUS = 8;
const CENTER_RADIUS = 10;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isTargetNode(node) {
  if (!node) {
    return false;
  }
  const type = String(node.type || "");
  return node.comfyClass === TARGET_NODE || type === TARGET_NODE || type.includes(TARGET_NODE);
}

function getQuadWidget(node) {
  return node.widgets?.find((widget) => widget.name === QUAD_WIDGET) || null;
}

function defaultQuad(size = CANVAS_SIZE) {
  const x1 = Math.round(size * 0.2);
  const y1 = Math.round(size * 0.2);
  const x2 = Math.round(size * 0.8);
  const y2 = Math.round(size * 0.8);
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

function parseQuad(value) {
  if (!value || !String(value).trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 4) {
      return null;
    }

    return parsed.map((point) => {
      if (!Array.isArray(point) || point.length !== 2) {
        throw new Error("Invalid point");
      }
      return [
        clamp(Math.round(Number(point[0]) || 0), 0, CANVAS_SIZE - 1),
        clamp(Math.round(Number(point[1]) || 0), 0, CANVAS_SIZE - 1),
      ];
    });
  } catch (error) {
    return null;
  }
}

function serializeQuad(quad) {
  return JSON.stringify(quad.map(([x, y]) => [Math.round(x), Math.round(y)]));
}

function ensureState(node) {
  if (node.__pt2_state) {
    return node.__pt2_state;
  }

  node.__pt2_state = {
    quad: defaultQuad(),
    hover: { type: "none" },
    drag: { mode: null },
    lastWidgetRaw: null,
  };

  return node.__pt2_state;
}

function ensureNodeSize(node) {
  const widgetH = LiteGraph?.NODE_WIDGET_HEIGHT || 20;
  const widgetCount = node.widgets?.length || 0;
  const minW = CANVAS_SIZE + PADDING * 2;
  const minH = CANVAS_SIZE + PADDING * 2 + (widgetCount * (widgetH + 4)) + 36;

  const width = Math.max(node.size?.[0] || minW, minW);
  const height = Math.max(node.size?.[1] || minH, minH);

  if (!node.size || node.size[0] !== width || node.size[1] !== height) {
    node.setSize([width, height]);
  }
}

function getView(node) {
  const side = CANVAS_SIZE;
  const x = PADDING;
  const y = PADDING;
  const scale = side / CANVAS_SIZE;

  node.__pt2_view = {
    x,
    y,
    side,
    scale,
    imgW: CANVAS_SIZE,
    imgH: CANVAS_SIZE,
  };

  return node.__pt2_view;
}

function syncQuadFromWidget(node) {
  const state = ensureState(node);
  const widget = getQuadWidget(node);
  const raw = widget ? String(widget.value ?? "") : "";

  if (raw === state.lastWidgetRaw) {
    return;
  }

  const parsed = parseQuad(raw);
  state.quad = parsed || defaultQuad();
  state.lastWidgetRaw = raw;

  if (!parsed && widget) {
    const serialized = serializeQuad(state.quad);
    widget.value = serialized;
    if (typeof widget.callback === "function") {
      widget.callback(serialized);
    }
    state.lastWidgetRaw = serialized;
  }
}

function writeQuadToWidget(node) {
  const state = ensureState(node);
  const widget = getQuadWidget(node);
  const serialized = serializeQuad(state.quad);

  if (widget) {
    widget.value = serialized;
    if (typeof widget.callback === "function") {
      widget.callback(serialized);
    }
  }

  state.lastWidgetRaw = serialized;
  node.setDirtyCanvas(true, true);
  app?.graph?.setDirtyCanvas?.(true, true);
}

function imageToLocal(node, point) {
  const view = node.__pt2_view || getView(node);
  return [
    view.x + point[0] * view.scale,
    view.y + point[1] * view.scale,
  ];
}

function localToImage(node, localPos, clampToCanvas = false) {
  const view = node.__pt2_view || getView(node);
  const minX = view.x;
  const minY = view.y;
  const maxX = view.x + view.side;
  const maxY = view.y + view.side;

  let x = localPos[0];
  let y = localPos[1];
  const inside = x >= minX && x <= maxX && y >= minY && y <= maxY;

  if (!inside && !clampToCanvas) {
    return null;
  }

  x = clamp(x, minX, maxX);
  y = clamp(y, minY, maxY);

  return [
    clamp(Math.round((x - view.x) / view.scale), 0, CANVAS_SIZE - 1),
    clamp(Math.round((y - view.y) / view.scale), 0, CANVAS_SIZE - 1),
  ];
}

function quadCenter(quad) {
  const total = quad.reduce(
    (sum, [x, y]) => [sum[0] + x, sum[1] + y],
    [0, 0],
  );
  return [total[0] / 4, total[1] / 4];
}

function isInsideCanvas(node, localPos) {
  const view = node.__pt2_view || getView(node);
  return localPos[0] >= view.x
    && localPos[0] <= view.x + view.side
    && localPos[1] >= view.y
    && localPos[1] <= view.y + view.side;
}

function hitTest(node, localPos) {
  const state = ensureState(node);

  for (let i = 0; i < state.quad.length; i += 1) {
    const [x, y] = imageToLocal(node, state.quad[i]);
    if (Math.hypot(localPos[0] - x, localPos[1] - y) <= HANDLE_RADIUS) {
      return { type: "handle", index: i };
    }
  }

  const [cx, cy] = imageToLocal(node, quadCenter(state.quad));
  if (Math.hypot(localPos[0] - cx, localPos[1] - cy) <= CENTER_RADIUS) {
    return { type: "center" };
  }

  if (isInsideCanvas(node, localPos)) {
    return { type: "draw" };
  }

  return { type: "none" };
}

function drawCanvas(node, ctx) {
  const view = getView(node);

  ctx.save();
  ctx.fillStyle = "rgba(20,20,20,0.95)";
  ctx.fillRect(view.x, view.y, view.side, view.side);
  ctx.strokeStyle = "rgba(180,180,180,0.35)";
  ctx.strokeRect(view.x, view.y, view.side, view.side);
  ctx.restore();
}

function drawQuad(node, ctx) {
  const state = ensureState(node);
  syncQuadFromWidget(node);

  const points = state.quad.map((point) => imageToLocal(node, point));
  const center = imageToLocal(node, quadCenter(state.quad));

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
    const active = state.drag.mode === "handle" && state.drag.index === i;
    const hovered = state.hover.type === "handle" && state.hover.index === i;

    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS - 1, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#ffffff" : (hovered ? "#ffe599" : "#ff6a5f");
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.arc(center[0], center[1], CENTER_RADIUS - 2, 0, Math.PI * 2);
  ctx.fillStyle = state.drag.mode === "center"
    ? "#ffffff"
    : (state.hover.type === "center" ? "#9fd8ff" : "#5eb4ff");
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function beginDrag(node, localPos) {
  const state = ensureState(node);
  syncQuadFromWidget(node);

  const hit = hitTest(node, localPos);
  if (hit.type === "none") {
    return false;
  }

  const imagePoint = localToImage(node, localPos, true);
  if (!imagePoint) {
    return false;
  }

  if (hit.type === "handle") {
    state.drag = { mode: "handle", index: hit.index };
  } else if (hit.type === "center") {
    state.drag = {
      mode: "center",
      startPoint: imagePoint,
      startQuad: state.quad.map(([x, y]) => [x, y]),
    };
  } else {
    state.drag = {
      mode: "draw",
      startPoint: imagePoint,
    };
    state.quad = [
      [...imagePoint],
      [...imagePoint],
      [...imagePoint],
      [...imagePoint],
    ];
    writeQuadToWidget(node);
  }

  node.setDirtyCanvas(true, true);
  app?.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function updateDrag(node, localPos) {
  const state = ensureState(node);

  if (!state.drag?.mode) {
    const hover = hitTest(node, localPos);
    if (hover.type !== state.hover.type || hover.index !== state.hover.index) {
      state.hover = hover;
      node.setDirtyCanvas(true, true);
      app?.graph?.setDirtyCanvas?.(true, true);
    }
    return false;
  }

  const point = localToImage(node, localPos, true);
  if (!point) {
    return true;
  }

  if (state.drag.mode === "handle") {
    state.quad[state.drag.index] = point;
  } else if (state.drag.mode === "center") {
    const dx = point[0] - state.drag.startPoint[0];
    const dy = point[1] - state.drag.startPoint[1];

    state.quad = state.drag.startQuad.map(([x, y]) => [
      clamp(x + dx, 0, CANVAS_SIZE - 1),
      clamp(y + dy, 0, CANVAS_SIZE - 1),
    ]);
  } else if (state.drag.mode === "draw") {
    const x1 = Math.min(state.drag.startPoint[0], point[0]);
    const y1 = Math.min(state.drag.startPoint[1], point[1]);
    const x2 = Math.max(state.drag.startPoint[0], point[0]);
    const y2 = Math.max(state.drag.startPoint[1], point[1]);

    state.quad = [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ];
  }

  writeQuadToWidget(node);
  return true;
}

function endDrag(node) {
  const state = ensureState(node);
  if (!state.drag?.mode) {
    return false;
  }

  state.drag = { mode: null };
  writeQuadToWidget(node);
  return true;
}

function setupNode(node) {
  if (node.__pt2_min_canvas_ready) {
    return;
  }

  node.__pt2_min_canvas_ready = true;
  ensureState(node);
  ensureNodeSize(node);

  const originalDrawForeground = node.onDrawForeground;
  node.onDrawForeground = function onDrawForeground(ctx) {
    const result = originalDrawForeground?.apply(this, arguments);
    drawCanvas(this, ctx);
    drawQuad(this, ctx);
    return result;
  };

  const originalOnResize = node.onResize;
  node.onResize = function onResize() {
    const result = originalOnResize?.apply(this, arguments);
    ensureNodeSize(this);
    this.setDirtyCanvas(true, true);
    app?.graph?.setDirtyCanvas?.(true, true);
    return result;
  };

  const originalOnMouseDown = node.onMouseDown;
  node.onMouseDown = function onMouseDown(e, localPos) {
    const result = originalOnMouseDown?.apply(this, arguments);
    if (result === true) {
      return true;
    }
    if (!e || e.button !== 0) {
      return result;
    }
    return beginDrag(this, localPos) || result;
  };

  const originalOnMouseMove = node.onMouseMove;
  node.onMouseMove = function onMouseMove(e, localPos) {
    const result = originalOnMouseMove?.apply(this, arguments);
    const handled = updateDrag(this, localPos);
    return handled || result;
  };

  const originalOnMouseUp = node.onMouseUp;
  node.onMouseUp = function onMouseUp() {
    const result = originalOnMouseUp?.apply(this, arguments);
    const handled = endDrag(this);
    return handled || result;
  };
}

if (app) {
  app.registerExtension({
    name: "PT.QuadInitV2",

    setup() {
      for (const node of app?.graph?._nodes || []) {
        if (isTargetNode(node)) {
          setupNode(node);
        }
      }
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
      if (nodeData?.name !== TARGET_NODE) {
        return;
      }

      const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function onNodeCreated() {
        const result = originalOnNodeCreated?.apply(this, arguments);
        setupNode(this);
        return result;
      };
    },
  });
}

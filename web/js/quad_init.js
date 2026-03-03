const app = window.comfyAPI?.app?.app || window.app;
const comfyApi = window.comfyAPI?.api?.api || window.api;
const DEBUG = false;

const TARGET_NODE = "PTQuadInitNode";
const STATE_WIDGET = "quad_json";
const HANDLE_RADIUS = 8;
const CENTER_RADIUS = 10;

function debugLog(...args) {
  if (!DEBUG) {
    return;
  }
  console.log("[PTQuadInit]", ...args);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatQuad(points) {
  return JSON.stringify(points.map(([x, y]) => [Math.round(x), Math.round(y)]));
}

function defaultQuad(width, height) {
  const x1 = Math.round(width * 0.2);
  const x2 = Math.round(width * 0.8);
  const y1 = Math.round(height * 0.2);
  const y2 = Math.round(height * 0.8);
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

function parseQuad(value, width, height) {
  const fallback = defaultQuad(width, height);
  if (!value || !String(value).trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 4) {
      return fallback;
    }

    return parsed.map((point) => {
      if (!Array.isArray(point) || point.length !== 2) {
        throw new Error("Invalid point");
      }

      return [
        clamp(Math.round(Number(point[0]) || 0), 0, Math.max(0, width - 1)),
        clamp(Math.round(Number(point[1]) || 0), 0, Math.max(0, height - 1)),
      ];
    });
  } catch (error) {
    return fallback;
  }
}

function getWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name) || null;
}

function getPreviewImage(node) {
  const manualImage = node.__pt_preview_img;
  if (manualImage?.complete) {
    const width = node.__pt_imgW || manualImage.naturalWidth || manualImage.videoWidth || manualImage.width || null;
    const height = node.__pt_imgH || manualImage.naturalHeight || manualImage.videoHeight || manualImage.height || null;
    if (width && height) {
      return {
        image: manualImage,
        width,
        height,
        source: "manual",
      };
    }
  }

  const fallbackImage = node.imgs?.[0];
  if (fallbackImage) {
    const width = fallbackImage.naturalWidth || fallbackImage.videoWidth || fallbackImage.width || null;
    const height = fallbackImage.naturalHeight || fallbackImage.videoHeight || fallbackImage.height || null;
    if (width && height) {
      return {
        image: fallbackImage,
        width,
        height,
        source: "node.imgs",
      };
    }
  }

  return null;
}

function buildViewUrl(descriptor) {
  if (!descriptor?.filename) {
    return null;
  }

  const params = new URLSearchParams({
    filename: descriptor.filename,
    subfolder: descriptor.subfolder || "",
    type: descriptor.type || "temp",
  });
  return `/view?${params.toString()}`;
}

function extractPreviewDescriptor(message) {
  return extractPreviewDescriptorAny(message);
}

function extractPreviewDescriptorAny(payload) {
  const candidates = [
    payload?.images?.[0],
    payload?.ui?.images?.[0],
    payload?.output?.images?.[0],
    payload?.output?.ui?.images?.[0],
    payload?.detail?.images?.[0],
    payload?.detail?.output?.images?.[0],
    payload?.detail?.output?.ui?.images?.[0],
    payload?.detail?.ui?.images?.[0],
    payload?.data?.images?.[0],
    payload?.data?.output?.images?.[0],
    payload?.data?.output?.ui?.images?.[0],
    payload?.data?.ui?.images?.[0],
    payload?.result?.images?.[0],
    payload?.result?.ui?.images?.[0],
    payload?.outputs?.ui?.images?.[0],
  ];

  for (const candidate of candidates) {
    if (candidate?.filename) {
      return candidate;
    }
  }

  return null;
}

function getPayloadNodeId(payload) {
  const candidates = [
    payload?.node,
    payload?.node_id,
    payload?.nodeId,
    payload?.detail?.node,
    payload?.detail?.node_id,
    payload?.detail?.nodeId,
    payload?.data?.node,
    payload?.data?.node_id,
    payload?.data?.nodeId,
    payload?.output?.node,
    payload?.output?.node_id,
    payload?.output?.nodeId,
    payload?.result?.node,
    payload?.result?.node_id,
    payload?.result?.nodeId,
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) {
      return Number(candidate);
    }
  }

  return null;
}

function getNodeById(nodeId) {
  if (nodeId === null || nodeId === undefined || Number.isNaN(nodeId)) {
    return null;
  }

  return app?.graph?.getNodeById?.(nodeId) || app?.graph?._nodes_by_id?.[nodeId] || null;
}

function findSingleTargetNode() {
  const nodes = app?.graph?._nodes || [];
  const matches = nodes.filter((node) => isTargetNode(node));
  if (matches.length === 1) {
    return matches[0];
  }
  return null;
}

function isTargetNode(node) {
  if (!node) {
    return false;
  }

  return node.comfyClass === TARGET_NODE || node.type === TARGET_NODE || String(node.type || "").includes(TARGET_NODE);
}

function hookExecutedListener() {
  if (window.__PT_QUADINIT_EXECUTED_HOOKED) {
    return;
  }

  if (!comfyApi?.addEventListener) {
    debugLog("executed-hook-unavailable");
    return;
  }

  window.__PT_QUADINIT_EXECUTED_HOOKED = true;
  comfyApi.addEventListener("executed", (event) => {
    const payload = event?.detail || event;
    const nodeId = getPayloadNodeId(payload);
    const descriptor = extractPreviewDescriptorAny(payload);
    debugLog("api-executed", {
      nodeId,
      payloadKeys: Object.keys(payload || {}),
      descriptor,
    });

    if (!descriptor) {
      return;
    }

    const node = getNodeById(nodeId) || findSingleTargetNode();
    if (!isTargetNode(node)) {
      debugLog("api-executed-skip", { nodeId, hasNode: Boolean(node) });
      return;
    }

    loadPreviewDescriptor(node, descriptor);
  });
}

function loadPreviewDescriptor(node, descriptor) {
  const url = buildViewUrl(descriptor);
  if (!url) {
    debugLog("preview-descriptor-missing-url", { id: node.id, descriptor });
    return;
  }

  debugLog("preview-descriptor", { id: node.id, descriptor, url });

  if (node.__pt_preview_url === url && node.__pt_preview_img?.complete) {
    return;
  }

  const img = new Image();
  img.onload = () => {
    node.__pt_preview_url = url;
    node.__pt_preview_img = img;
    node.__pt_imgW = img.naturalWidth || img.width || 0;
    node.__pt_imgH = img.naturalHeight || img.height || 0;
    debugLog("preview-loaded", {
      id: node.id,
      url,
      width: node.__pt_imgW,
      height: node.__pt_imgH,
    });
    ensureNodeSizeForImage(node, node.__pt_imgW, node.__pt_imgH);
    node.setDirtyCanvas(true, true);
    app?.graph?.setDirtyCanvas?.(true, true);
  };
  img.onerror = (error) => {
    debugLog("preview-load-failed", { id: node.id, url, error });
  };
  img.src = url;
}

function ensureNodeSizeForImage(node, imageWidth, imageHeight) {
  if (node.__pt_resized) {
    return;
  }

  const targetWidth = Math.max(node.size?.[0] || 420, 420);
  const widgetHeight = LiteGraph?.NODE_WIDGET_HEIGHT || 20;
  const widgetCount = node.widgets?.length || 0;
  const widgetsBlockHeight = widgetCount > 0 ? (widgetCount * (widgetHeight + 4)) + 12 : 12;
  const previewHeight = clamp(Math.round(targetWidth * (imageHeight / Math.max(1, imageWidth))), 180, 360);
  const targetHeight = Math.max(node.size?.[1] || 0, previewHeight + widgetsBlockHeight + 44);

  node.__pt_resized = true;
  node.setSize([targetWidth, targetHeight]);
  node.setDirtyCanvas(true, true);
  app?.graph?.setDirtyCanvas?.(true, true);
}

function getKnownImageSize(node) {
  const preview = getPreviewImage(node);
  if (preview) {
    return { width: preview.width, height: preview.height };
  }

  const state = node.__ptQuadState;
  if (state?.imageWidth && state?.imageHeight) {
    return { width: state.imageWidth, height: state.imageHeight };
  }

  return { width: 512, height: 512 };
}

function syncQuadFromWidget(node, force = false) {
  const state = node.__ptQuadState;
  if (!state || state.drag.mode) {
    return;
  }

  const widget = getWidget(node, STATE_WIDGET);
  const widgetValue = widget ? String(widget.value ?? "") : "";
  const { width, height } = getKnownImageSize(node);
  const sizeKey = `${width}x${height}`;
  if (!force && widgetValue === state.lastWidgetValue && sizeKey === state.lastParsedSizeKey) {
    return;
  }

  state.quad = parseQuad(widgetValue, width, height);
  state.lastWidgetValue = widgetValue;
  state.lastParsedSizeKey = sizeKey;
}

function writeQuadToWidget(node) {
  const state = node.__ptQuadState;
  const widget = getWidget(node, STATE_WIDGET);
  if (!state || !widget) {
    return;
  }

  const serialized = formatQuad(state.quad);
  state.lastWidgetValue = serialized;
  widget.value = serialized;
  if (typeof widget.callback === "function") {
    widget.callback(serialized);
  }
  node.setDirtyCanvas(true, true);
  app?.graph?.setDirtyCanvas?.(true, true);
}

async function queueCurrentWorkflow(node) {
  try {
    if (app?.queuePrompt) {
      try {
        await app.queuePrompt(0);
        return;
      } catch (error) {
        await app.queuePrompt();
        return;
      }
    }

    if (comfyApi?.queuePrompt) {
      try {
        await comfyApi.queuePrompt(0);
      } catch (error) {
        await comfyApi.queuePrompt();
      }
      return;
    }
  } catch (error) {
    console.error("[PTQuadInit] Failed to queue prompt", error);
  } finally {
    node.setDirtyCanvas(true, true);
    app?.graph?.setDirtyCanvas?.(true, true);
  }
}

function computePreviewRect(node) {
  const state = node.__ptQuadState;
  const preview = getPreviewImage(node);
  const imageWidth = preview?.width || state?.imageWidth || 512;
  const imageHeight = preview?.height || state?.imageHeight || 512;

  if (state) {
    state.imageWidth = imageWidth;
    state.imageHeight = imageHeight;
  }

  const titleHeight = LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const widgetHeight = LiteGraph?.NODE_WIDGET_HEIGHT || 20;
  const widgetCount = node.widgets?.length || 0;
  const sidePadding = 10;
  const gap = 10;
  const widgetsBlockHeight = widgetCount > 0 ? (widgetCount * (widgetHeight + 4)) + 8 : 0;
  const previewBoundsWidth = Math.max(40, (node.size?.[0] || 360) - sidePadding * 2);
  const maxPreviewHeight = Math.max(120, (node.size?.[1] || 340) - titleHeight - widgetsBlockHeight - gap * 2);
  const previewBoundsHeight = Math.min(360, maxPreviewHeight);
  const scale = Math.min(previewBoundsWidth / imageWidth, previewBoundsHeight / imageHeight);
  const drawWidth = Math.max(1, imageWidth * scale);
  const drawHeight = Math.max(1, imageHeight * scale);
  const offsetX = sidePadding + (previewBoundsWidth - drawWidth) / 2;
  const offsetY = titleHeight + gap + (previewBoundsHeight - drawHeight) / 2;

  const rect = {
    x: offsetX,
    y: offsetY,
    width: drawWidth,
    height: drawHeight,
    scale,
    imageWidth,
    imageHeight,
    hasPreview: Boolean(preview),
  };

  if (state) {
    state.viewport = rect;
  }

  node.__pt_view = rect;
  debugLog("preview-rect", {
    id: node.id,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    scale: rect.scale,
    hasPreview: rect.hasPreview,
  });

  return rect;
}

function imageToCanvas(node, point) {
  const viewport = node.__pt_view || node.__ptQuadState.viewport || computePreviewRect(node);
  return [
    viewport.x + point[0] * viewport.scale,
    viewport.y + point[1] * viewport.scale,
  ];
}

function localToImagePoint(node, localPos, clampToRect = false) {
  const rect = node.__pt_view || node.__ptQuadState.viewport || computePreviewRect(node);
  if (!rect.scale) {
    return null;
  }

  let x = localPos[0];
  let y = localPos[1];
  const inside = x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;

  if (!inside && !clampToRect) {
    return null;
  }

  x = clamp(x, rect.x, rect.x + rect.width);
  y = clamp(y, rect.y, rect.y + rect.height);

  return [
    clamp(Math.round((x - rect.x) / rect.scale), 0, Math.max(0, rect.imageWidth - 1)),
    clamp(Math.round((y - rect.y) / rect.scale), 0, Math.max(0, rect.imageHeight - 1)),
  ];
}

function getQuadCenter(points) {
  const total = points.reduce(
    (sum, [x, y]) => [sum[0] + x, sum[1] + y],
    [0, 0],
  );
  return [total[0] / 4, total[1] / 4];
}

function hitTest(node, localPos) {
  const state = node.__ptQuadState;
  const rect = node.__pt_view || state.viewport || computePreviewRect(node);
  const inside = localPos[0] >= rect.x && localPos[1] >= rect.y && localPos[0] <= rect.x + rect.width && localPos[1] <= rect.y + rect.height;

  if (!inside) {
    return { type: "none" };
  }

  for (let index = 0; index < state.quad.length; index += 1) {
    const [hx, hy] = imageToCanvas(node, state.quad[index]);
    if (Math.hypot(localPos[0] - hx, localPos[1] - hy) <= HANDLE_RADIUS) {
      return { type: "handle", index };
    }
  }

  const [cx, cy] = imageToCanvas(node, getQuadCenter(state.quad));
  if (Math.hypot(localPos[0] - cx, localPos[1] - cy) <= CENTER_RADIUS) {
    return { type: "center" };
  }

  return { type: "draw" };
}
function drawOverlay(node, ctx) {
  const state = node.__ptQuadState;
  if (!state) {
    return;
  }

  const rect = computePreviewRect(node);
  const preview = getPreviewImage(node);
  const canvasPoints = state.quad.map((point) => imageToCanvas(node, point));
  const center = imageToCanvas(node, getQuadCenter(state.quad));

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (preview) {
    ctx.drawImage(preview.image, rect.x, rect.y, rect.width, rect.height);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  ctx.strokeStyle = "rgba(48, 255, 160, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  canvasPoints.forEach(([x, y], index) => {
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 160, 0, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(canvasPoints[0][0], canvasPoints[0][1]);
  ctx.lineTo(canvasPoints[2][0], canvasPoints[2][1]);
  ctx.moveTo(canvasPoints[1][0], canvasPoints[1][1]);
  ctx.lineTo(canvasPoints[3][0], canvasPoints[3][1]);
  ctx.stroke();

  canvasPoints.forEach(([x, y], index) => {
    const isHovered = state.hover.type === "handle" && state.hover.index === index;
    const isActive = state.drag.mode === "handle" && state.drag.index === index;
    ctx.beginPath();
    ctx.fillStyle = isActive ? "#ffffff" : (isHovered ? "#ffd966" : "#ff625a");
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 1.5;
    ctx.arc(x, y, HANDLE_RADIUS - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.fillStyle = state.drag.mode === "center" ? "#ffffff" : (state.hover.type === "center" ? "#a6d8ff" : "#5fb3ff");
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 1.5;
  ctx.arc(center[0], center[1], CENTER_RADIUS - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (!preview) {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "11px monospace";
    ctx.fillText("Run queue to load preview", rect.x + 8, rect.y + 18);
  }

  ctx.restore();
}

function beginDrag(node, localPos) {
  const state = node.__ptQuadState;
  if (!getPreviewImage(node)) {
    return false;
  }
  const imagePoint = localToImagePoint(node, localPos, false);
  if (!state || !imagePoint) {
    return false;
  }

  syncQuadFromWidget(node);
  const hit = hitTest(node, localPos);

  if (hit.type === "handle") {
    state.drag = { mode: "handle", index: hit.index };
  } else if (hit.type === "center") {
    state.drag = {
      mode: "center",
      startPoint: imagePoint,
      startQuad: state.quad.map((point) => [...point]),
    };
  } else if (hit.type === "draw") {
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
  } else {
    return false;
  }

  node.setDirtyCanvas(true, true);
  app?.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function updateDrag(node, localPos) {
  const state = node.__ptQuadState;
  if (!state) {
    return false;
  }

  if (!state.drag.mode) {
    const hoverHit = hitTest(node, localPos);
    if (hoverHit.type !== state.hover.type || hoverHit.index !== state.hover.index) {
      state.hover = hoverHit;
      node.setDirtyCanvas(true, true);
      app?.graph?.setDirtyCanvas?.(true, true);
    }
    return false;
  }

  const imagePoint = localToImagePoint(node, localPos, true);
  if (!imagePoint) {
    return true;
  }

  if (state.drag.mode === "handle") {
    state.quad[state.drag.index] = imagePoint;
  } else if (state.drag.mode === "center") {
    const dx = imagePoint[0] - state.drag.startPoint[0];
    const dy = imagePoint[1] - state.drag.startPoint[1];
    state.quad = state.drag.startQuad.map(([x, y]) => [
      clamp(x + dx, 0, Math.max(0, state.imageWidth - 1)),
      clamp(y + dy, 0, Math.max(0, state.imageHeight - 1)),
    ]);
  } else if (state.drag.mode === "draw") {
    const x1 = Math.min(state.drag.startPoint[0], imagePoint[0]);
    const y1 = Math.min(state.drag.startPoint[1], imagePoint[1]);
    const x2 = Math.max(state.drag.startPoint[0], imagePoint[0]);
    const y2 = Math.max(state.drag.startPoint[1], imagePoint[1]);
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
  const state = node.__ptQuadState;
  if (!state?.drag.mode) {
    return false;
  }

  state.drag = { mode: null };
  writeQuadToWidget(node);
  return true;
}

function setupNode(node) {
  if (node.__ptQuadState) {
    return;
  }

  node.addWidget("button", "Apply image", null, async () => {
    await queueCurrentWorkflow(node);
  });

  node.__ptQuadState = {
    quad: defaultQuad(512, 512),
    viewport: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
    hover: { type: null },
    drag: { mode: null },
    imageWidth: 512,
    imageHeight: 512,
    lastWidgetValue: null,
    lastParsedSizeKey: null,
  };

  syncQuadFromWidget(node, true);
  debugLog("node-created", { id: node.id, type: node.type });

  if (!node.size || node.size[1] < 340) {
    node.setSize([Math.max(node.size?.[0] || 360, 360), 340]);
  }

  const originalDrawForeground = node.onDrawForeground;
  node.onDrawForeground = function onDrawForeground(ctx) {
    const result = originalDrawForeground?.apply(this, arguments);
    const preview = getPreviewImage(this);
    if (preview) {
      ensureNodeSizeForImage(this, preview.width, preview.height);
    }
    syncQuadFromWidget(this);
    drawOverlay(this, ctx);
    return result;
  };

  const originalOnResize = node.onResize;
  node.onResize = function onResize(size) {
    const result = originalOnResize?.apply(this, arguments);
    this.setDirtyCanvas(true, true);
    app?.graph?.setDirtyCanvas?.(true, true);
    return result;
  };

  const originalOnExecuted = node.onExecuted;
  node.onExecuted = function onExecuted(message) {
    const result = originalOnExecuted?.apply(this, arguments);
    const descriptor = extractPreviewDescriptor(message);
    debugLog("onExecuted", {
      id: this.id,
      keys: Object.keys(message || {}),
      descriptor,
      stateWidget: getWidget(this, STATE_WIDGET)?.name || null,
      outputs: this.outputs?.map((output) => ({ name: output.name, type: output.type })),
    });
    if (descriptor) {
      loadPreviewDescriptor(this, descriptor);
    }
    this.setDirtyCanvas(true, true);
    app?.graph?.setDirtyCanvas?.(true, true);
    return result;
  };

  const originalOnConnectionsChange = node.onConnectionsChange;
  node.onConnectionsChange = function onConnectionsChange() {
    const result = originalOnConnectionsChange?.apply(this, arguments);
    this.setDirtyCanvas(true, true);
    app?.graph?.setDirtyCanvas?.(true, true);
    return result;
  };

  const originalOnMouseDown = node.onMouseDown;
  node.onMouseDown = function onMouseDown(e, localPos, canvas) {
    const result = originalOnMouseDown?.apply(this, arguments);
    if (result === true) {
      return true;
    }
    if (e.button !== 0) {
      return result;
    }
    return beginDrag(this, localPos) || result;
  };

  const originalOnMouseMove = node.onMouseMove;
  node.onMouseMove = function onMouseMove(e, localPos, canvas) {
    const result = originalOnMouseMove?.apply(this, arguments);
    const handled = updateDrag(this, localPos);
    return handled || result;
  };

  const originalOnMouseUp = node.onMouseUp;
  node.onMouseUp = function onMouseUp(e, localPos, canvas) {
    const result = originalOnMouseUp?.apply(this, arguments);
    const handled = endDrag(this);
    return handled || result;
  };
}

app.registerExtension({
  name: "Comfy.PlanarTracker.QuadInit",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== TARGET_NODE) {
      return;
    }

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function onNodeCreated() {
      const result = originalOnNodeCreated?.apply(this, arguments);
      hookExecutedListener();
      setupNode(this);
      return result;
    };
  },
});

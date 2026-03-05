const app = window.comfyAPI?.app?.app || window.app;

const DEBUG = true;
const TARGET_INTERNAL = "PTQuadInitNode";
const TARGET_DISPLAY = "PT Quad Init";

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

function setupNodes2Widget(node) {
  if (!node || node.__pt_nodes2_setup_done) {
    return;
  }
  node.__pt_nodes2_setup_done = true;
  debugLog("setup placeholder", {
    id: node.id,
    type: node.type,
    comfyClass: node.comfyClass,
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

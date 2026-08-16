// src/computer/index.ts
import { Service } from "@deepseek-ai/cordis";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

// src/computer/render.ts
var TREE_TRUNCATED_MARK = "\n... (accessibility tree truncated at the capture byte limit)\n";
var DIRECTION_SPELLINGS = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  u: "up",
  d: "down",
  l: "left",
  r: "right"
};
var MOUSE_BUTTON_SPELLINGS = {
  left: "left",
  right: "right",
  middle: "middle",
  l: "left",
  r: "right",
  m: "middle"
};
function normalizeDirection(direction) {
  return DIRECTION_SPELLINGS[direction];
}
function normalizeMouseButton(mouseButton) {
  return MOUSE_BUTTON_SPELLINGS[mouseButton];
}
function assertClickAddressing(request) {
  const byIndex = request.elementIndex !== void 0;
  const byX = request.x !== void 0;
  const byY = request.y !== void 0;
  if (byIndex === (byX || byY)) {
    throw new Error("computer: click requires exactly one addressing mode: elementIndex, or both x and y");
  }
  if (byX !== byY) {
    throw new Error("computer: click coordinates require both x and y");
  }
}
function assertActionRequest(request) {
  if (request.app.trim().length === 0) throw new Error("computer: app must be a non-empty string");
  if (request.elementIndex !== void 0 && (!Number.isInteger(request.elementIndex) || request.elementIndex < 0)) {
    throw new Error(`computer: elementIndex must be a non-negative integer, got ${JSON.stringify(request.elementIndex)}`);
  }
  if (request.pages !== void 0 && (!Number.isFinite(request.pages) || request.pages <= 0)) {
    throw new Error(`computer: pages must be a positive number, got ${JSON.stringify(request.pages)}`);
  }
  if (request.action !== void 0 && request.action.trim().length === 0) {
    throw new Error("computer: action must be a non-empty string");
  }
  if (request.key !== void 0 && request.key.trim().length === 0) {
    throw new Error("computer: key must be a non-empty string");
  }
}
function truncateTreeText(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  const markBytes = Buffer.byteLength(TREE_TRUNCATED_MARK, "utf8");
  if (markBytes >= maxBytes) return { text: TREE_TRUNCATED_MARK.slice(0, maxBytes), truncated: true };
  const budget = maxBytes - markBytes;
  let end = Math.min(text.length, budget);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > budget) end -= 1;
  return { text: text.slice(0, end) + TREE_TRUNCATED_MARK, truncated: true };
}
function truncateTreeChars(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
function formatAppStateEnvelope(state) {
  return state.text;
}
function listAppsText(apps) {
  if (apps.length === 0) return "No targetable apps found.";
  return apps.map((app) => {
    const name = app.displayName ?? app.id;
    const flags = [];
    if (app.isRunning === true) flags.push("running");
    if (app.lastUsedDate !== void 0) flags.push(`last-used=${app.lastUsedDate}`);
    if (app.useCount !== void 0) flags.push(`uses=${app.useCount}`);
    const suffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
    return `${name} \u2014 ${app.id}${suffix}`;
  }).join("\n");
}

// src/computer/index.ts
var COMPUTER_SETTINGS_NAMESPACE = settingsNamespace("computer");
var ComputerEngine = class extends Service {
  constructor(ctx) {
    super(ctx, "computer");
  }
};
export {
  COMPUTER_SETTINGS_NAMESPACE,
  ComputerEngine,
  TREE_TRUNCATED_MARK,
  assertActionRequest,
  assertClickAddressing,
  formatAppStateEnvelope,
  listAppsText,
  normalizeDirection,
  normalizeMouseButton,
  truncateTreeChars,
  truncateTreeText
};

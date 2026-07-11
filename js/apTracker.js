/*
Archipelago Live Tracking (KH1 AP Randomizer)

Connects directly to the Archipelago game server over WebSocket (the same
protocol a real game client uses, via a read-only "Tracker" tag) and
auto-marks matching bingo squares as completed in real time. Objectives
opt in via optional "apLocations"/"apItems"/"apLocationThreshold"/"apAnyOf"
fields in the list JSON (see lists/kh1-ap.json). Everything past the
connection layer is additive: it only calls into the existing
state-mutation functions from boardRender.js so each mode's normal
follow-up logic (bingo lines, fog reveals, roguelike layer progression)
runs exactly as it would for a manual click.
*/

const AP_GAME_NAME = "Kingdom Hearts";
const AP_STORAGE_KEY = "apTrackerConnection"; // {address, slotName} only — never the password
const AP_RECONNECT_DELAYS_MS = [3000, 6000, 12000, 30000];
const AP_HANDSHAKE_GRACE_MS = 2500;

let apSocket = null;
let apConnecting = false;
let apConnected = false;
let apExplicitDisconnect = false;
let apHandshakeGraceTimer = null;
let apTriedInsecureFallback = false;

let apAddress = null; // {host, port}
let apSlotName = null;
let apLastPassword = ""; // in-memory only for this tab's lifetime, never persisted
let apTeam = null;
let apSlot = null;

let apLocationIdToName = null; // Map<number, string>
let apItemIdToName = null; // Map<number, string>
let apReceivedItemAccumulator = []; // raw NetworkItem[] in arrival order (for index-0-replace)

let apCheckedLocationNames = new Set();
let apReceivedItemCounts = new Map(); // name -> total count received

let apSquareRequirements = {}; // { [squareId]: objective }
let apReconnectAttempt = 0;
let apReconnectTimer = null;

const apTrackerPanel = document.getElementById("apTrackerPanel");
const apServerInput = document.getElementById("apServerInput");
const apSlotNameInput = document.getElementById("apSlotNameInput");
const apPasswordInput = document.getElementById("apPasswordInput");
const apConnectBtn = document.getElementById("apConnectBtn");
const apTrackerStatus = document.getElementById("apTrackerStatus");
const apTrackerLive = document.getElementById("apTrackerLive");
const apTrackerLiveStatus = document.getElementById("apTrackerLiveStatus");
const apDisconnectBtn = document.getElementById("apDisconnectBtn");

// ================= Connection ====================

function apParseServerAddress(raw) {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^(wss?|https?):\/\//i, "");
  const match = trimmed.match(/^([^:/]+):(\d+)\/?$/);
  if (!match) return null;

  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  return { host: match[1], port };
}

function setApStatus(message, isError = false, live = false) {
  const el = live ? apTrackerLiveStatus : apTrackerStatus;
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("ap-error", isError);
}

function apGenerateUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function invertIdMap(nameToId) {
  const map = new Map();
  Object.entries(nameToId || {}).forEach(([name, id]) => map.set(id, name));
  return map;
}

function apSendPacket(obj) {
  apSocket?.send(JSON.stringify([obj]));
}

function apConnect() {
  const address = apParseServerAddress(apServerInput.value);
  if (!address) {
    setApStatus("Enter a valid server address, e.g. archipelago.gg:38281.", true);
    return;
  }
  if (!apSlotNameInput.value.trim()) {
    setApStatus("Enter your slot name.", true);
    return;
  }

  apAddress = address;
  apSlotName = apSlotNameInput.value.trim();
  apLastPassword = apPasswordInput.value;
  apReconnectAttempt = 0;
  apExplicitDisconnect = false;
  apTriedInsecureFallback = false;

  apConnectBtn.disabled = true;
  setApStatus("Connecting...");
  apOpenSocket({ secure: true });
}

apConnectBtn?.addEventListener("click", apConnect);

function apOpenSocket({ secure }) {
  apConnecting = true;
  const url = `${secure ? "wss" : "ws"}://${apAddress.host}:${apAddress.port}`;

  try {
    apSocket = new WebSocket(url);
  } catch (err) {
    apHandleSocketDown();
    return;
  }

  apSocket.onmessage = apHandleMessage;
  apSocket.onerror = () => {};
  apSocket.onclose = apHandleSocketDown;

  clearTimeout(apHandshakeGraceTimer);
  apHandshakeGraceTimer = setTimeout(() => {
    if (apConnecting) apHandleHandshakeTimeout();
  }, AP_HANDSHAKE_GRACE_MS);
}

function apHandleHandshakeTimeout() {
  apSocket?.close();

  if (!apTriedInsecureFallback && location.protocol !== "https:") {
    apTriedInsecureFallback = true;
    setApStatus("Retrying without TLS...");
    apOpenSocket({ secure: false });
    return;
  }

  apConnecting = false;
  apConnectBtn.disabled = false;
  const hint =
    location.protocol === "https:"
      ? " If this is a self-hosted, non-TLS server, it can't be reached from this page — try running the generator locally instead."
      : "";
  setApStatus(`Couldn't reach that server.${hint}`, true);
}

function apHandleMessage(event) {
  let packets;
  try {
    packets = JSON.parse(event.data);
  } catch {
    return;
  }
  packets.forEach(apDispatchPacket);
}

function apDispatchPacket(packet) {
  switch (packet.cmd) {
    case "RoomInfo":
      apHandleRoomInfo(packet);
      break;
    case "DataPackage":
      apHandleDataPackage(packet);
      break;
    case "Connected":
      apHandleConnected(packet);
      break;
    case "ConnectionRefused":
      apHandleConnectionRefused(packet);
      break;
    case "ReceivedItems":
      apHandleReceivedItems(packet);
      break;
    case "RoomUpdate":
      apHandleRoomUpdate(packet);
      break;
    default:
      break; // PrintJSON, Bounced, etc. — not needed for tracking
  }
}

function apHandleRoomInfo(packet) {
  clearTimeout(apHandshakeGraceTimer);
  if (Array.isArray(packet.games) && !packet.games.includes(AP_GAME_NAME)) {
    console.warn("Room does not list Kingdom Hearts among its games.");
  }
  apSendPacket({ cmd: "GetDataPackage", games: [AP_GAME_NAME] });
}

function apHandleDataPackage(packet) {
  const gamePackage = packet.data?.games?.[AP_GAME_NAME];
  if (!gamePackage) {
    apConnecting = false;
    apSocket?.close();
    apConnectBtn.disabled = false;
    setApStatus("This server has no Kingdom Hearts data package.", true);
    return;
  }

  apLocationIdToName = invertIdMap(gamePackage.location_name_to_id);
  apItemIdToName = invertIdMap(gamePackage.item_name_to_id);

  apSendPacket({
    cmd: "Connect",
    password: apLastPassword || null,
    game: "",
    name: apSlotName,
    uuid: apGenerateUuid(),
    version: { major: 0, minor: 5, build: 0, class: "Version" },
    items_handling: 0b111,
    tags: ["Tracker"],
    slot_data: false,
  });
}

const AP_CONNECTION_REFUSED_MESSAGES = {
  InvalidSlot: "No slot with that name exists in this room.",
  InvalidGame: "That slot isn't playing Kingdom Hearts.",
  IncompatibleVersion: "Version mismatch with the server.",
  InvalidPassword: "Wrong password.",
  InvalidItemsHandling: "Server rejected the connection (items_handling).",
};

function apHandleConnectionRefused(packet) {
  apConnecting = false;
  apSocket?.close();
  apConnectBtn.disabled = false;

  const errors = packet.errors || [];
  const message =
    errors.map((e) => AP_CONNECTION_REFUSED_MESSAGES[e]).find(Boolean) ||
    "Connection refused by server.";
  setApStatus(message, true);
}

function apHandleConnected(packet) {
  if (packet.slot_info?.[packet.slot]?.game !== AP_GAME_NAME) {
    setApStatus(`Slot "${apSlotName}" isn't playing Kingdom Hearts in this room.`, true);
    apSocket?.close();
    apConnecting = false;
    apConnectBtn.disabled = false;
    return;
  }

  apTeam = packet.team;
  apSlot = packet.slot;

  const checkedNames = new Set();
  (packet.checked_locations || []).forEach((id) => {
    const name = apLocationIdToName.get(id);
    if (name) checkedNames.add(name);
  });
  apCheckedLocationNames = checkedNames;
  apReceivedItemAccumulator = [];
  apReceivedItemCounts = new Map();

  apConnecting = false;
  apConnected = true;
  apReconnectAttempt = 0;

  localStorage.setItem(
    AP_STORAGE_KEY,
    JSON.stringify({ address: apServerInput.value.trim(), slotName: apSlotName }),
  );

  apTrackerPanel?.classList.add("ap-connected");
  apTrackerLive?.classList.remove("hidden");
  setApStatus(`Connected as ${apSlotName}.`);
  setApStatus(`Tracking ${apSlotName}`, false, true);

  if (typeof gameStarted !== "undefined" && gameStarted) {
    buildApLocationIndex();
    applyApCheckedSquares();
  }
}

function apRecomputeItemCounts() {
  const counts = new Map();
  apReceivedItemAccumulator.forEach((networkItem) => {
    const itemId = Array.isArray(networkItem) ? networkItem[0] : networkItem.item;
    const name = apItemIdToName.get(itemId);
    if (!name) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  apReceivedItemCounts = counts;
}

function apHandleReceivedItems(packet) {
  if (packet.index === 0) {
    apReceivedItemAccumulator = packet.items.slice();
  } else {
    apReceivedItemAccumulator.push(...packet.items);
  }
  apRecomputeItemCounts();
  applyApCheckedSquares();
}

function apHandleRoomUpdate(packet) {
  if (!Array.isArray(packet.checked_locations)) return;

  packet.checked_locations.forEach((id) => {
    const name = apLocationIdToName.get(id);
    if (name) apCheckedLocationNames.add(name);
  });
  applyApCheckedSquares();
}

function apHandleSocketDown() {
  clearTimeout(apHandshakeGraceTimer);

  if (!apConnected) {
    // Still mid-handshake — apHandleHandshakeTimeout (or the grace timer)
    // owns the wss->ws fallback / failure messaging for this case.
    apConnecting = false;
    return;
  }

  apConnected = false;
  apTrackerLive?.classList.add("hidden");
  apTrackerPanel?.classList.remove("ap-connected");

  if (apExplicitDisconnect) {
    setApStatus("Disconnected.");
    return;
  }

  setApStatus("Connection lost. Reconnecting...", true, true);
  apScheduleReconnect();
}

function apScheduleReconnect() {
  clearTimeout(apReconnectTimer);
  const delay =
    AP_RECONNECT_DELAYS_MS[Math.min(apReconnectAttempt, AP_RECONNECT_DELAYS_MS.length - 1)];
  apReconnectAttempt++;
  apReconnectTimer = setTimeout(() => {
    apTriedInsecureFallback = false;
    apOpenSocket({ secure: true });
  }, delay);
}

function apDisconnect() {
  apExplicitDisconnect = true;
  clearTimeout(apReconnectTimer);
  clearTimeout(apHandshakeGraceTimer);
  apSocket?.close();

  apConnected = false;
  apConnecting = false;
  apTeam = null;
  apSlot = null;
  apCheckedLocationNames = new Set();
  apReceivedItemCounts = new Map();

  apTrackerLive?.classList.add("hidden");
  apTrackerPanel?.classList.remove("ap-connected");
  apConnectBtn.disabled = false;
  setApStatus("Disconnected.");
}

apDisconnectBtn?.addEventListener("click", apDisconnect);

// ================= Requirement matching ====================

// A "requirement group" is anything with apLocations/apItems/apLocationThreshold
// (an objective itself, or one alternative inside apAnyOf) — satisfied when
// every requirement it lists is met.
function requirementGroupSatisfied(group) {
  const hasLocations = Array.isArray(group.apLocations) && group.apLocations.length;
  const hasItems = Array.isArray(group.apItems) && group.apItems.length;
  const hasThreshold =
    group.apLocationThreshold && Array.isArray(group.apLocationThreshold.locations);
  if (!hasLocations && !hasItems && !hasThreshold) return false;

  if (hasLocations && !group.apLocations.every((n) => apCheckedLocationNames.has(n))) {
    return false;
  }

  if (hasItems) {
    const satisfied = group.apItems.every(
      (req) => (apReceivedItemCounts.get(req.name) || 0) >= req.count,
    );
    if (!satisfied) return false;
  }

  // Satisfied once at least `count` of the listed locations (any of them,
  // not a specific subset) have been checked — e.g. "8 Green Trinities" is
  // done once 8 of the game's known Green Trinity spots are checked,
  // regardless of which 8.
  if (hasThreshold) {
    const { locations, count } = group.apLocationThreshold;
    const checkedCount = locations.filter((n) => apCheckedLocationNames.has(n)).length;
    if (checkedCount < count) return false;
  }

  return true;
}

// Whether an objective carries any AP tracking data at all, regardless of
// whether it's currently satisfied. Used to badge trackable squares.
function isObjectiveApTrackable(obj) {
  if (!obj) return false;
  if (Array.isArray(obj.apAnyOf) && obj.apAnyOf.length) return true;
  if (Array.isArray(obj.apLocations) && obj.apLocations.length) return true;
  if (Array.isArray(obj.apItems) && obj.apItems.length) return true;
  if (obj.apLocationThreshold && Array.isArray(obj.apLocationThreshold.locations)) return true;
  return false;
}

// apAnyOf lets an objective be satisfied by any ONE of several alternative
// requirement groups (OR), e.g. "Evidence" via either Footprints or a
// second Wonderland copy. Falls back to plain AND semantics on the
// objective itself when apAnyOf isn't present.
function objectiveApSatisfied(obj) {
  if (!obj) return false;

  if (Array.isArray(obj.apAnyOf) && obj.apAnyOf.length) {
    return obj.apAnyOf.some((alt) => requirementGroupSatisfied(alt));
  }

  return requirementGroupSatisfied(obj);
}

function parseSquareId(id) {
  const parts = id.split("-");
  if (parts[0] === "bingo") return { mode: "bingo", i: Number(parts[1]) };
  if (parts[0] === "fog") return { mode: "fog", r: Number(parts[1]), c: Number(parts[2]) };
  if (parts[0] === "rogue") return { mode: "rogue", r: Number(parts[1]), c: Number(parts[2]) };
  return null;
}

// ================= Building the per-board index ====================

function buildApLocationIndex() {
  apSquareRequirements = {};

  if (typeof selectedMode === "undefined" || selectedMode === "rush") return;

  if (selectedMode === "classic" && typeof bingoBoard !== "undefined") {
    bingoBoard.forEach((obj, i) => {
      apSquareRequirements[`bingo-${i}`] = obj;
    });
  }

  if (selectedMode === "exploration" && typeof explorationBoard !== "undefined") {
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (explorationBoard[r]?.[c]) {
          apSquareRequirements[`fog-${r}-${c}`] = explorationBoard[r][c];
        }
      }
    }
  }

  if (selectedMode === "roguelike" && typeof rogueBoard !== "undefined") {
    rogueBoard.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell?.type === "active" && cell.obj) {
          apSquareRequirements[`rogue-${r}-${c}`] = cell.obj;
        }
      });
    });
  }
}

// ================= Applying completions ====================

function applyApCheckedSquares() {
  if (!apConnected) return;

  Object.entries(apSquareRequirements).forEach(([squareId, obj]) => {
    if ((squareStates[squareId] || 0) >= 2) return;
    if (!objectiveApSatisfied(obj)) return;

    const parsed = parseSquareId(squareId);
    if (!parsed) return;

    if (parsed.mode === "bingo") applyClassicCompletion(squareId, parsed.i);
    if (parsed.mode === "fog") applyFogCompletion(squareId, parsed.r, parsed.c);
    if (parsed.mode === "rogue") applyRogueCompletion(squareId, parsed.r, parsed.c);
  });
}

function applyClassicCompletion(squareId, i) {
  const el = board.children[i];
  if (!el) return;
  setSquareState(el, squareId, 2);
  checkForBingo((r, c) => squareStates[`bingo-${r * bingoSize + c}`] === 2);
}

function applyFogCompletion(squareId, r, c) {
  if (!visibleMap[r]?.[c]) return; // don't spoil unrevealed fog squares
  const el = board.children[r * boardSize + c];
  if (!el) return;
  setSquareState(el, squareId, 2);
  updateFogScore();
  revealNeighbors(r, c);
}

function applyRogueCompletion(squareId, r, c) {
  if (r !== rogueCurrentLayer || !rogueVisibleMap[r]?.[c]) return;
  const el = board.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  if (!el) return;
  setSquareState(el, squareId, 2);
  _progressRogue(r, c, squareId);
}

// ================= Trackable badge ====================

// Small green dot on squares whose objective carries AP tracking data,
// so the player can see at a glance which squares will auto-complete —
// shown regardless of connection status, purely informational. No-op for
// any list whose objectives don't have apLocations/apItems/etc (every
// non-kh1-ap list), since isObjectiveApTrackable just returns false.
function setApBadge(el, trackable) {
  if (!trackable || !el) return;
  if (el.querySelector(".ap-trackable-badge")) return;
  const badge = document.createElement("span");
  badge.className = "ap-trackable-badge";
  badge.title = "Auto-tracked via Archipelago";
  el.appendChild(badge);
}

// Every render function rebuilds #board from scratch (innerHTML = ""), so
// there's never a stale badge to clean up — we only ever need to add them
// to freshly created elements.
function markApTrackableSquares() {
  if (typeof selectedMode === "undefined") return;

  if (selectedMode === "classic" && typeof bingoBoard !== "undefined") {
    bingoBoard.forEach((obj, i) => {
      setApBadge(board.children[i], isObjectiveApTrackable(obj));
    });
  }

  if (selectedMode === "exploration" && typeof explorationBoard !== "undefined") {
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (!visibleMap[r]?.[c]) continue; // don't spoil unrevealed fog squares
        const obj = explorationBoard[r]?.[c];
        setApBadge(board.children[r * boardSize + c], isObjectiveApTrackable(obj));
      }
    }
  }

  if (selectedMode === "roguelike" && typeof rogueBoard !== "undefined") {
    rogueBoard.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!rogueVisibleMap[r]?.[c] || !cell?.obj) return; // don't spoil unrevealed cells
        const el = board.querySelector(`[data-row="${r}"][data-col="${c}"]`);
        setApBadge(el, isObjectiveApTrackable(cell.obj));
      });
    });
  }

  if (selectedMode === "rush" && typeof currentRound !== "undefined") {
    currentRound.forEach((obj, i) => {
      setApBadge(board.children[i], isObjectiveApTrackable(obj));
    });
  }
}

// #board is fully torn down and rebuilt on every render call across every
// mode, so watching it once here covers all of them without touching
// boardRender.js.
new MutationObserver(markApTrackableSquares).observe(board, { childList: true });

// ================= Wiring into the rest of the app ====================

function updateApPanelVisibility() {
  if (!apTrackerPanel) return;
  const eligible = gameSelect.value === "kh1" && listSelect.value === "kh1-ap.json";
  apTrackerPanel.style.display = eligible ? "flex" : "none";

  const isRush = selectedMode === "rush";
  apConnectBtn.disabled = isRush || apConnected || apConnecting;
  apTrackerPanel.classList.toggle("ap-disabled-rush", isRush);

  if (eligible && isRush && !apConnected) {
    setApStatus("Live tracking isn't available in Rush mode — pick another mode to connect.");
  } else if (eligible && !isRush && !apConnected && !apConnecting) {
    setApStatus("");
  }
}

gameSelect?.addEventListener("change", updateApPanelVisibility);
listSelect?.addEventListener("change", updateApPanelVisibility);
modeSelect?.addEventListener("change", updateApPanelVisibility);

// Recheck immediately after a manual mark, so a square that becomes newly
// visible (fog reveal, roguelike layer advance) can pick up an
// already-satisfied AP check right away instead of waiting for the next poll.
board.addEventListener(
  "click",
  () => {
    if (apConnected) setTimeout(applyApCheckedSquares, 50);
  },
  { passive: true },
);
board.addEventListener(
  "contextmenu",
  () => {
    if (apConnected) setTimeout(applyApCheckedSquares, 50);
  },
  { passive: true },
);
board.addEventListener(
  "wheel",
  () => {
    if (apConnected) setTimeout(applyApCheckedSquares, 50);
  },
  { passive: true },
);

// Called once from generateGame() after a board exists.
function onApGameGenerated() {
  updateApPanelVisibility();

  if (!apConnected) {
    apAutoReconnect();
    return;
  }

  buildApLocationIndex();
  applyApCheckedSquares();
}

// Only works for unprotected rooms — the password is intentionally never
// persisted, so a password-protected room will reach the server, get
// ConnectionRefused: InvalidPassword, and surface that through the normal
// friendly-message path, requiring a manual reconnect.
function apAutoReconnect() {
  if (gameSelect.value !== "kh1" || listSelect.value !== "kh1-ap.json") return;
  if (selectedMode === "rush") return;

  const params = new URLSearchParams(window.location.search);
  if (params.get("view") !== "game") return;

  const saved = localStorage.getItem(AP_STORAGE_KEY);
  if (!saved) return;

  let prefs;
  try {
    prefs = JSON.parse(saved);
  } catch {
    return;
  }
  if (!prefs?.address || !prefs.slotName) return;

  apServerInput.value = prefs.address;
  apSlotNameInput.value = prefs.slotName;
  apConnect();
}

// Pre-fill the server/slot inputs from a previous session, without
// auto-connecting on the plain options screen.
document.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem(AP_STORAGE_KEY);
  if (saved && apServerInput && apSlotNameInput) {
    try {
      const prefs = JSON.parse(saved);
      if (prefs?.address) apServerInput.value = prefs.address;
      if (prefs?.slotName) apSlotNameInput.value = prefs.slotName;
    } catch {
      // ignore malformed storage
    }
  }
  updateApPanelVisibility();
});

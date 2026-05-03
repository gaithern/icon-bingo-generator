/*
UI Logic
*/

let rawObjectives = [];
let availableTags = [];
let enabledTags = new Set();
let urlDisabledTags = [];

const fileInput = document.getElementById("jsonUpload");
fileInput.style.display = "none";

const gameSelect = document.getElementById("gameSelect");
const listSelect = document.getElementById("listSelect");

const board = document.getElementById("board");
const status = document.getElementById("status");
const completedList = document.getElementById("completedList");
const seedInput = document.getElementById("seedInput");

let rushRoundLimit = null;
let suppressListChange = false;

const shinyCheckbox = document.getElementById("shinyCheckbox");
const shinyInput = document.getElementById("shinyInput");
const shinyCountInput = document.getElementById("shinyCount");

const bingoLogicToggle = document.getElementById("bingoLogicToggle");

let restoringFromURL = false;

// Load generator view or game view
async function handleInitialLoad() {
  const params = new URLSearchParams(window.location.search);
  const isGameView = params.get("view") === "game";

  restoringFromURL = true;
  applySettingsFromURL();
  restoringFromURL = false;

  if (isGameView) {
    const success = await loadObjectives();
    if (success) {
      generateGame();
    }
  }

  document.body.classList.remove("preload");

  if (shouldHideBoard()) {
    hideBoard();
  }
}

window.addEventListener("DOMContentLoaded", handleInitialLoad);

// Hide board
function shouldHideBoard() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") === "game";
}

// Set UI options on page load for saved links
function setInitialUI() {
  if (shinyCheckbox) {
    shinyCheckbox.checked = shinyMode;
  }

  if (bingoLogicToggle) {
    bingoLogicToggle.checked = bingoLogic;
  }
}

// Reset all game options
function resetUI() {
  // localStorage.clear();
  window.location.href = window.location.pathname;
}

// Back button on board view
document.getElementById("backToOptions").addEventListener("click", resetUI);

// Set shiny mode options on shared game link
function syncShinyUI(enabled, count = null) {
  shinyCheckbox.checked = enabled;
  shinyInput.style.display = enabled ? "flex" : "none";

  if (enabled && count !== null) {
    shinyCountInput.value = count;
  }
}

shinyCheckbox.addEventListener("change", () => {
  if (restoringFromURL) return;

  shinyMode = shinyCheckbox.checked;
  syncShinyUI(shinyMode);
});

// Bingo logic toggle
bingoLogicToggle.addEventListener("change", (e) => {
  bingoLogic = bingoLogicToggle.checked;
});

// Save marking color selection
document.addEventListener("DOMContentLoaded", () => {
  const savedColor = localStorage.getItem("markingColor") || "green";
  setMarkingColor(savedColor);

  const picker = document.getElementById("colorPicker");
  if (picker) {
    picker.value = savedColor;

    picker.addEventListener("change", (e) => {
      setMarkingColor(e.target.value);
      localStorage.setItem("markingColor", e.target.value);
    });
  }
});

// Load lists from gamesLists.js
function populateGames() {
  Object.entries(GAME_LISTS).forEach(([gameId, game]) => {
    const option = document.createElement("option");
    option.value = gameId;
    option.textContent = game.name;
    gameSelect.appendChild(option);
  });

  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Custom";
  gameSelect.appendChild(customOption);
}

populateGames();

// Change objective list dropdown when change game
gameSelect.addEventListener("change", () => {
  const gameId = gameSelect.value;

  // reset state
  allObjectives = [];
  board.innerHTML = "";
  completedList.innerHTML = "";
  status.textContent = "";

  // custom game
  if (gameId === "custom") {
    resetTagUI();

    fileInput.style.display = "block";

    listSelect.innerHTML = `<option value="" disabled selected hidden>Upload a JSON file</option>`;
    listSelect.disabled = true;

    document.getElementById("listPreview").style.display = "none";
    status.textContent = "Upload a custom JSON file to continue";
    return;
  }

  // normal game
  fileInput.style.display = "none";
  listSelect.disabled = false;

  populateListsForGame(gameId);

  status.textContent = "Select a list to continue";
});

// Helper to populate lists
function populateListsForGame(gameId, selectedList = null) {
  suppressListChange = true; // prevent change event

  listSelect.innerHTML = ``;

  if (gameId !== "custom") {
    const lists = GAME_LISTS[gameId].lists;
    lists.forEach((list) => {
      const option = document.createElement("option");
      option.value = list.file;
      option.textContent = list.name;
      listSelect.appendChild(option);
    });
  }

  // set default list
  const listToSelect =
    selectedList ?? DEFAULT_LIST_BY_GAME[gameId] ?? lists[0]?.file;

  if (listToSelect) {
    listSelect.value = listToSelect;
    loadObjectives();
  }

  suppressListChange = false;
}

applySettingsFromURL();

// Upload Json file
document.getElementById("jsonUpload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const jsonData = JSON.parse(text);

    if (!Array.isArray(jsonData)) throw new Error("Invalid JSON format");

    const error = validateObjectiveList(jsonData);
    if (error) {
      status.textContent = `Invalid JSON: ${error}`;
      return;
    }

    allObjectives = normalizeObjectives(jsonData);
    updateListPreview(allObjectives);

    listSelect.value = "custom";
    gameSelect.disabled = true;
    listSelect.disabled = true;

    listSelect.innerHTML = `<option value="" disabled selected hidden>File uploaded!</option>`;
    status.textContent = `Loaded custom list: ${file.name}. Ready to generate game.`;

    // reset
    gameStarted = false;
    remainingObjectives = [];
    completedObjectives = [];
    board.innerHTML = "";
    completedList.innerHTML = "";
    seedInput.readOnly = false;
    document.getElementById("progressBar").style.width = "0%";
  } catch (err) {
    alert("Failed to load JSON: " + err.message);
    console.error(err);
  }
});

// Get selected Json list. Load tags if any
async function loadObjectives() {
  const listFile = listSelect.value;
  if (!listFile) return;

  try {
    const response = await fetch(`lists/${listFile}`);
    if (!response.ok) throw new Error("Failed to load list");

    rawObjectives = normalizeObjectives(await response.json());

    setupTagFilters(rawObjectives);
    if (urlDisabledTags.length) {
      urlDisabledTags.forEach((tag) => enabledTags.delete(tag));
    }

    applyTagFiltering();

    status.textContent = `Loaded list: ${listFile}. Ready to generate game.`;
    return true;
  } catch (err) {
    console.error(err);
    status.textContent = "Error loading objective list";
    return false;
  }
}

// Display number of objectives and if list has icons
function updateListPreview(objectives) {
  if (!objectives || !objectives.length) return;

  const hasIcons = objectives.some((obj) => obj.icon);
  const preview = document.getElementById("listPreview");

  preview.innerHTML = `
    <b>List Preview:</b><br>
    • ${objectives.length} objectives<br>
    • Icons: ${hasIcons ? "Yes" : "No"}
  `;

  preview.style.display = "block";
}

// Objective List Dropdown. Load Json list or display file selector
listSelect.addEventListener("change", () => {
  if (suppressListChange) return;

  if (listSelect.value === "custom") {
    fileInput.click();
    return;
  }
  loadObjectives();
});

// Game Mode Dropdown
modeSelect.addEventListener("change", () => {
  selectedMode = modeSelect.value;
  updateModeUI();
});

// Generate Game Button
mainButton.addEventListener("click", () => {
  if (!gameGenerated) {
    generateGame();
  }
});

// Board hiding
const boardOverlay = document.getElementById("boardOverlay");

function hideBoard() {
  boardOverlay.classList.remove("hidden");
}

function revealBoard() {
  boardOverlay.classList.add("hidden");
}

boardOverlay.addEventListener("click", revealBoard);

// Rush Mode Hotkeys
document.addEventListener("keydown", (e) => {
  if (!gameStarted) return;
  if (!currentRound.length) return;

  let index = null;

  if (e.key === "1") index = 0;
  if (e.key === "2") index = 1;
  if (e.key === "3") index = 2;

  if (index !== null && currentRound[index]) {
    const element = board.children[index];
    completeRound(currentRound[index], element);
  }
});

// Icon tooltips
const tooltip = document.getElementById("tooltip");

board.addEventListener("mouseover", (e) => {
  const target = e.target.closest(".objective img");
  if (!target) return;

  tooltip.textContent = target.alt || target.title || "";
  tooltip.style.visibility = "visible";
  tooltip.style.opacity = "1";

  const rect = target.getBoundingClientRect();
  tooltip.style.top = rect.bottom + window.scrollY + 5 + "px";
  tooltip.style.left = rect.left + window.scrollX + rect.width / 2 - 60 + "px";
});

board.addEventListener("mouseout", (e) => {
  if (e.target.closest(".objective img")) {
    tooltip.style.visibility = "hidden";
    tooltip.style.opacity = "0";
  }
});

function hideTooltip() {
  tooltip.style.visibility = "hidden";
  tooltip.style.opacity = "0";
}

// Shareable settings and seed link
function applySettingsFromURL() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("s")) return; // no seed

  if (params.has("dt")) {
    urlDisabledTags = params.get("dt").split(",");
  }

  // game
  const game = params.get("g");
  if (game) {
    gameSelect.value = game;
    gameSelect.dispatchEvent(new Event("change"));
  }

  // list
  const list = params.get("l");
  if (list && game && game !== "custom") {
    populateListsForGame(game, list);
  }

  // mode
  const mode = params.get("m");
  if (mode) {
    selectedMode = mode;
    modeSelect.value = mode;
    updateModeUI();
  }

  // seed
  seedInput.value = params.get("s");

  // mode options
  if (mode === "rush" && params.has("rl")) {
    document.getElementById("rushRoundLimit").value = params.get("rl");
  }

  if (mode === "classic" && params.has("bs")) {
    document.getElementById("boardSize").value = params.get("bs");
  }

  if (mode === "exploration") {
    if (params.has("bs")) {
      document.getElementById("exploreSize").value = params.get("bs");
    }
    if (params.has("start")) {
      document.getElementById("exploreStart").value = params.get("start");
    }
  }

  // bingo logic
  if (params.has("bl")) {
    bingoLogic = params.get("bl") === "1";
    document.getElementById("bingoLogicToggle").checked = bingoLogic;
  }

  // shiny mode
  if (params.has("sm")) {
    restoringFromURL = true;

    const shinyEnabled = params.get("sm") === "1";
    const shinyCount = params.has("sc") ? params.get("sc") : null;

    shinyMode = shinyEnabled;
    syncShinyUI(shinyEnabled, shinyCount);

    restoringFromURL = false;
  }
}

// Custom marking colors
function setMarkingColor(color) {
  const body = document.body;

  body.classList.remove(
    "theme-green",
    "theme-teal",
    "theme-red",
    "theme-blue",
    "theme-gold",
    "theme-orange"
  );

  body.classList.add(`theme-${color}`);
}

document.getElementById("colorPicker").addEventListener("change", (e) => {
  setMarkingColor(e.target.value);
});

// Game options summary
function updateGameSummary(gameName, listName, modeName) {
  const summary = document.getElementById("game-summary");
  summary.textContent = `${gameName} • ${listName} • ${modeName}`;
  summary.classList.remove("hidden");
}

// Add tags to options
function setupTagFilters(objectives) {
  const container = document.getElementById("tagFilters");
  container.innerHTML = "";

  const tags = new Set();
  objectives.forEach((obj) => obj.tags.forEach((t) => tags.add(t)));

  availableTags = [...tags];
  enabledTags = new Set(availableTags);

  if (availableTags.length === 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";

  availableTags.forEach((tag) => {
    const label = document.createElement("label");
    // label.className = "custom-checkbox";
    label.className = "custom-checkbox tag-checkbox";

    const text = document.createElement("span");
    text.className = "label-text";
    text.textContent = tag;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";

    const slider = document.createElement("span");
    slider.className = "slider";

    checkbox.checked = !urlDisabledTags.includes(tag);

    if (!checkbox.checked) {
      enabledTags.delete(tag);
    }

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) enabledTags.add(tag);
      else enabledTags.delete(tag);

      applyTagFiltering();
    });

    label.appendChild(checkbox);
    label.appendChild(slider);
    label.appendChild(text);

    container.appendChild(label);
  });

  const count = availableTags.length;

  if (count <= 3) {
    container.style.gridTemplateColumns = `repeat(${count}, 1fr)`;
  } else if (count === 4) {
    container.style.gridTemplateColumns = `repeat(2, 1fr)`;
  } else {
    container.style.gridTemplateColumns = `repeat(3, 1fr)`;
  }
}

// Update list when tags are toggled
function applyTagFiltering() {
  allObjectives = rawObjectives.filter(
    (obj) => obj.tags.length === 0 || obj.tags.some((t) => enabledTags.has(t))
  );

  updateListPreview(allObjectives);
}

// Set UI on page load
document.addEventListener("DOMContentLoaded", () => {
  setInitialUI();
});

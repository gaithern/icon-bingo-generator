/*
Game setup logic
*/

// Toggle options dropdown for game modes
function updateModeUI() {
  rushLimit.style.display = "none";
  traditionalOptions.style.display = "none";
  explorationOptions.style.display = "none";
  roguelikeOptions.style.display = "none";

  if (selectedMode === "rush") {
    rushLimit.style.display = "inline-flex";
  }

  if (selectedMode === "classic") {
    traditionalOptions.style.display = "inline-flex";
  }

  if (selectedMode === "exploration") {
    explorationOptions.style.display = "inline-flex";
  }

  if (selectedMode === "roguelike") {
    roguelikeOptions.style.display = "inline-flex";
  }
}

updateModeUI();

// Return feedback if list can't be used with options
function validateGameSetup() {
  if (!allObjectives.length) {
    return "No objective list loaded.";
  }

  if (selectedMode === "rush") {
    if (allObjectives.length < 3) {
      return "Rush mode requires at least 3 objectives.";
    }
    const limitInput = document.getElementById("rushRoundLimit").value;
    const requestedLimit = limitInput ? Number(limitInput) : null;

    const maxRounds = Math.floor(allObjectives.length / 3);

    if (requestedLimit !== null && requestedLimit > maxRounds) {
      return `Rush limit too high. This list supports at most ${maxRounds} rounds.`;
    }
  }

  if (selectedMode === "classic") {
    const size = Number(document.getElementById("boardSize").value);
    if (allObjectives.length < size * size) {
      return `classic ${size}×${size} requires at least ${
        size * size
      } objectives.`;
    }
  }

  if (selectedMode === "exploration") {
    const size = Number(document.getElementById("exploreSize").value);
    if (allObjectives.length < size * size) {
      return `Exploration ${size}×${size} requires at least ${
        size * size
      } objectives.`;
    }
  }

  if (selectedMode === "roguelike") {
    const sizeKey = document.getElementById("rogueSize").value;
    const cfg = ROGUELIKE_CONFIGS[sizeKey];
    if (!cfg) return;

    rogueConfig = { ...cfg, key: sizeKey };
    rogueBoard = [];
    rogueVisibleMap = [];
    rogueLastCol = null;
    rogueCurrentLayer = 0;

    const widths = _computeLayerWidths(cfg);

    // objectives needed: every active cell except the START square
    const totalNeeded = widths.reduce((s, w) => s + w, 0) - 1;
    if (allObjectives.length < totalNeeded) {
      return "Not enough objectives for this board size!";
    }
  }

  return null;
}

// Set UI elements depending on game mode
function updateModeUIVisibility() {
  const progress = document.getElementById("progressContainer");
  const log = document.getElementById("log");
  const score = document.getElementById("score");

  if (selectedMode === "rush") {
    progress.style.display = "block";
    log.style.display = "block";
    score.style.display = "block";
  }

  if (selectedMode === "classic") {
    progress.style.display = "none";
    log.style.display = "none";
    score.style.display = "block";
  }

  if (selectedMode === "exploration") {
    progress.style.display = "none";
    log.style.display = "none";
    score.style.display = "block";
  }

  if (selectedMode === "roguelike") {
    progress.style.display = "none";
    log.style.display = "none";
    score.style.display = "none";
  }
}

// Setup game. Display board.
function generateGame() {
  const error = validateGameSetup();
  if (error) {
    status.textContent = error;
    return;
  }

  if (allObjectives.length === 0) {
    status.textContent = "No objectives loaded!";
    return;
  }

  gameGenerated = true;

  let seed = seedInput.value.trim();
  if (!seed) {
    seed = generateRandomSeed();
    seedInput.value = seed;
  }

  rng = seededRNG(seed);

  // shiny mode support. set them before board render and tie to seed.
  if (selectedMode === "classic") {
    bingoSize = Number(document.getElementById("boardSize").value);
    const total = bingoSize * bingoSize;
    const shinyInput = document.getElementById("shinyCount")?.value ?? "";
    const shinyCount = getShinyCount(bingoSize, shinyInput);
    const indices = pickShinyIndices(total, shinyCount, rng);

    indices.forEach((i) => shinySquares.add(`bingo-${i}`));
  }

  if (selectedMode === "exploration") {
    boardSize = Number(document.getElementById("exploreSize").value);
    const total = boardSize * boardSize;
    const shinyInput = document.getElementById("shinyCount")?.value ?? "";
    const shinyCount = getShinyCount(boardSize, shinyInput);
    const indices = pickShinyIndices(total, shinyCount, rng);

    indices.forEach((i) => {
      const r = Math.floor(i / boardSize);
      const c = i % boardSize;
      shinySquares.add(`fog-${r}-${c}`);
    });
  }

  if (selectedMode === "roguelike" && shinyMode) {
    const sizeKey = document.getElementById("rogueSize").value;
    const cfg = ROGUELIKE_CONFIGS[sizeKey];
    if (cfg) {
      const widths = _computeLayerWidths(cfg);
      const shinyCount = Math.floor(cfg.rows / 3);

      const eligibleIds = [];

      for (let r = 0; r < cfg.rows; r++) {
        const rowNum = r + 1;
        if (cfg.redLayers.includes(rowNum) || rowNum === cfg.goalLayer)
          continue;

        for (let c = 0; c < cfg.maxWidth; c++) {
          if (r === 0 && c === cfg.centerCol) continue; // START square
          if (_isActiveCell(rowNum, c, cfg, widths)) {
            eligibleIds.push(`rogue-${r}-${c}`);
          }
        }
      }

      const indices = pickShinyIndices(eligibleIds.length, shinyCount, rng);
      indices.forEach((i) => shinySquares.add(eligibleIds[i]));
    }
  }

  if (selectedMode === "rush" && shinyMode) {
    let totalRounds;
    const limitInput = document.getElementById("rushRoundLimit").value;

    if (limitInput === "") {
      totalRounds = Math.ceil(allObjectives.length / 3);
    } else {
      totalRounds = limitInput;
    }

    const shinyCount = Math.min(10, Math.floor(totalRounds / 4));

    shinyRounds.clear();

    pickShinyRounds(totalRounds, shinyCount, rng).forEach((r) =>
      shinyRounds.add(r),
    );
  }

  // rush mode round limit
  const limitInput = document.getElementById("rushRoundLimit").value;
  rushRoundLimit = limitInput ? Number(limitInput) : null;

  remainingObjectives = [...allObjectives];
  completedObjectives = [];
  completedList.innerHTML = "";

  status.textContent = `Seed: "${seed}"`;

  gameStarted = true;

  // hide generator options
  document.getElementById("infoContainer").style.display = "none";
  document.getElementById("listPreview").style.display = "none";
  document.getElementById("controls").classList.add("hidden");
  document.getElementsByTagName("h1")[0].classList.add("hidden");
  document.getElementsByTagName("p")[0].classList.add("hidden");

  // display in-game options
  document.getElementById("copyShareLink2").classList.remove("hidden");
  document.getElementById("copyPresetLink2").classList.remove("hidden");
  document.getElementById("backToOptions").classList.remove("hidden");
  document.getElementById("board-controls").classList.remove("hidden");

  board.style.display = "grid";
  updateModeUIVisibility();

  // updateGameSummary(gameSelect.value, listSelect.value, selectedMode);

  if (selectedMode === "rush") {
    renderRushBoard();
  }

  if (selectedMode === "classic") {
    startTraditionalBingo();
  }

  if (selectedMode === "exploration") {
    startExplorationBingo();
  }

  if (selectedMode === "roguelike") {
    startRoguelikeBingo();
  }

  const gameURL = buildShareURL(true);
  history.pushState({ view: "game" }, "", gameURL);

  if (shouldHideBoard()) {
    hideBoard();
  }
}

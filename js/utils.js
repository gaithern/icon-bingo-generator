/*
Helpers
*/

// Shuffle array helper
function shuffle(array) {
  return [...array]
    .map((v) => ({ v, r: rng() }))
    .sort((a, b) => a.r - b.r)
    .map((o) => o.v);
}

// Generate ids based on "name" for Json lists
function normalizeObjectives(list) {
  return list.map((obj) => {
    let tags = [];

    if (Array.isArray(obj.tags)) tags = obj.tags;
    else if (typeof obj.tag === "string") tags = [obj.tag];

    return {
      ...obj,
      tags,
      id:
        obj.id ??
        obj.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, ""),
    };
  });
}

// Make sure Json file is valid
function validateObjectiveList(data) {
  if (!Array.isArray(data)) {
    return "JSON must be an array of objectives.";
  }

  for (let i = 0; i < data.length; i++) {
    const item = data[i];

    if (typeof item !== "object" || item === null) {
      return `Item at index ${i} is not a valid object.`;
    }

    if (!item.name || typeof item.name !== "string") {
      return `Item at index ${i} is missing a valid "name".`;
    }

    if (item.icon && typeof item.icon !== "string") {
      return `Item "${item.name}" has an invalid "icon" value.`;
    }
  }

  return null;
}

// Shareable link with settings and seed
function buildShareURL(isGameLink = false) {
  const params = new URLSearchParams();

  if (isGameLink) {
    params.set("view", "game");
  }

  params.set("g", gameSelect.value);
  params.set("l", listSelect.value);
  params.set("m", selectedMode);
  params.set("s", seedInput.value);
  params.set("sm", shinyMode ? "1" : "0");

  const shinyInput = document.getElementById("shinyCount")?.value;
  if (shinyMode && shinyInput !== "") {
    params.set("sc", shinyInput);
  }

  if (selectedMode === "rush") {
    const limit = document.getElementById("rushRoundLimit").value;
    if (limit) params.set("rl", limit);
  }

  if (selectedMode === "classic") {
    params.set("bs", document.getElementById("boardSize").value);
    params.set("bl", bingoLogic ? "1" : "0");
  }

  if (selectedMode === "exploration") {
    params.set("bs", document.getElementById("exploreSize").value);
    params.set("start", document.getElementById("exploreStart").value);
  }

  const disabled = availableTags.filter((t) => !enabledTags.has(t));
  if (disabled.length) params.set("dt", disabled.join(","));

  return `${location.origin}${location.pathname}?${params.toString()}`;
}

// Share preset link button
function copyShareLink() {
  const url = buildShareURL();
  navigator.clipboard.writeText(url);
  alert("Share link copied!");
}

// Share game/board link button
function copyGameLink() {
  const url = window.location.href;
  navigator.clipboard.writeText(url);
  alert("Game link copied!");
}

// User input shiny count or default
function getShinyCount(boardSize, inputValue) {
  if (inputValue === "" || inputValue === null) {
    return Math.max(0, boardSize - 2);
  }

  const parsed = Number(inputValue);
  if (Number.isNaN(parsed)) return Math.max(0, boardSize - 2);

  return parsed;
}

// Assign shiny goal placement
function pickShinyIndices(totalSquares, shinyCount, rng) {
  const indices = Array.from({ length: totalSquares }, (_, i) => i);

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices.slice(0, shinyCount);
}

// Rush mode shiny placement
function pickShinyRounds(totalRounds, shinyCount, rng) {
  const candidates = Array.from({ length: totalRounds }, (_, i) => i + 1);
  const result = new Set();

  while (result.size < shinyCount && candidates.length > 0) {
    const index = Math.floor(rng() * candidates.length);
    const round = candidates[index];

    // Prevent back-to-back shiny rounds
    if (!result.has(round - 1) && !result.has(round + 1)) {
      result.add(round);
    }

    candidates.splice(index, 1);
  }

  return result;
}

// Display current score depending on mode
function renderScore() {
  const score = document.getElementById("score");

  if (selectedMode === "classic") {
    if (!bingoLogic) {
      score.textContent = "";
      return;
    }

    const count = scoreState.bingoLines;
    score.textContent =
      count === 0
        ? "Score: 0 Lines"
        : `Score: ${count} Line${count > 1 ? "s" : ""}`;
  }

  if (selectedMode === "exploration") {
    score.textContent = `Score: ${scoreState.squaresCompleted}`;
  }

  if (selectedMode === "rush") {
    score.textContent = `Score: ${scoreState.rushRounds}`;
  }
}

function resetTagUI() {
  const container = document.getElementById("tagFilters");

  availableTags = [];
  enabledTags = new Set();
  rawObjectives = [];
  urlDisabledTags = [];

  if (container) {
    container.innerHTML = "";
    container.style.display = "none";
  }
}

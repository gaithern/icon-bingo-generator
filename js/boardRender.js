/*
Game Logic
*/

const shinySquares = new Set();
let shinyRounds = new Set();
let currentRoundIsShiny = false;

const squareStates = {};

// Cycle objective through default, marked, and completed with scroll wheel
function cycleSquare(element, id, direction = 1) {
  if (!(id in squareStates)) {
    squareStates[id] = 0;
  }

  squareStates[id] = (squareStates[id] + direction + 3) % 3;

  element.classList.remove("border-mark", "completed");

  if (squareStates[id] === 1) {
    element.classList.add("border-mark");
  } else if (squareStates[id] === 2) {
    element.classList.add("completed");
  }
}

// Hard set objective state
function setSquareState(element, id, newState) {
  squareStates[id] = newState;

  element.classList.remove("border-mark", "completed");

  if (newState === 1) element.classList.add("border-mark");
  if (newState === 2) element.classList.add("completed");
}

// ================= Classic Bingo ====================

// Start classic bingo
function startTraditionalBingo() {
  bingoSize = Number(document.getElementById("boardSize").value);
  bingoCompleted = false;

  const shuffled = shuffle([...allObjectives]);
  const needed = bingoSize * bingoSize;

  bingoBoard = shuffled.slice(0, needed);

  renderTraditionalBoard();
}

// Create classic bingo board
function renderTraditionalBoard() {
  board.innerHTML = "";

  board.style.gridTemplateColumns = `repeat(${bingoSize}, 1fr)`;

  // fill squares
  bingoBoard.forEach((obj, index) => {
    const div = document.createElement("div");
    div.className = "objective";
    div.dataset.id = index;

    // icons or text
    if (iconsEnabled && obj.icon) {
      const img = document.createElement('img');
      img.src = obj.icon;
      img.alt = obj.name;
      div.appendChild(img);
    } else {
      div.textContent = obj.name;
    }

    div.dataset.id = `bingo-${index}`;

    // shiny goal support
    if (shinyMode) {
      if (shinySquares.has(div.dataset.id)) {
        div.classList.add("shiny");
      }
    }

    // marking squares
    div.addEventListener("click", () => {
      // left click = completed
      const id = div.dataset.id;
      const newState = squareStates[id] === 2 ? 0 : 2;
      setSquareState(div, id, newState);

      checkForBingo((r, c) => {
        const index = r * bingoSize + c;
        const id = `bingo-${index}`;
        return squareStates[id] === 2;
      });
    });

    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // right click = marked
      if (squareStates[div.dataset.id] === 1) {
        setSquareState(div, div.dataset.id, 0);
      } else {
        setSquareState(div, div.dataset.id, 1);
      }
    });

    div.addEventListener("wheel", (e) => {
      e.preventDefault();
      // scroll wheel cycles through states
      const dir = e.deltaY < 0 ? 1 : -1; // up = forward, down = backward
      cycleSquare(div, div.dataset.id, dir);
      checkForBingo((r, c) => {
        const index = r * bingoSize + c;
        const id = `bingo-${index}`;
        return squareStates[id] === 2;
      });
    });

    board.appendChild(div);
  });
}

// Bingo checking
function checkForBingo(isMarked) {
  if (!bingoLogic) {
    bingoLines = [];
    updateBingoHighlights();
    updateBingoScore();
    return;
  }

  const size = bingoSize;
  bingoLines = [];

  // rows
  for (let r = 0; r < size; r++) {
    const line = [];
    for (let c = 0; c < size; c++) {
      if (!isMarked(r, c)) break;
      line.push({ r, c });
    }
    if (line.length === size) bingoLines.push(line);
  }

  // columns
  for (let c = 0; c < size; c++) {
    const line = [];
    for (let r = 0; r < size; r++) {
      if (!isMarked(r, c)) break;
      line.push({ r, c });
    }
    if (line.length === size) bingoLines.push(line);
  }

  // diagonal TL → BR
  const diag1 = [];
  for (let i = 0; i < size; i++) {
    if (!isMarked(i, i)) break;
    diag1.push({ r: i, c: i });
  }
  if (diag1.length === size) bingoLines.push(diag1);

  // diagonal TR → BL
  const diag2 = [];
  for (let i = 0; i < size; i++) {
    if (!isMarked(i, size - 1 - i)) break;
    diag2.push({ r: i, c: size - 1 - i });
  }
  if (diag2.length === size) bingoLines.push(diag2);

  updateBingoHighlights();
  updateBingoScore();
}

// Count bingo lines
function updateBingoScore() {
  scoreState.bingoLines = bingoLines.length;
  renderScore();
}

// Change bingo line color
function updateBingoHighlights() {
  const squares = board.children;

  [...squares].forEach((el) => el.classList.remove("bingo-line"));

  bingoLines.forEach((line) => {
    line.forEach(({ r, c }) => {
      const index = r * bingoSize + c;
      squares[index]?.classList.add("bingo-line");
    });
  });
}

// ================= Fog of War ====================

// Start fog of war
function startExplorationBingo() {
  if (!allObjectives.length) return;

  boardSize = Number(document.getElementById("exploreSize").value);

  if (allObjectives.length < boardSize * boardSize) {
    status.textContent = "Not enough objectives for this board size!";
    return;
  }

  const shuffled = shuffle(allObjectives).slice(0, boardSize * boardSize);

  explorationBoard = [];
  visibleMap = [];
  markedMap = [];

  // hide squares
  for (let r = 0; r < boardSize; r++) {
    explorationBoard[r] = [];
    visibleMap[r] = [];
    markedMap[r] = [];
    for (let c = 0; c < boardSize; c++) {
      explorationBoard[r][c] = shuffled[r * boardSize + c];
      visibleMap[r][c] = false;
      markedMap[r][c] = false;
    }
  }

  startingSquares = document.getElementById("exploreStart").value;

  // starting squares options
  switch (startingSquares) {
    case "center": {
      initialReveal = [
        { r: Math.floor(boardSize / 2), c: Math.floor(boardSize / 2) },
      ];
      break;
    }

    case "corners": {
      initialReveal = [
        { r: 0, c: 0 }, // top-left
        { r: 0, c: boardSize - 1 }, // top-right
        { r: boardSize - 1, c: 0 }, // bottom-left
        { r: boardSize - 1, c: boardSize - 1 }, // bottom-right
      ];
      break;
    }

    case "ascend": {
      initialReveal = [];
      const bottomRow = boardSize - 1; // last row

      for (let c = 0; c < boardSize; c++) {
        initialReveal.push({ r: bottomRow, c });
      }
      break;
    }

    case "river": {
      initialReveal = [];
      const leftCol = 0; // first column

      for (let r = 0; r < boardSize; r++) {
        initialReveal.push({ r, c: leftCol });
      }
      break;
    }

    case "classic-2": {
      initialReveal = [
        { r: Math.floor(boardSize / 2) - 1, c: Math.floor(boardSize / 2) - 1 }, // top left from center
        { r: Math.floor(boardSize / 2) + 1, c: Math.floor(boardSize / 2) + 1 }, // bottom right from center
      ];
      break;
    }

    case "classic-4": {
      initialReveal = [
        { r: Math.floor(boardSize / 2) - 1, c: Math.floor(boardSize / 2) - 1 }, // top left from center
        { r: Math.floor(boardSize / 2) + 1, c: Math.floor(boardSize / 2) + 1 }, // bottom right from center
        { r: Math.floor(boardSize / 2) - 1, c: Math.floor(boardSize / 2) + 1 }, // top right from center
        { r: Math.floor(boardSize / 2) + 1, c: Math.floor(boardSize / 2) - 1 }, // bottom left from center
      ];
      break;
    }

    case "random": {
      initialReveal = [];

      const total = boardSize * boardSize;
      const revealCount = 2 + Math.floor(rng() * (boardSize - 1)); // min:2 max:boardSize
      const used = new Set();

      while (initialReveal.length < revealCount) {
        const index = Math.floor(rng() * total);
        if (used.has(index)) continue;
      
        used.add(index);
      
        initialReveal.push({
          r: Math.floor(index / boardSize),
          c: index % boardSize,
        });
      }
    
      break;
    }

    default: {
      initialReveal = [
        { r: Math.floor(boardSize / 2) - 1, c: Math.floor(boardSize / 2) - 1 }, // top left from center
        { r: Math.floor(boardSize / 2) + 1, c: Math.floor(boardSize / 2) + 1 }, // bottom right from center
      ];
    }
  }

  initialReveal.forEach((pos) => (visibleMap[pos.r][pos.c] = true));

  renderExplorationBoard();
}

// Create fog of war bingo board
function renderExplorationBoard() {
  board.innerHTML = "";

  board.style.gridTemplateColumns = `repeat(${boardSize}, 1fr)`;

  // fill squares
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const div = document.createElement("div");
      div.className = "objective";

      const id = `fog-${r}-${c}`;

      // shiny goal support
      if (shinyMode) {
        if (shinySquares.has(id)) {
          div.classList.add("shiny");
        }
      }

      // logic for visible squares
      if (visibleMap[r][c]) {
        const obj = explorationBoard[r][c];

        // icons or text
        if (iconsEnabled && obj.icon) {
          const img = document.createElement('img');
          img.src = obj.icon;
          img.alt = obj.name;
          div.appendChild(img);
        } else {
          div.textContent = obj.name;
        }
        
        if (markedMap[r][c]) {
          div.classList.add("marked");
        } else {
          div.classList.remove("marked");
        }

        const state = squareStates[id] || 0;

        div.classList.remove("border-mark", "completed");

        if (state === 1) div.classList.add("border-mark");
        if (state === 2) div.classList.add("completed");

        // marking squares
        div.addEventListener("click", () => {
          // left click = complete
          setSquareState(div, id, 2);
          updateFogScore();
          revealNeighbors(r, c);
        });

        div.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          // right click = marked
          const newState = squareStates[id] === 1 ? 0 : 1;
          setSquareState(div, id, newState);
          updateFogScore();
        });

        div.addEventListener("wheel", (e) => {
          e.preventDefault();
          // scroll wheel cycles through states
          const dir = e.deltaY < 0 ? 1 : -1; // scroll up/down
          cycleSquare(div, id, dir);
          updateFogScore();
          if (squareStates[id] === 2) {
            revealNeighbors(r, c);
          }
        });
      } else {

        if (iconsEnabled) {
          div.textContent = '';
        } else {
          div.textContent = ''; 
        }

        div.style.fontSize = "50px";
      }

      board.appendChild(div);
    }
  }
}

// Fog of War score: count squares
function updateFogScore() {
  let count = 0;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const id = `fog-${r}-${c}`;
      if (squareStates[id] === 2) count++;
    }
  }
  scoreState.squaresCompleted = count;
  renderScore();
}

// Reveal hidden squares
function revealNeighbors(r, c) {
  const directions = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
  ];

  visibleMap[r][c] = true;

  directions.forEach((dir) => {
    const nr = r + dir.dr;
    const nc = c + dir.dc;
    if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize) {
      visibleMap[nr][nc] = true;
    }
  });

  renderExplorationBoard();
}

// ================= Rush Mode ====================

// Create rush board with remaining objectives
function renderRushBoard() {
  hideTooltip();
  board.innerHTML = "";

  // shiny goal support
  const currentRoundNumber = completedObjectives.length + 1;
  currentRoundIsShiny = shinyRounds.has(currentRoundNumber);

  // remove bottom spacing under score
  document.getElementById("score").style.marginBottom = 0;

  // display 3 in a row
  board.style.gridTemplateColumns = "repeat(3, 1fr)";
  board.style.display = "grid";

  // might not need this?
  if (remainingObjectives.length === 0) {
    status.textContent = " Done";
    return;
  }

  currentRound = shuffle(remainingObjectives).slice(0, 3);

  // shiny goal support
  let shinyIndex = null;
  if (currentRoundIsShiny) {
    shinyIndex = Math.floor(rng() * currentRound.length);
  }

  // fill squares
  currentRound.forEach((obj, index) => {
    const div = document.createElement("div");
    div.className = "objective";

    if (currentRoundIsShiny && index === shinyIndex) {
      div.classList.add("shiny");
    }

    // icons or text
    if (iconsEnabled && obj.icon) {
      const img = document.createElement('img');
      img.src = obj.icon;
      img.alt = obj.name;
      div.appendChild(img);
    } else {
      div.textContent = obj.name;
    }

    // make rush board bigger than other modes
    div.style.width = "120px";
    div.style.height = "120px";
    div.style.fontSize = "20px";

    const id = `rush-${obj.name}`;

    // marking squares
    div.addEventListener("click", () => {
      // left click = completed
      setSquareState(div, id, 2);

      if (squareStates[id] === 2) {
        completeRound(obj, div);
      }
    });

    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // right click = marked

      if (squareStates[id] === 1) {
        setSquareState(div, id, 0);
      } else {
        setSquareState(div, id, 1);
      }
    });

    div.addEventListener("wheel", (e) => {
      e.preventDefault();
      // scroll wheel cycles through states
      const dir = e.deltaY < 0 ? 1 : -1;
      cycleSquare(div, id, dir);

      if (squareStates[id] === 2) {
        completeRound(obj, div);
      }
    });

    board.appendChild(div);
  });
}

// Completing square in rush mode
function completeRound(chosenObjective, element) {
  if (!gameStarted) return;

  element.classList.add("completed");

  // update score
  scoreState.rushRounds = completedObjectives.length + 1;
  renderScore();

  // log chosen square
  const roundDiv = document.createElement("div");
  roundDiv.className = "round";

  const roundTitle = document.createElement("div");
  roundTitle.className = "round-title";
  roundTitle.textContent = `Round ${completedObjectives.length + 1}`;
  roundDiv.appendChild(roundTitle);

  currentRound.forEach((obj) => {
    const item = document.createElement("div");
    if (obj === chosenObjective) {
      item.className = "chosen";
      item.textContent = `✔ ${obj.name}`;
      completedObjectives.push(obj);
    } else {
      item.className = "not-chosen";
      item.textContent = `✖ ${obj.name}`;
    }
    roundDiv.appendChild(item);
  });

  completedList.appendChild(roundDiv);

  updateProgress();

  // check if reached round limit
  if (rushRoundLimit !== null && completedObjectives.length >= rushRoundLimit) {
    hideTooltip();
    status.textContent = "Rush complete!";
    board.innerHTML = "";
    return;
  }

  // next round
  setTimeout(() => {
    remainingObjectives = remainingObjectives.filter(
      (obj) => !currentRound.includes(obj)
    );
    renderRushBoard();
  }, 300);
}

// Progress bar
function updateProgress() {
  var total = rushRoundLimit;
  var completed = completedObjectives.length;
  if (total === null) {
    total = allObjectives.length;
    completed = completedObjectives.length + completedObjectives.length * 2;
  }
  const percent = (completed / total) * 100;
  if (percent < 100) {
    document.getElementById("progressBar").style.width = percent + "%";
  } else {
    document.getElementById("progressBar").style.width = 100 + "%";
  }
}

// Icon toggle listener
document.getElementById('icon-Checkbox').addEventListener('change', function () {
  iconsEnabled = this.checked;

  // re-render whichever board is active
  if (explorationBoard?.length) renderExplorationBoard();
  if (bingoBoard?.length) renderTraditionalBoard();
  if (currentRound?.length) renderRushBoard();
});

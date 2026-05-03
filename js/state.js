let allObjectives = [];
let gameGenerated = false;
let gameStarted = false;
let rng = Math.random;
let seedValue = null;

let remainingObjectives = [];
let currentRound = [];
let completedObjectives = [];

let bingoBoard = [];
let bingoMarks = [];
let bingoSize = 5;
let bingoCompleted = false;
let bingoLines = [];

let explorationBoard = [];
let visibleMap = [];
let boardSize = 5;

let selectedMode = "rush";
const rushLimit = document.getElementById("rushOptions");
const traditionalOptions = document.getElementById("traditionalOptions");
const explorationOptions = document.getElementById("explorationOptions");
const modeSelect = document.getElementById("modeSelect");

let scoreState = {
  bingoLines: 0,
  squaresCompleted: 0,
  rushRounds: 0,
};

let shinyMode = false;
let bingoLogic = true;
let iconsEnabled = true;

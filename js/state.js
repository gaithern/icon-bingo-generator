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
const roguelikeOptions = document.getElementById("roguelikeOptions");
const modeSelect = document.getElementById("modeSelect");

let scoreState = {
  bingoLines: 0,
  squaresCompleted: 0,
  rushRounds: 0,
};

let shinyMode = false;
let bingoLogic = true;
let iconsEnabled = true;

const ROGUELIKE_CONFIGS = {
  B9: {
    rows: 9,
    maxWidth: 7,
    centerCol: 3,
    redLayers: [5, 7],
    goalLayer: 9,
  },
  B15: {
    rows: 15,
    maxWidth: 9,
    centerCol: 4,
    redLayers: [6, 9, 12],
    goalLayer: 15,
  },
  B20: {
    rows: 20,
    maxWidth: 13,
    centerCol: 6,
    redLayers: [8, 12, 16],
    goalLayer: 20,
  },
};

// State for the active roguelike board
let rogueConfig = null;
let rogueBoard = [];
let rogueVisibleMap = [];
let rogueLastCol = null;
let rogueCurrentLayer = 0;
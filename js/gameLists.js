const GAME_LISTS = {
  kh1: {
    name: "Kingdom Hearts 1",
    lists: [
      {
        id: "kh1-ap",
        name: "AP Randomizer",
        file: "kh1-ap.json",
      },
      {
        id: "kh1-generic",
        name: "Generic",
        file: "kh1-generic.json",
      },
    ],
  },

  kh2: {
    name: "Kingdom Hearts 2",
    lists: [
      {
        id: "kh2-generic",
        name: "Generic",
        file: "kh2-generic.json",
      },
      {
        id: "kh2-worlds",
        name: "Worlds",
        file: "kh2-worlds.json",
      },
      {
        id: "kh2-visits",
        name: "Visits",
        file: "kh2-visits.json",
      },
      {
        id: "kh2-bunter",
        name: "Boss Hunter",
        file: "kh2-bunter.json",
      },
    ],
  },

  kh3: {
    name: "Kingdom Hearts 3",
    lists: [
      {
        id: "kh3-default",
        name: "Default",
        file: "kh3-default.json",
      },
    ],
  },

  oot: {
    name: "Zelda: Ocarina of Time",
    lists: [
      {
        id: "oot-default",
        name: "Default",
        file: "zelda-oot.json",
      },
    ],
  },
};

const DEFAULT_LIST_BY_GAME = {
  kh1: "kh1-ap.json",
  kh2: "kh2-generic.json",
  kh3: "kh3-default.json",
  oot: "zelda-oot.json",
};

/*
Sphere-based placement for Roguelike and Fog of War (KH1 AP Randomizer)

"Sphere" here means logical playthrough depth, as computed by Archipelago's
own sphere algorithm: sphere 0 is every location reachable with no items,
sphere 1 is what becomes reachable after collecting sphere 0's items, etc.
The KH1 apworld exports this per seed as location_spheres.json (location
code -> sphere index), bundled straight into the player's patch zip
alongside item_location_map.json (location code -> item code) — the same
.zip a player already downloads to patch their game with. miniZip.js reads
both files out of that zip client-side; nothing needs to be extracted by
hand.

Both files are keyed by numeric code, not the names kh1-ap.json objectives
reference via apLocations/apItems, so they're cross-referenced against two
static code -> name maps bundled with this generator (lists/kh1-location-
ids.json, lists/kh1-item-ids.json), generated once from the KH1 apworld's
location/item tables.

- apLocations / apLocationThreshold resolve directly from location spheres.
- apItems resolves by reverse-mapping item_location_map: every location
  (belonging to this player) that placed a copy of the named item
  contributes its sphere; for "collect N of X", the Nth-earliest of those
  spheres (sorted ascending) is when the objective becomes completable.
  Items shown as another player's item in item_location_map (a generic
  placeholder code) don't match anything in kh1-item-ids.json and are
  silently skipped, same as unreachable ("-1") locations.
*/

let kh1LocationIdToName = null; // Map<string code, string name>, lazy-loaded
let kh1ItemIdToName = null; // Map<string code, string name>, lazy-loaded
let locationSphereMap = null; // Map<locationName, sphereIndex>, from the uploaded patch zip
let itemSphereMap = null; // Map<itemName, sphereIndex[]> (sorted ascending), from the uploaded patch zip
// The exact objectives currently on the board (set by startExplorationBingo/
// startRoguelikeBingo), independent of arrangement — this is what "which
// objectives are on the board" reproducibility rests on, and what a later
// sphere upload rearranges without reselecting.
let lastSelectedPool = null;

const sphereFileInput = document.getElementById("sphereFileInput");
const sphereStatus = document.getElementById("sphereStatus");
const sphereClearBtn = document.getElementById("sphereClearBtn");

async function loadStaticIdMap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url}`);
  const raw = await res.json();
  return new Map(Object.entries(raw));
}

async function loadKh1LocationIdMap() {
  if (!kh1LocationIdToName) {
    kh1LocationIdToName = await loadStaticIdMap("lists/kh1-location-ids.json");
  }
  return kh1LocationIdToName;
}

async function loadKh1ItemIdMap() {
  if (!kh1ItemIdToName) {
    kh1ItemIdToName = await loadStaticIdMap("lists/kh1-item-ids.json");
  }
  return kh1ItemIdToName;
}

async function handleSphereFileUpload(file) {
  if (!file) return;

  try {
    const [locIdToName, itemIdToName, extracted] = await Promise.all([
      loadKh1LocationIdMap(),
      loadKh1ItemIdMap(),
      readJsonFilesFromZip(file, ["location_spheres.json", "item_location_map.json"]),
    ]);

    const rawLocationSpheres = extracted["location_spheres.json"];
    if (!rawLocationSpheres) {
      throw new Error(
        "No location_spheres.json in that zip — either it's not a KH1 AP patch, or it predates this feature.",
      );
    }
    const rawItemLocationMap = extracted["item_location_map.json"] || {};

    // code -> sphere, before translating to names (also used to look up
    // item spheres by the location code item_location_map is keyed on).
    const sphereByCode = new Map();
    Object.entries(rawLocationSpheres).forEach(([code, sphere]) => {
      if (sphere >= 0) sphereByCode.set(String(code), sphere);
    });

    const nameSphereMap = new Map();
    sphereByCode.forEach((sphere, code) => {
      const name = locIdToName.get(code);
      if (name) nameSphereMap.set(name, sphere);
    });

    const itemSpheres = new Map();
    Object.entries(rawItemLocationMap).forEach(([locationCode, itemCode]) => {
      const sphere = sphereByCode.get(String(locationCode));
      if (sphere === undefined) return;
      const itemName = itemIdToName.get(String(itemCode));
      if (!itemName) return; // other player's item (placeholder code) or unknown
      if (!itemSpheres.has(itemName)) itemSpheres.set(itemName, []);
      itemSpheres.get(itemName).push(sphere);
    });
    itemSpheres.forEach((spheres) => spheres.sort((a, b) => a - b));

    locationSphereMap = nameSphereMap;
    itemSphereMap = itemSpheres;

    if (sphereStatus) {
      sphereStatus.textContent =
        `Loaded spheres for ${nameSphereMap.size} location${nameSphereMap.size === 1 ? "" : "s"} ` +
        `and ${itemSpheres.size} item type${itemSpheres.size === 1 ? "" : "s"}.`;
      sphereStatus.classList.remove("ap-error");
    }

    // The panel only exists in-game now, so a board (with a captured pool)
    // always already exists by the time this can run.
    reorderCurrentBoardBySphere();
  } catch (err) {
    locationSphereMap = null;
    itemSphereMap = null;
    if (sphereStatus) {
      sphereStatus.textContent = err instanceof Error ? err.message : "Couldn't read that zip.";
      sphereStatus.classList.add("ap-error");
    }
  }
}

function clearSphereData() {
  locationSphereMap = null;
  itemSphereMap = null;
  if (sphereFileInput) sphereFileInput.value = "";
  if (sphereStatus) {
    sphereStatus.textContent = "";
    sphereStatus.classList.remove("ap-error");
  }
  reorderCurrentBoardBySphere(); // falls back to the pool's existing shuffled order
}

sphereFileInput?.addEventListener("change", (e) => handleSphereFileUpload(e.target.files[0]));
sphereClearBtn?.addEventListener("click", clearSphereData);

// A "requirement group" is an objective itself, or one apAnyOf alternative.
// Sphere = the deepest (max) of its AND'd requirements, since it's only
// satisfied once every one of them is met. Returns null if any part of the
// group can't be resolved from the loaded sphere data.
function computeRequirementGroupSphere(group, sphereMap, itemSpheres) {
  let maxSphere = null;

  if (Array.isArray(group.apItems) && group.apItems.length) {
    for (const req of group.apItems) {
      const spheres = itemSpheres?.get(req.name);
      if (!spheres || spheres.length < req.count) return null;
      const sphere = spheres[req.count - 1];
      if (maxSphere === null || sphere > maxSphere) maxSphere = sphere;
    }
  }

  if (Array.isArray(group.apLocations) && group.apLocations.length) {
    for (const name of group.apLocations) {
      const sphere = sphereMap.get(name);
      if (sphere === undefined) return null;
      if (maxSphere === null || sphere > maxSphere) maxSphere = sphere;
    }
  }

  if (group.apLocationThreshold && Array.isArray(group.apLocationThreshold.locations)) {
    const { locations, count } = group.apLocationThreshold;
    const spheres = locations
      .map((name) => sphereMap.get(name))
      .filter((s) => s !== undefined)
      .sort((a, b) => a - b);
    if (spheres.length < count) return null;
    const sphere = spheres[count - 1];
    if (maxSphere === null || sphere > maxSphere) maxSphere = sphere;
  }

  return maxSphere;
}

// apAnyOf is OR'd, so an objective is done as soon as its easiest
// alternative is — sphere = the shallowest (min) resolvable alternative.
function computeObjectiveSphere(obj, sphereMap, itemSpheres) {
  if (!sphereMap) return null;

  if (Array.isArray(obj.apAnyOf) && obj.apAnyOf.length) {
    const spheres = obj.apAnyOf
      .map((alt) => computeRequirementGroupSphere(alt, sphereMap, itemSpheres))
      .filter((s) => s !== null);
    return spheres.length ? Math.min(...spheres) : null;
  }

  return computeRequirementGroupSphere(obj, sphereMap, itemSpheres);
}

// Sphere only captures "is this unlocked yet," not "how much of it do you
// need" — a common early drop can make "2 Postcards" and "7 Postcards"
// resolve to the identical sphere (both obtainable immediately), which a
// pure sphere sort would then leave to shuffle order. This is a secondary
// tie-break so same-sphere objectives still respect the obvious "fewer
// required = easier" ordering instead of coming out shuffled.
function computeRequirementGroupEffort(group) {
  let effort = 0;
  if (Array.isArray(group.apItems)) {
    effort += group.apItems.reduce((sum, req) => sum + (req.count || 0), 0);
  }
  if (Array.isArray(group.apLocations)) {
    effort += group.apLocations.length;
  }
  if (group.apLocationThreshold) {
    effort += group.apLocationThreshold.count || 0;
  }
  return effort;
}

function computeObjectiveEffort(obj) {
  if (Array.isArray(obj.apAnyOf) && obj.apAnyOf.length) {
    return Math.min(...obj.apAnyOf.map(computeRequirementGroupEffort));
  }
  return computeRequirementGroupEffort(obj);
}

// Some tiered objectives aren't a single apItems/apLocationThreshold count
// at all — e.g. "Jungle Slider 10/20/30/40/50 Fruits" or "10/20/.../90
// Puppies" are each their own standalone apLocations entry (one distinct
// AP check per tier), so `effort` above is 1 for every tier and can't
// distinguish them. When a KH1 minigame/collection check like that doesn't
// gate on items at all, every tier becomes reachable at the same sphere the
// moment the minigame itself is, leaving sphere AND effort both tied. As a
// last-resort tie-break, pull the number out of the objective's own name
// (harmless no-op for names without one, and redundant-but-consistent for
// objectives effort already orders correctly).
function extractNameMagnitude(name) {
  const match = name.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

// Groups objectives that are just different tiers of the same underlying
// collectible/threshold (e.g. "5 Postcards" / "8 Postcards", or "4/6/8 White
// Trinities" sharing one apLocationThreshold location list) — the tiers
// that come from the same source as each other. Used to keep a Roguelike
// row from offering two tiers of the same thing side by side, since picking
// the higher one is never a real choice when the lower one (a strict
// prerequisite of it) is sitting right next to it. Returns null for
// objectives that aren't part of any recognizable tier family — those are
// never considered a duplicate of anything.
function computeObjectiveFamilyKey(obj) {
  if (Array.isArray(obj.apItems) && obj.apItems.length) {
    return "items:" + [...obj.apItems.map((req) => req.name)].sort().join("|");
  }
  if (obj.apLocationThreshold && Array.isArray(obj.apLocationThreshold.locations)) {
    return "threshold:" + [...obj.apLocationThreshold.locations].sort().join("|");
  }
  if (Array.isArray(obj.apLocations) && obj.apLocations.length) {
    const stripped = obj.name.replace(/\d+/g, "#");
    if (stripped !== obj.name) return "name:" + stripped;
  }
  return null;
}

// Pulls the next entry out of `pool` that doesn't repeat a tier family
// already used elsewhere in the current row, removing it from the pool so
// it isn't picked again. Falls back to just taking the front entry if
// every remaining objective would repeat a family already in this row
// (only possible when a single family makes up nearly the whole list).
function takeNextForRow(pool, usedFamiliesThisRow) {
  for (let i = 0; i < pool.length; i++) {
    const key = computeObjectiveFamilyKey(pool[i]);
    if (key === null || !usedFamiliesThisRow.has(key)) {
      const [obj] = pool.splice(i, 1);
      if (key !== null) usedFamiliesThisRow.add(key);
      return obj;
    }
  }
  return pool.shift();
}

// Shared fill order for Roguelike and Fog of War: objectives with a
// resolvable sphere first (shallow to deep, shuffled within ties), then
// everything unresolved shuffled after them. Roguelike consumes this
// front-to-back by row; Fog of War zips it against cells ordered by
// distance from the initial reveal squares. Falls back to the pool's
// existing (already seed-shuffled) order when no sphere data is loaded, or
// for any list whose objectives don't carry apLocations/apItems at all.
//
// Deliberately takes an ALREADY-SELECTED, fixed-size pool rather than the
// full objective list — which objectives end up on the board is purely a
// function of (seed, list, settings), decided before this ever runs, so a
// board link is reproducible by anyone regardless of whether they have
// sphere data. This only ever reorders that fixed set into a different
// arrangement (and, for Roguelike, which row); it can't change who's on the
// board, which is what lets it re-run later from the board page itself once
// a matching .zip gets uploaded, without needing to regenerate anything.
function orderPoolBySphere(pool) {
  if (!locationSphereMap) return pool;

  const withSphere = [];
  const withoutSphere = [];

  pool.forEach((obj) => {
    const sphere = computeObjectiveSphere(obj, locationSphereMap, itemSphereMap);
    if (sphere === null) withoutSphere.push(obj);
    else
      withSphere.push({
        obj,
        sphere,
        effort: computeObjectiveEffort(obj),
        magnitude: extractNameMagnitude(obj.name),
      });
  });

  if (!withSphere.length) return pool;

  const ordered = shuffle(withSphere).sort(
    (a, b) => a.sphere - b.sphere || a.effort - b.effort || a.magnitude - b.magnitude,
  );
  return [...ordered.map((entry) => entry.obj), ...shuffle(withoutSphere)];
}

// Re-lays out the current board using the objectives already on it (see
// lastSelectedPool, set by startExplorationBingo/startRoguelikeBingo) —
// called after a sphere .zip is uploaded or cleared from the board page, so
// arranging by sphere depth is a pure rearrangement, never a reselection.
function reorderCurrentBoardBySphere() {
  if (!lastSelectedPool) return;

  if (selectedMode === "exploration") {
    startExplorationBingo(lastSelectedPool);
  } else if (selectedMode === "roguelike") {
    startRoguelikeBingo(lastSelectedPool);
  } else {
    return;
  }

  if (typeof apConnected !== "undefined" && apConnected) {
    buildApLocationIndex();
    applyApCheckedSquares();
  }
}

// Called once from generateGame() (gameModes.js) after a board exists —
// mirrors onApGameGenerated in apTracker.js. The panel only ever appears
// in-game now, so eligibility is a one-time fact about the board that was
// just generated, not something that needs to react to further UI changes.
function onSphereGameGenerated() {
  const panel = document.getElementById("spherePanel");
  if (!panel) return;
  const eligible =
    gameSelect.value === "kh1" &&
    listSelect.value === "kh1-ap.json" &&
    (selectedMode === "roguelike" || selectedMode === "exploration");
  panel.classList.toggle("hidden", !eligible);
}

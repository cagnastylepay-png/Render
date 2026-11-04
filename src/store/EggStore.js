"use strict";

// Planned: snapshots indexed by session/place/job/cycle; revisions scoped to session/cycle.
// Dashboard identity: placeId + jobId + cycleId + uid. Expire stale observations.
function createEggStore() {
  throw new Error("EggStore is not implemented.");
}

module.exports = { createEggStore };

"use strict";
const path = require("node:path");
const { createEggStore } = require("./store/EggStore");
const { createPlayerStore } = require("./store/PlayerStore");
const { createEggHistory } = require("./store/EggHistory");
const { createMongoHistory } = require("./store/MongoHistory");
const { attachEggGateway } = require("./ws/EggGateway");
function mountAutoSAE(server, options = {}) {
  const store = createEggStore(options.store);
  const players = createPlayerStore(options.players);
  const mongoUri = options.history?.uri ?? process.env.MONGODB_URI;
  const history = mongoUri
    ? createMongoHistory({ uri: mongoUri, database: process.env.MONGODB_DB || "autosae", ...options.history })
    : createEggHistory({ filePath: path.join(process.env.SAE_DATA_DIR || path.join(__dirname, "..", "data"), "egg-history.json"), ...options.history });
  const gateway = attachEggGateway(server, store, players, history, options.gateway);
  return { store, players, history, gateway, close() { gateway.close(); return history.close(); } };
}
module.exports = { mountAutoSAE };

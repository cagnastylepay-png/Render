"use strict";
const { createEggStore } = require("./store/EggStore");
const { attachEggGateway } = require("./ws/EggGateway");
function mountAutoSAE(server, options = {}) {
  const store = createEggStore(options.store);
  const gateway = attachEggGateway(server, store, options.gateway);
  return { store, gateway, close: () => gateway.close() };
}
module.exports = { mountAutoSAE };

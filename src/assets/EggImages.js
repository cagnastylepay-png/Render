"use strict";
const catalog = require("./egg-images.json");
function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/egg$/, "");
}
const byName = new Map(Object.entries(catalog).map(([name, url]) => [normalize(name), url]));
function getEggImage(egg) {
  for (const name of [egg.category, egg.name, egg.eggName]) {
    const result = byName.get(normalize(name));
    if (result) return result;
  }
  return null;
}
module.exports = { getEggImage };

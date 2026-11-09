"use strict";
// Data.Areas.GetProgressionOrder, verified against the connected Studio place.
const biomeIds=["Forest","Lake","Desert","Jungle","Snow","Volcano","Abyss Ocean","Prehistoric","Cosmic","Cherry Blossom","Titan Temple","Light Dark","Enchanted Forest","Alien"];
function validMaxBiome(id){return id==="All"||biomeIds.includes(id);}
function allowedBiome(egg,maximum="All"){
 if(maximum==="All")return true;
 const rank=biomeIds.indexOf(egg.areaId??egg.AreaId??egg.zone),limit=biomeIds.indexOf(maximum);
 return rank>=0&&limit>=0&&rank<=limit;
}
module.exports={biomeIds,validMaxBiome,allowedBiome};


"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {planObserverSpread}=require("../src/ws/ObserverSpread");
const peer=(userId,jobId="home",clientKind="observer",placeId="123")=>({
 role:"reporter",clientKind,observerOnly:clientKind==="observer",
 reporterIdentity:{userId,jobId,placeId}
});
test("one Observer stays and each other distinct account moves with a stagger",()=>{
 const keeper=peer("9"),second=peer("10"),third=peer("11"),duplicate=peer("10");
 const plans=planObserverSpread([third,second,keeper,duplicate]);
 assert.equal(plans.get(keeper),null);
 assert.equal(plans.get(second).keeperUserId,"9");
 assert.equal(plans.get(second).delaySeconds,12);
 assert.equal(plans.get(third).delaySeconds,16);
 assert.deepEqual(plans.get(second),plans.get(duplicate));
});
test("separate servers and places, Admin, Hub, and stale sockets do not cause a hop",()=>{
 const one=peer("1"),otherServer=peer("2","elsewhere"),otherPlace=peer("3","home","observer","456");
 const admin=peer("4","home","admin"),hub=peer("5","home","hub"),stale={...peer("6"),superseded:true};
 const plans=planObserverSpread([one,otherServer,otherPlace,admin,hub,stale,{role:"viewer"}]);
 assert.equal(plans.size,3);
 for(const target of plans.values())assert.equal(target,null);
});
test("a departure cancels the surviving Observer hop, duplicate sessions are not two accounts",()=>{
 const first=peer("1"),second=peer("2");
 assert.ok(planObserverSpread([first,second]).get(second));
 assert.equal(planObserverSpread([second]).get(second),null);
 assert.equal(planObserverSpread([first,peer("1")]).get(first),null);
});

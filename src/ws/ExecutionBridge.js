"use strict";
const {randomUUID}=require("node:crypto");
function createExecutionBridge({clients,send,isFavorite}){
 const pending=new Map();
 const configured=true;
 function ready(ws){return configured&&ws.role==="reporter"&&ws.readyState===1&&ws.executionOptIn===true&&!!ws.reporterIdentity&&isFavorite(ws.reporterIdentity.userId);}
 function state(){return {version:1,type:"execute.clients",clients:[...clients].filter(ready).map(ws=>({clientId:ws.connectionId,userId:ws.reporterIdentity.userId,name:ws.reporterIdentity.name,placeId:ws.reporterIdentity.placeId,jobId:ws.reporterIdentity.jobId}))};}
 function broadcast(){const message=state();for(const ws of clients)if(ws.role==="viewer")send(ws,message);}
 function finish(id,result){const row=pending.get(id);if(!row)return;pending.delete(id);clearTimeout(row.timer);send(row.owner,{...result,version:1,type:"execute.result",requestId:id,clientId:row.target.connectionId,receivedAt:new Date().toISOString()});}
 function cancel(row,code){if(!row)return;send(row.target,{version:1,type:"execute.cancel",requestId:row.id});finish(row.id,{ok:false,error:code});}
 function policy(ws){return {version:1,type:"execute.policy",configured,authorized:ws.role==="viewer"};}
 return {
  configured,ready,policy,broadcast,state,
  register(ws,message){ws.executionOptIn=message.allowExecution===true;},
  changed(){for(const row of pending.values())if(!ready(row.target))cancel(row,"CLIENT_NO_LONGER_AUTHORIZED");broadcast();},
  handle(ws,message){
   if(!["execute.request","execute.result"].includes(message.type))return false;
   if(message.version!==1)throw Error("Invalid execution protocol version");
   if(message.type==="execute.request"){
    if(ws.role!=="viewer")throw Error("Only a dashboard viewer may request execution");
    if(typeof message.code!=="string"||!message.code.trim()||Buffer.byteLength(message.code)>32768)throw Error("Lua code must contain 1 to 32768 bytes");
    if(message.timeoutMs!==undefined&&(!Number.isInteger(message.timeoutMs)||message.timeoutMs<1000||message.timeoutMs>30000))throw Error("Execution timeout must be 1000 to 30000 ms");
    const target=[...clients].find(client=>client.connectionId===message.clientId&&ready(client));
    if(!target)throw Error("Opted-in favorite client unavailable");
    if(pending.size>=100||[...pending.values()].some(row=>row.target===target))throw Error("A test is already running on this client");
    const id=randomUUID(),timeoutMs=message.timeoutMs||10000;
    const timer=setTimeout(()=>cancel(pending.get(id),"RESULT_TIMEOUT"),timeoutMs+1000);timer.unref();
    const row={id,owner:ws,target,timer};pending.set(id,row);
    send(ws,{version:1,type:"execute.accepted",requestId:id,clientId:target.connectionId});
    send(target,{version:1,type:"execute.request",requestId:id,code:message.code,timeoutMs});return true;
   }
   const row=pending.get(message.requestId);
   if(!row)return true;
   if(row.target!==ws||!ready(ws))throw Error("Execution result does not belong to this client");
   if(typeof message.ok!=="boolean"||Buffer.byteLength(JSON.stringify(message))>65536)throw Error("Invalid execution result");
   finish(message.requestId,{ok:message.ok,result:message.result,returnValues:message.returnValues,resultCount:message.resultCount,error:typeof message.error==="string"?message.error.slice(0,8192):undefined,durationMs:message.durationMs});return true;
  },
  disconnect(ws){for(const row of pending.values()){if(row.target===ws)finish(row.id,{ok:false,error:"CLIENT_DISCONNECTED"});else if(row.owner===ws)cancel(row,"OPERATOR_DISCONNECTED");}broadcast();},
  close(){for(const row of pending.values())clearTimeout(row.timer);pending.clear();}
 };
}
module.exports={createExecutionBridge};

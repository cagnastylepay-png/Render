self.addEventListener("push",event=>{
 const data=event.data?.json();
 if(data?.title)event.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag,data:{url:"/"}}));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const tabs=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  const dashboard=tabs.find(tab=>new URL(tab.url).origin===self.location.origin);
  if(dashboard)await dashboard.focus();
  else await self.clients.openWindow("/");
 })());
});

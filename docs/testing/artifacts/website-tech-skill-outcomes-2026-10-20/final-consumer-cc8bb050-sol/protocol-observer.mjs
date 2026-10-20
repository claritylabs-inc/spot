// Structural browser protocol only; never store frame bodies, credentials, arguments or query strings.
export function observe(context){
 const protocol={http:{},websocketSent:{},websocketReceived:{},udfNames:new Set()};
 const count=(table,key)=>table[key]=(table[key]??0)+1;
 context.on('response',response=>{try{const url=new URL(response.url());count(protocol.http,response.status()+' '+url.origin+url.pathname.replace(/\/clients\/[^/]+/g,'/clients/[synthetic-id]'));}catch{}});
 context.on('page',page=>page.on('websocket',socket=>{
  const frame=(table,event)=>{try{const value=JSON.parse(String(event.payload));if(typeof value.type==='string')count(table,value.type);for(const item of [value,...(Array.isArray(value.modifications)?value.modifications:[])])if(typeof item.udfPath==='string')protocol.udfNames.add(item.udfPath);}catch{count(table,'non-json')}};
  socket.on('framesent',event=>frame(protocol.websocketSent,event));socket.on('framereceived',event=>frame(protocol.websocketReceived,event));
 }));
 return ()=>({...protocol,udfNames:[...protocol.udfNames],privacy:'Only HTTP status/origin/path and websocket message type/UDF names. No headers, query strings, frame bodies, auth or arguments.'});
}

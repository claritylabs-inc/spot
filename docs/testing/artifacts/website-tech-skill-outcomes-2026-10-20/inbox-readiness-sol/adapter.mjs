import https from 'node:https';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import dayjs from 'dayjs';

const digest=value=>createHash('sha256').update(value).digest();
const MAX_BYTES=256*1024;
const MAX_MESSAGES=20;

// Harness-only manual MCP bridge. No API credentials, model calls or mail sending.
// A missing real MCP feed refuses; it never manufactures a successful empty inbox.
export function createAdapter(privateRoot,extractVerification){
 const counts={requests:0,refusedCapability:0,refusedExpired:0,refusedRecipient:0,missingRealFeed:0,successfulReads:0,messagesExposed:0};
 const server=https.createServer({key:readFileSync(join(privateRoot,'server.key')),cert:readFileSync(join(privateRoot,'server.crt'))},(request,response)=>{
  counts.requests++;
  const reply=(status,body)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(body));};
  try{
   const config=JSON.parse(readFileSync(join(privateRoot,'config.json')));
   const url=new URL(request.url,'https://localhost');
   const token=url.searchParams.get('token')??'';
   if(request.method!=='GET'||url.pathname!=='/research-inbox'||! /^[a-f0-9]{64}$/.test(token)||!timingSafeEqual(digest(token),digest(config.capability))){counts.refusedCapability++;return reply(404,{error:'Not found'});}
   if(!Number.isFinite(config.expiresAt)||config.expiresAt<=dayjs().valueOf()||config.expiresAt>config.issuedAt+30*60*1000){counts.refusedExpired++;return reply(404,{error:'Not found'});}
   if([...url.searchParams.keys()].some(key=>!['token','recipient'].includes(key))||(url.searchParams.has('recipient')&&url.searchParams.get('recipient')!==config.recipient)){counts.refusedRecipient++;return reply(404,{error:'Not found'});}
   let feed;
   try{const bytes=readFileSync(join(privateRoot,'received-mcp.json'));if(bytes.length>1024*1024)throw Error('Feed too large');feed=JSON.parse(bytes);}
   catch{counts.missingRealFeed++;return reply(503,{error:'Actual scoped MCP receipt is not available'});}
   // The controller writes this envelope ONLY from actual exact-recipient MCP results.
   if(feed.source!=='connected-resend-mcp'||feed.recipient!==config.recipient||feed.windowStart!==config.issuedAt||!Array.isArray(feed.messages)||!feed.provenance?.toolResponseSha256||feed.messages.length>MAX_MESSAGES)return reply(503,{error:'Scoped receipt provenance is invalid'});
   const emails=[];
   for(const message of feed.messages){
    const receivedAt=typeof message.created_at==='string'?dayjs(message.created_at).valueOf():NaN;
    const recipients=Array.isArray(message.to)?message.to.map(value=>String(value).trim().toLowerCase()):[];
    if(recipients.length!==1||recipients[0]!==config.recipient||!Number.isFinite(receivedAt)||receivedAt<config.issuedAt||receivedAt>config.expiresAt||receivedAt>dayjs().valueOf()||typeof message.id!=='string')return reply(503,{error:'Scoped receipt does not match this inbox'});
    const subject=String(message.subject??'').slice(0,500);
    emails.push({from:String(message.from??'').slice(0,320),subject,receivedAt:dayjs(receivedAt).toISOString(),...extractVerification(String(message.text??'').slice(0,50000),String(message.html??'').slice(0,200000),subject)});
   }
   const body={address:config.recipient,emails};
   if(Buffer.byteLength(JSON.stringify(body))>MAX_BYTES)return reply(503,{error:'Scoped inbox exceeds the byte budget'});
   counts.successfulReads++;counts.messagesExposed+=emails.length;return reply(200,body);
  }catch{return reply(503,{error:'The private adapter is unavailable'});}
 });
 return {server,counts,limits:{ttlMs:30*60*1000,maxMessages:MAX_MESSAGES,maxResponseBytes:MAX_BYTES,maxPrivateFeedBytes:1024*1024}};
}

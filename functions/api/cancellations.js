import {database} from './_commerce.js';
import {cancellationReady,cancellationReply as reply,cancellationSchema,cancellationData,cancellationReceipt,sendCancellationEmails} from './_cancellation.js';
export async function onRequest({request,env}){
 if(request.method==='GET')return reply({enabled:cancellationReady(env)});
 if(request.method!=='POST')return reply({error:'Method not allowed.'},405);
 const origin=new URL(request.url).origin;
 if(request.headers.get('Origin')!==origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'Invalid request.'},403);
 if(Number(request.headers.get('Content-Length')||0)>8192)return reply({error:'Form is too long.'},413);
 if(!cancellationReady(env))return reply({error:'Online cancellation is temporarily unavailable. Email maelinnestore@gmail.com to cancel; you do not need to wait for this form.'},503);
 try{
  const raw=await request.text();if(raw.length>8192)return reply({error:'Form is too long.'},413);
  let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid form.'},400);}
  let data;try{data=cancellationData(body);}catch(error){return reply({error:error.message},400);}
  const db=database(env);await db.prepare(cancellationSchema).run();
  let row=await db.prepare('SELECT * FROM cancellation_notices WHERE id=?').bind(data.id).first();
  if(row&&['name','order_reference','email','items'].some(key=>row[key]!==data[key]))return reply({error:'This submission reference was already used. Reload the form to send a different notice.'},409);
  if(!row){
   // Hash addresses to limit automated email abuse without retaining raw IPs.
   const ip=request.headers.get('CF-Connecting-IP')||'';
   const hash=ip?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.RESEND_API_KEY+':'+ip)))).map(n=>n.toString(16).padStart(2,'0')).join(''):'';
   const since=new Date(Date.now()-600000).toISOString();
   if(hash){const count=await db.prepare('SELECT COUNT(*) AS n FROM cancellation_notices WHERE ip_hash=? AND received_at>?').bind(hash,since).first();if(count.n>=5)return reply({error:'Too many submissions just now. You can email maelinnestore@gmail.com immediately to cancel, or retry this form later.'},429);}
   await db.prepare('INSERT OR IGNORE INTO cancellation_notices (id,name,order_reference,email,items,received_at,ip_hash) VALUES (?,?,?,?,?,?,?)').bind(data.id,data.name,data.order_reference,data.email,data.items,new Date().toISOString(),hash).run();
   row=await db.prepare('SELECT * FROM cancellation_notices WHERE id=?').bind(data.id).first();
   if(!row||['name','order_reference','email','items'].some(key=>row[key]!==data[key]))return reply({error:'Could not confirm this submission. Email maelinnestore@gmail.com or retry.'},409);
  }
  row=await sendCancellationEmails(env,db,row);
  return reply({received:true,reference:row.id,received_at:row.received_at,email_sent:!!row.customer_email_sent,receipt:cancellationReceipt(row)},row.customer_email_sent?200:202);
 }catch{return reply({error:'We could not confirm receipt. Retry with the same details or email maelinnestore@gmail.com to cancel.'},503);}
}

import {reply,database,configuration,configurationChecks,quote,sessionParameters,stripe,resume,reconcile,settle} from '../_commerce.js';
export async function onRequest({request,env,params}){
 const action=(params.path||[]).join('/');
 if(!configuration(env)||(env.CHECKOUT_MODE==='live'&&new URL(request.url).hostname!=='www.maelinne.ie'))return action==='config'?reply({enabled:false,checks:{...configurationChecks(env),hostname_allowed:env.CHECKOUT_MODE!=='live'||new URL(request.url).hostname==='www.maelinne.ie'}}):reply({error:'Checkout is not open yet. Your bag is saved.'},503);
 const db=database(env),origin=new URL(request.url).origin;
 try{
  await db.prepare('SELECT checkout_session_id FROM orders LIMIT 1').all();
  await db.prepare('SELECT order_id FROM checkout_holds LIMIT 1').all();
  if(request.method==='GET'&&action==='config'){await reconcile(db,env);return reply({enabled:true,test_mode:env.CHECKOUT_MODE==='test',shipping_cents:500,free_shipping_cents:4000,country:'IE'});}
  if(request.method==='GET'&&action==='status'){
   const id=new URL(request.url).searchParams.get('session_id')||'';
   if(!/^cs_(test_|live_)?[a-zA-Z0-9_]+$/.test(id)||id.length>255)return reply({error:'Invalid checkout.'},400);
   const order=await db.prepare('SELECT * FROM orders WHERE checkout_session_id=?').bind(id).first();
   if(!order)return reply({status:'pending'});
   if(!order.stock_committed){const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(id));await settle(db,env,session);}
   const latest=await db.prepare('SELECT id,status,checkout_state,stock_committed,test_mode FROM orders WHERE id=?').bind(order.id).first();
   return reply({status:latest.stock_committed?'paid':latest.checkout_state==='expired'?'expired':'pending',reference:latest.stock_committed?latest.id:null,test_mode:!!latest.test_mode});
  }
  if(request.method!=='POST'||!['quote','start','cancel'].includes(action))return reply({error:'Not found.'},404);
  if(request.headers.get('Origin')!==origin||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Invalid request.'},403);
  if(Number(request.headers.get('content-length')||0)>8192)return reply({error:'Bag is too large.'},413);
  const raw=await request.text();if(raw.length>8192)return reply({error:'Bag is too large.'},413);
  let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid bag.'},400);}
  if(action==='quote'){await reconcile(db,env);return reply(await quote(db,body,env.IMAGES));}
  if(! /^[a-f0-9-]{36}$/.test(body?.checkout_key||''))return reply({error:'Retry checkout from your bag.'},400);
  if(action==='cancel'){
   const order=await db.prepare('SELECT * FROM orders WHERE checkout_key=?').bind(body.checkout_key).first();
   if(!order)return reply({status:'expired'});
   if(!order.stock_committed&&['checkout_creating','checkout_open'].includes(order.checkout_state)){
    try{await resume(db,env,order);}catch{/* Read the stored final state below. */}
    const current=await db.prepare('SELECT * FROM orders WHERE id=?').bind(order.id).first();
    if(current.checkout_session_id&&!current.stock_committed&&current.checkout_state==='checkout_open'){
     let session=await stripe(env,'checkout/sessions/'+encodeURIComponent(current.checkout_session_id));
     if(session.status==='open')session=await stripe(env,'checkout/sessions/'+encodeURIComponent(current.checkout_session_id)+'/expire','');
     await settle(db,env,session);
    }
   }
   const latest=await db.prepare('SELECT * FROM orders WHERE id=?').bind(order.id).first();
   return reply({status:latest.stock_committed?'paid':latest.checkout_state==='expired'?'expired':'pending',session_id:latest.checkout_session_id});
  }
  await reconcile(db,env);
  const existing=await db.prepare('SELECT * FROM orders WHERE checkout_key=?').bind(body.checkout_key).first();
  if(existing)return reply(await resume(db,env,existing));
  const priced=await quote(db,body,env.IMAGES),id=crypto.randomUUID();
  const order={...priced,id,checkout_expires:Math.floor(Date.now()/1000)+1860,test_mode:env.CHECKOUT_MODE==='test'?1:0};
  const payload=sessionParameters(order,priced.lines,origin);
  await db.batch([
   db.prepare("INSERT INTO orders (id,status,checkout_state,total_cents,promo_code,subtotal_cents,discount_cents,shipping_cents,checkout_key,checkout_payload,checkout_expires,test_mode) VALUES (?,'pending','checkout_creating',?,?,?,?,?,?,?,?,?)").bind(id,priced.total_cents,priced.promo_code,priced.subtotal_cents,priced.discount_cents,priced.shipping_cents,body.checkout_key,payload,order.checkout_expires,order.test_mode),
   ...priced.lines.map(line=>db.prepare('INSERT INTO checkout_holds (order_id,variant_id,quantity,unit_price_cents) VALUES (?,?,?,?)').bind(id,line.variant_id,line.quantity,line.unit_price_cents))
  ]);
  return reply(await resume(db,env,{...order,status:'pending',checkout_state:'checkout_creating',checkout_payload:payload}));
 }catch(error){
  const message=String(error.message||error);
  if(/no such|has no column/i.test(message))return reply({error:'Checkout is being prepared. Your bag is saved.'},503);
  if(message.includes('STOCK_UNAVAILABLE'))return reply({error:'Stock changed while checking out. Please refresh your bag.'},409);
  return reply({error:message.includes('UNIQUE')?'Checkout is already starting. Please retry.':message,restart_checkout:error.restartCheckout===true},400);
 }
}

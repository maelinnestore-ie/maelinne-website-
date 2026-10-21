export const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export const database=env=>env.DB.withSession?env.DB.withSession('first-primary'):env.DB;
export function configurationChecks(env){
 const mode=env.CHECKOUT_MODE;
 const prefix=mode==='test'?'sk_test_':mode==='live'?'sk_live_':null;
 return {
  database_bound:!!env.DB,
  checkout_mode_valid:mode==='test'||mode==='live',
  stripe_secret_key_format:!!(prefix&&typeof env.STRIPE_SECRET_KEY==='string'&&env.STRIPE_SECRET_KEY.startsWith(prefix)),
  webhook_secret_format:!!(typeof env.STRIPE_WEBHOOK_SECRET==='string'&&env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')),
  live_approval_valid:mode!=='live'||env.CHECKOUT_LIVE_APPROVED==='true'
 };
}
export function configuration(env){
 const mode=env.CHECKOUT_MODE;
 const expected=mode==='test'?'sk_test_':mode==='live'&&env.CHECKOUT_LIVE_APPROVED==='true'?'sk_live_':null;
 return !!(env.DB&&expected&&env.STRIPE_SECRET_KEY?.startsWith(expected)&&env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'));
}
export function basketItems(items){
 if(!Array.isArray(items)||!items.length||items.length>20)throw Error('Add between one and twenty sizes to your bag.');
 const merged=new Map();
 for(const row of items){
  if(!row||! /^[a-f0-9-]{36}$/.test(row.variant_id)||!Number.isSafeInteger(row.quantity)||row.quantity<1||row.quantity>10)throw Error('Choose a valid size and quantity from 1 to 10.');
  merged.set(row.variant_id,(merged.get(row.variant_id)||0)+row.quantity);
 }
 if([...merged.values()].some(q=>q>10)||[...merged.values()].reduce((a,b)=>a+b,0)>20)throw Error('Use up to 10 of a size and 20 items per order.');
 return [...merged].map(([variant_id,quantity])=>({variant_id,quantity})).sort((a,b)=>a.variant_id.localeCompare(b.variant_id));
}
export function totals(subtotal,code){
 if(!Number.isSafeInteger(subtotal)||subtotal<0||subtotal>200000000)throw Error('Invalid bag total.');
 if(typeof code!=='string'||code.length>40)throw Error('Check your promo code.');
 const promo=code.trim().toUpperCase(),percent=promo===''?0:promo==='WELCOME10'?10:promo==='VIP40'?40:null;
 if(percent===null)throw Error('That promo code is not recognised.');
 const discount=Math.round(subtotal*percent/100),net=subtotal-discount,shipping=net>=4000?0:500;
 return {subtotal_cents:subtotal,promo_code:promo,percent,discount_cents:discount,shipping_cents:shipping,total_cents:net+shipping};
}
export async function quote(db,body,images){
 const items=basketItems(body?.items),lines=[];
 for(const item of items){
  const row=await db.prepare('SELECT v.id,v.product_id,v.label,v.quantity,p.name,p.price_cents,p.image_url,p.active,COALESCE((SELECT SUM(quantity) FROM checkout_holds WHERE variant_id=v.id),0) AS reserved FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?').bind(item.variant_id).first();
  if(!row||!row.active||row.quantity-row.reserved<item.quantity)throw Error('An item is unavailable or has less stock. Please update your bag.');
  let color='';if(images){const gallery=await images.get('galleries/'+row.product_id+'.json');if(gallery){try{color=JSON.parse(await gallery.text()).color||'';}catch{}}}
  lines.push({...item,name:row.name+(color?' — '+color:''),label:row.label,unit_price_cents:row.price_cents,image_url:row.image_url});
 }
 return {...totals(lines.reduce((n,row)=>n+row.quantity*row.unit_price_cents,0),body?.code??''),lines};
}
// Allocate whole cents across units, so Stripe charges exactly the quoted discount.
export function discountedUnits(lines,discount){
 const subtotal=lines.reduce((n,row)=>n+row.unit_price_cents*row.quantity,0);
 let remainder=discount,remainingSubtotal=subtotal;const result=[];
 for(const line of lines)for(let i=0;i<line.quantity;i++){
  const share=remainingSubtotal?Math.round(remainder*line.unit_price_cents/remainingSubtotal):0;
  result.push({name:line.name+' — '+line.label,amount:line.unit_price_cents-share});
  remainder-=share;remainingSubtotal-=line.unit_price_cents;
 }
 return result;
}
export async function stripe(env,path,body,key){
 const posting=body!==undefined&&body!==null;
 const response=await fetch('https://api.stripe.com/v1/'+path,{method:posting?'POST':'GET',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,...(posting?{'content-type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},...(posting?{body}:{})});
 const result=await response.json();
 if(!response.ok){const error=Error('Payment provider could not complete this request. Please retry.');error.definitive=response.status>=400&&response.status<500&&![409,429].includes(response.status);throw error;}
 return result;
}
export function sessionParameters(order,lines,origin){
 const params=new URLSearchParams({mode:'payment','payment_method_types[0]':'card',success_url:origin+'/bag.html?session_id={CHECKOUT_SESSION_ID}',cancel_url:origin+'/bag.html?cancelled=1',client_reference_id:order.id,'metadata[order_id]':order.id,'metadata[promo_code]':order.promo_code,expires_at:String(order.checkout_expires),'shipping_address_collection[allowed_countries][0]':'IE','shipping_options[0][shipping_rate_data][type]':'fixed_amount','shipping_options[0][shipping_rate_data][fixed_amount][amount]':String(order.shipping_cents),'shipping_options[0][shipping_rate_data][fixed_amount][currency]':'eur','shipping_options[0][shipping_rate_data][display_name]':order.shipping_cents?'Ireland delivery':'Free Ireland delivery'});
 discountedUnits(lines,order.discount_cents).forEach((line,i)=>{
  params.set(`line_items[${i}][price_data][currency]`,'eur');params.set(`line_items[${i}][price_data][unit_amount]`,String(line.amount));
  params.set(`line_items[${i}][price_data][product_data][name]`,line.name+(order.promo_code?' ('+order.promo_code+' applied)':''));params.set(`line_items[${i}][quantity]`,'1');
 });
 return params.toString();
}
export async function settle(db,env,session){
 const order=await db.prepare('SELECT * FROM orders WHERE id=?').bind(session.metadata?.order_id||'').first();
 if(!order||session.client_reference_id!==order.id||session.livemode!==!order.test_mode||session.currency!=='eur'||session.amount_total!==order.total_cents||(order.checkout_session_id&&order.checkout_session_id!==session.id))throw Error('Payment verification failed.');
 if(order.stock_committed)return;
 if(session.payment_status==='paid'){
  if(!['checkout_creating','checkout_open'].includes(order.checkout_state))throw Error('Order is not awaiting payment.');
  const address=session.collected_information?.shipping_details||session.shipping_details||{};
  await db.batch([
   db.prepare("UPDATE orders SET status='paid',payment_id=?,checkout_session_id=?,customer_email=?,customer_name=?,shipping_address=? WHERE id=? AND stock_committed=0 AND checkout_state IN ('checkout_creating','checkout_open')").bind(session.payment_intent,session.id,session.customer_details?.email||'',address.name||session.customer_details?.name||'',JSON.stringify(address.address||{}),order.id),
   db.prepare("INSERT OR IGNORE INTO order_items (order_id,variant_id,quantity,unit_price_cents) SELECT h.order_id,h.variant_id,h.quantity,h.unit_price_cents FROM checkout_holds h JOIN orders o ON o.id=h.order_id WHERE h.order_id=? AND o.status='paid' AND o.stock_committed=0").bind(order.id),
   db.prepare("DELETE FROM checkout_holds WHERE order_id=? AND EXISTS (SELECT 1 FROM orders WHERE id=? AND status='paid')").bind(order.id,order.id),
   db.prepare("UPDATE variants SET quantity=quantity-(SELECT quantity FROM order_items WHERE order_id=? AND variant_id=variants.id) WHERE id IN (SELECT variant_id FROM order_items WHERE order_id=?) AND EXISTS (SELECT 1 FROM orders WHERE id=? AND status='paid' AND stock_committed=0)").bind(order.id,order.id,order.id),
   db.prepare("UPDATE orders SET stock_committed=1 WHERE id=? AND status='paid'").bind(order.id)
  ]);
 }else if(session.status==='expired'){
  await db.batch([db.prepare("UPDATE orders SET status='cancelled',checkout_state='expired',checkout_session_id=? WHERE id=? AND checkout_state IN ('checkout_creating','checkout_open')").bind(session.id,order.id),db.prepare("DELETE FROM checkout_holds WHERE order_id=? AND EXISTS (SELECT 1 FROM orders WHERE id=? AND checkout_state='expired')").bind(order.id,order.id)]);
 }
}
export async function resume(db,env,order){
 if(order.stock_committed||order.status==='paid')throw Error('This order is already paid.');
 if(!['checkout_creating','checkout_open'].includes(order.checkout_state))throw Error('This checkout has expired. Start a new checkout.');
 // Reusing the stored payload and idempotency key recovers ambiguous network failures.
 let session;
 try{session=order.checkout_session_id?await stripe(env,'checkout/sessions/'+encodeURIComponent(order.checkout_session_id)):await stripe(env,'checkout/sessions',order.checkout_payload,'maelinne-'+order.id);}
 catch(error){
  if(error.definitive&&!order.checkout_session_id){await db.batch([db.prepare("UPDATE orders SET status='cancelled',checkout_state='expired' WHERE id=? AND checkout_state='checkout_creating' AND checkout_session_id IS NULL").bind(order.id),db.prepare("DELETE FROM checkout_holds WHERE order_id=? AND EXISTS (SELECT 1 FROM orders WHERE id=? AND checkout_state='expired')").bind(order.id,order.id)]);}
  throw error;
 }
 if(session.status!=='open'){await settle(db,env,session);throw Error(session.payment_status==='paid'?'This order is already paid.':'This checkout has expired. Start a new checkout.');}
 if(session.amount_total!==order.total_cents||session.currency!=='eur'||session.livemode!==!order.test_mode||session.metadata?.order_id!==order.id||!session.url?.startsWith('https://checkout.stripe.com/'))throw Error('Payment verification failed.');
 await db.prepare("UPDATE orders SET checkout_session_id=?,checkout_url=?,checkout_state='checkout_open' WHERE id=? AND checkout_state='checkout_creating'").bind(session.id,session.url,order.id).run();
 return {url:session.url,session_id:session.id,test_mode:!!order.test_mode};
}
export async function reconcile(db,env){
 // Never release on a browser cancel or a local clock: verify Stripe's final state.
 const old=(await db.prepare("SELECT * FROM orders WHERE checkout_state IN ('checkout_creating','checkout_open') AND checkout_expires<? ORDER BY checkout_expires LIMIT 5").bind(Math.floor(Date.now()/1000)).all()).results;
 for(const order of old){try{await resume(db,env,order);}catch{/* Hold remains on provider failure; retry on the next visit. */}}
}
export async function signedEvent(raw,header,secret,now=Date.now()){
 if(!header||!secret)return null;
 const parts=header.split(',').map(p=>p.split('=')),timestamp=parts.find(p=>p[0]==='t')?.[1];
 if(!/^\d+$/.test(timestamp||'')||Math.abs(now/1000-Number(timestamp))>300)return null;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 for(const [type,value]of parts){if(type!=='v1'||! /^[a-f0-9]{64}$/.test(value||''))continue;
  const signature=Uint8Array.from(value.match(/../g),b=>parseInt(b,16));
  if(await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(timestamp+'.'+raw)))return JSON.parse(raw);
 }
 return null;
}

// Shared module stays inside Functions, outside the public static assets.
export const onRequest=()=>reply({error:'Not found.'},404);

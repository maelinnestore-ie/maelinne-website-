import {reply,database,configuration,signedEvent,stripe,settle} from './_commerce.js';
export async function onRequestPost({request,env}){
 if(!configuration(env))return reply({error:'Webhook is not configured.'},503);
 if(Number(request.headers.get('content-length')||0)>1048576)return reply({error:'Payload too large.'},413);
 try{
  const raw=await request.text();if(raw.length>1048576)return reply({error:'Payload too large.'},413);
  const event=await signedEvent(raw,request.headers.get('Stripe-Signature'),env.STRIPE_WEBHOOK_SECRET);
  if(!event||event.livemode!==(env.CHECKOUT_MODE==='live'))return reply({error:'Invalid signature or payment mode.'},400);
  if(['checkout.session.completed','checkout.session.expired'].includes(event.type)){
   const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(event.data.object.id));
   if(session.metadata?.order_id)await settle(database(env),env,session);
  }
  return reply({received:true});
 }catch{return reply({error:'Webhook processing failed; retry delivery.'},500);}
}

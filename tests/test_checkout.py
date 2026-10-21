import ctypes,ctypes.util,json,pathlib,sqlite3,hashlib,hmac,urllib.parse,re
root=pathlib.Path(__file__).resolve().parents[1]
lib=ctypes.CDLL(ctypes.util.find_library('JavaScriptCore'));p=ctypes.c_void_p
for name,args,ret in [('JSGlobalContextCreate',[p],p),('JSStringCreateWithUTF8CString',[ctypes.c_char_p],p),('JSEvaluateScript',[p,p,p,p,ctypes.c_int,ctypes.POINTER(p)],p),('JSValueToStringCopy',[p,p,ctypes.POINTER(p)],p),('JSStringGetMaximumUTF8CStringSize',[p],ctypes.c_size_t),('JSStringGetUTF8CString',[p,ctypes.c_char_p,ctypes.c_size_t],ctypes.c_size_t),('JSValueMakeString',[p,p],p),('JSContextGetGlobalObject',[p],p),('JSObjectSetProperty',[p,p,p,p,ctypes.c_uint,ctypes.POINTER(p)],None)]:
 f=getattr(lib,name);f.argtypes=args;f.restype=ret
ctx=lib.JSGlobalContextCreate(None)
def string(v):
 s=lib.JSValueToStringCopy(ctx,v,None);n=lib.JSStringGetMaximumUTF8CStringSize(s);out=ctypes.create_string_buffer(n);lib.JSStringGetUTF8CString(s,out,n);return out.value.decode()
def evaluate(script):
 exc=p();v=lib.JSEvaluateScript(ctx,lib.JSStringCreateWithUTF8CString(script.encode()),None,None,1,ctypes.byref(exc))
 if exc.value:raise RuntimeError(string(exc.value))
 return string(v)
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.execute('PRAGMA foreign_keys=ON');db.executescript((root/'migrations/0001_shop.sql').read_text());db.executescript((root/'migrations/0002_checkout.sql').read_text());db.commit()
callback=ctypes.CFUNCTYPE(p,p,p,p,ctypes.c_size_t,ctypes.POINTER(p),ctypes.POINTER(p))
@callback
def bridge(ctx_,fn,this,argc,args,exception):
 try:
  data=json.loads(string(args[0]));action=data['action']
  if action=='sql':
   c=db.execute(data['sql'],data.get('args',[]));result={'results':[dict(row) for row in c.fetchall()],'meta':{'changes':max(0,c.rowcount)}};db.commit()
  elif action=='batch':
   result=[]
   with db:
    for q in data['queries']:
     c=db.execute(q['sql'],q['args']);result.append({'results':[dict(row) for row in c.fetchall()],'meta':{'changes':max(0,c.rowcount)}})
  elif action=='url':
   u=urllib.parse.urlparse(data['url']);result={'origin':u.scheme+'://'+u.netloc,'hostname':u.hostname,'params':dict(urllib.parse.parse_qsl(u.query))}
  elif action=='parse':result=dict(urllib.parse.parse_qsl(data['text']))
  elif action=='sign':result=hmac.new(data['secret'].encode(),data['text'].encode(),hashlib.sha256).hexdigest()
  elif action=='verify':result=hmac.compare_digest(hmac.new(bytes(data['key']),bytes(data['message']),hashlib.sha256).digest(),bytes(data['signature']))
  else:raise Exception(action)
  result={'value':result}
 except Exception as e:result={'error':str(e)}
 return lib.JSValueMakeString(ctx,lib.JSStringCreateWithUTF8CString(json.dumps(result).encode()))
lib.JSObjectMakeFunctionWithCallback.argtypes=[p,p,callback];lib.JSObjectMakeFunctionWithCallback.restype=p
func=lib.JSObjectMakeFunctionWithCallback(ctx,lib.JSStringCreateWithUTF8CString(b'_bridge'),bridge)
lib.JSObjectSetProperty(ctx,lib.JSContextGetGlobalObject(ctx),lib.JSStringCreateWithUTF8CString(b'_bridge'),func,0,None)
base=r'''
function py(data){const r=JSON.parse(_bridge(JSON.stringify(data)));if(r.error)throw Error(r.error);return r.value;}
const Response={json:(body,options={})=>({status:options.status||200,body,async json(){return body}})};
class URLSearchParams{constructor(value={}){this.data=typeof value==='string'?py({action:'parse',text:value}):{...value}}set(k,v){this.data[k]=String(v)}get(k){return this.data[k]??null}toString(){return Object.entries(this.data).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&')}}
class URL{constructor(url){Object.assign(this,py({action:'url',url}));this.searchParams=new URLSearchParams(this.params)}}
class TextEncoder{encode(s){return Uint8Array.from(unescape(encodeURIComponent(s)),c=>c.charCodeAt(0))}}
let uuid=100;const crypto={randomUUID:()=> '00000000-0000-4000-8000-'+String(++uuid).padStart(12,'0'),subtle:{async importKey(type,key){return Array.from(key)},async verify(alg,key,signature,message){return py({action:'verify',key,signature:Array.from(signature),message:Array.from(message)})}}};
const AbortSignal={timeout:()=>undefined};
const DB={prepare(sql){const q={sql,args:[],bind(...args){this.args=args;return this},async all(){return py({action:'sql',sql:this.sql,args:this.args})},async first(){return (await this.all()).results[0]||null},async run(){return this.all()}};return q},async batch(queries){return py({action:'batch',queries:queries.map(q=>({sql:q.sql,args:q.args}))})}};
const provider=new Map(),idem=new Map();let stripeCalls=0,failOnce=false,providerError=null;
async function fetch(url,options={}){
 stripeCalls++;if(providerError){const error=providerError;providerError=null;return {ok:false,status:400,async json(){return {error}}}}const path=url.replace('https://api.stripe.com/v1/','');let session;
 if(path==='checkout/sessions'){
  if(idem.has(options.headers['Idempotency-Key']))session=idem.get(options.headers['Idempotency-Key']);
  else{const a=new URLSearchParams(options.body),id='cs_test_'+String(provider.size+1);let total=Number(a.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'));
   for(let i=0;a.get(`line_items[${i}][quantity]`);i++)total+=Number(a.get(`line_items[${i}][quantity]`))*Number(a.get(`line_items[${i}][price_data][unit_amount]`));
   session={id,url:'https://checkout.stripe.com/c/pay/'+id,status:'open',payment_status:'unpaid',amount_total:total,currency:'eur',livemode:false,metadata:{order_id:a.get('metadata[order_id]')},client_reference_id:a.get('client_reference_id'),payment_intent:'pi_'+id,customer_details:{email:'synthetic@example.test',name:'Test'},shipping_details:{name:'Test',address:{country:'IE',city:'Dublin'}}};provider.set(id,session);idem.set(options.headers['Idempotency-Key'],session);
  }
  if(failOnce){failOnce=false;throw Error('Synthetic lost response');}
 }else{const id=path.split('/')[2];session=provider.get(id);if(path.endsWith('/expire')){if(options.method!=='POST')throw Error('Expire must POST');session.status='expired';}}
 return {ok:true,async json(){return structuredClone(session)}};
}
function structuredClone(obj){return JSON.parse(JSON.stringify(obj))}
'''
evaluate(base)
for file in ['functions/api/_commerce.js','functions/api/checkout/[[path]].js','functions/api/stripe-webhook.js']:
 s=(root/file).read_text();s=re.sub(r'^import .*?;\n','',s,flags=re.M);s=s.replace("export const onRequest=()=>reply({error:'Not found.'},404);",'');s=s.replace('export ','')
 if file.endswith('stripe-webhook.js'):s=s.replace('function onRequestPost','function webhook')
 evaluate(s)
for file in ['commerce.js','admin.js','script.js']:
 evaluate('new Function('+json.dumps((root/file).read_text())+');"syntax ok"')
for file in ['product.html','bag.html','shop.html','index.html']:
 for script in re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',(root/file).read_text(),re.S):evaluate('new Function('+json.dumps(script)+');"syntax ok"')
tests=r'''
let result='pending',passed=0;const assert=(v,m)=>{if(!v)throw Error(m);passed++},fails=fn=>{try{fn();return false}catch{return true}};
const env={DB,CHECKOUT_MODE:'test',STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic'};
const origin='https://preview.example.test';
async function request(action,body,headers={}){const text=JSON.stringify(body);return onRequest({request:{method:body?'POST':'GET',url:origin+'/api/checkout/'+action,headers:{get:k=>({'Origin':origin,'content-type':'application/json',...headers}[k]||null)},async text(){return text}},params:{path:[action.split('?')[0]]},env})}
async function sql(sql,args=[]){return DB.prepare(sql).bind(...args).all()}
const v='11111111-1111-4111-8111-111111111111',v2='22222222-2222-4222-8222-222222222222',p='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
(async()=>{
 assert(configurationChecks({...env,STRIPE_WEBHOOK_SECRET:''}).webhook_secret_format===false,'missing signing secret diagnostic');assert(configurationChecks({...env,CHECKOUT_MODE:'Test'}).checkout_mode_valid===false,'case mismatch diagnostic');assert(Object.values(configurationChecks(env)).every(v=>v===true),'valid config diagnostics');assert(!JSON.stringify(configurationChecks(env)).includes('synthetic'),'diagnostics contain no secret values');
 assert(!configuration({DB}),'disabled without keys');assert(configuration(env),'test configuration');assert(!configuration({...env,CHECKOUT_MODE:'live'}),'test key blocked in live');assert(!configuration({...env,CHECKOUT_MODE:'live',STRIPE_SECRET_KEY:'sk_live_example'}),'live approval required');
 assert(totals(3999,'').shipping_cents===500&&totals(4000,'').shipping_cents===0,'delivery boundary');assert(totals(4000,'WELCOME10').shipping_cents===500&&totals(4445,'WELCOME10').shipping_cents===0,'threshold after discount');assert(totals(1699,' welcome10 ').total_cents===2029,'10 percent rounding and normalisation');assert(totals(1699,'VIP40').total_cents===1519,'40 percent plus delivery');assert(fails(()=>totals(4000,'UNKNOWN')),'unknown code rejected');
 assert(fails(()=>basketItems([{variant_id:v,quantity:0}]))&&fails(()=>basketItems([{variant_id:v,quantity:1.2}])),'bad quantity');assert(basketItems([{variant_id:v,quantity:1},{variant_id:v,quantity:2}])[0].quantity===3,'duplicate variants consolidated');
 for(let subtotal=1;subtotal<200;subtotal++){let lines=[{name:'A',label:'S',unit_price_cents:subtotal,quantity:3},{name:'B',label:'M',unit_price_cents:17,quantity:2}];let t=totals(subtotal*3+34,'VIP40');assert(discountedUnits(lines,t.discount_cents).reduce((n,r)=>n+r.amount,0)===t.subtotal_cents-t.discount_cents,'cent allocation '+subtotal);}
 await sql('INSERT INTO products (id,name,price_cents,active) VALUES (?,?,?,1)',[p,'Synthetic Valerie',1699]);await sql('INSERT INTO variants (id,product_id,label,sku,quantity) VALUES (?,?,?,?,?)',[v,p,'S','TEST-S',2]);await sql('INSERT INTO variants (id,product_id,label,sku,quantity) VALUES (?,?,?,?,?)',[v2,p,'M','TEST-M',1]);
 let r=await request('quote',{items:[{variant_id:v,quantity:1}],code:'VIP40',total_cents:1});assert(r.status===200&&r.body.total_cents===1519,'client price ignored');
 r=await request('quote',{items:[{variant_id:v,quantity:1}],code:''},{Origin:'https://other.test'});assert(r.status===403,'cross origin rejected');
 const key='33333333-3333-4333-8333-333333333333',body={items:[{variant_id:v,quantity:2}],code:'WELCOME10',checkout_key:key};
 failOnce=true;r=await request('start',body);assert(r.status===400,'lost provider response');if((await sql('SELECT * FROM checkout_holds')).results.length!==1)throw Error('start failed: '+JSON.stringify(r));assert((await sql('SELECT * FROM checkout_holds')).results.length===1,'reservation retained on ambiguous provider failure');
 r=await request('start',body);assert(r.status===200&&provider.size===1,'retry recovers same checkout');const first=[...provider.values()][0];assert(first.amount_total===3558,'Stripe total matches 2 units discount and postage');
 r=await request('start',body);assert(r.status===200&&provider.size===1,'repeated checkout idempotent');
 r=await request('start',{...body,checkout_key:'44444444-4444-4444-8444-444444444444'});assert(r.status===400&&provider.size===1,'oversell blocked');assert((await sql('SELECT * FROM orders')).results.length===1,'failed reservation rolls back order');
 let rejected=false;try{await sql('UPDATE variants SET quantity=0 WHERE id=?',[v])}catch{rejected=true}assert(rejected,'admin cannot remove held stock');
 r=await request('cancel',{checkout_key:key});assert(r.body.status==='expired'&&(await sql('SELECT * FROM checkout_holds')).results.length===0,'verified cancellation releases holds');assert((await sql('SELECT quantity FROM variants WHERE id=?',[v])).results[0].quantity===2,'cancel preserves inventory');
 const key2='55555555-5555-4555-8555-555555555555';r=await request('start',{items:[{variant_id:v,quantity:1},{variant_id:v2,quantity:1}],code:'VIP40',checkout_key:key2});assert(r.status===200,'multi size checkout');const paid=[...provider.values()][1];paid.status='complete';paid.payment_status='paid';
 let forged={...paid,amount_total:1};let blocked=false;try{await settle(DB,env,forged)}catch{blocked=true}assert(blocked,'wrong paid amount rejected');blocked=false;try{await settle(DB,env,{...paid,livemode:true})}catch{blocked=true}assert(blocked,'live payment rejected for test order');
 await settle(DB,env,paid);let quantities=(await sql('SELECT label,quantity FROM variants ORDER BY label')).results;assert(quantities[0].quantity===0&&quantities[1].quantity===1,'stock committed once');assert((await sql('SELECT * FROM order_items')).results.length===2,'order items saved');assert((await sql('SELECT * FROM checkout_holds')).results.length===0,'paid holds removed');
 await settle(DB,env,paid);assert((await sql('SELECT quantity FROM variants WHERE id=?',[v])).results[0].quantity===1,'duplicate payment callback does not double decrement');
 const timestamp=Math.floor(Date.now()/1000),raw=JSON.stringify({type:'checkout.session.completed',livemode:false,data:{object:{id:paid.id}}}),signature=py({action:'sign',secret:env.STRIPE_WEBHOOK_SECRET,text:timestamp+'.'+raw});
 assert((await signedEvent(raw,'t='+timestamp+',v1='+signature,env.STRIPE_WEBHOOK_SECRET)).type==='checkout.session.completed','valid signed webhook');assert(await signedEvent(raw+' ','t='+timestamp+',v1='+signature,env.STRIPE_WEBHOOK_SECRET)===null,'changed raw body rejected');assert(await signedEvent(raw,'t='+(timestamp-600)+',v1='+signature,env.STRIPE_WEBHOOK_SECRET)===null,'stale webhook rejected');assert(await signedEvent(raw,'t='+timestamp+',v1='+signature,'wrong')===null,'wrong secret rejected');
 let eventResponse=await webhook({request:{headers:{get:k=>k==='Stripe-Signature'?'t='+timestamp+',v1='+signature:null},async text(){return raw}},env});assert(eventResponse.status===200,'signed webhook route');assert((await sql('SELECT quantity FROM variants WHERE id=?',[v])).results[0].quantity===1,'webhook redelivery safe');

 await sql('UPDATE variants SET quantity=3 WHERE id=?',[v]);
 const one=await request('start',{items:[{variant_id:v,quantity:1}],code:'',checkout_key:'66666666-6666-4666-8666-666666666666'}),two=await request('start',{items:[{variant_id:v,quantity:1}],code:'',checkout_key:'77777777-7777-4777-8777-777777777777'});
 assert(one.status===200&&two.status===200,'two concurrent stock holds');
 const firstPaid=provider.get(one.body.session_id),secondPaid=provider.get(two.body.session_id);firstPaid.status='complete';firstPaid.payment_status='paid';await settle(DB,env,firstPaid);
 assert((await sql('SELECT quantity FROM variants WHERE id=?',[v])).results[0].quantity===2&&(await sql('SELECT * FROM checkout_holds')).results.length===1,'paying one checkout preserves another hold');
 secondPaid.status='expired';await settle(DB,env,secondPaid);assert((await sql('SELECT quantity FROM variants WHERE id=?',[v])).results[0].quantity===2&&(await sql('SELECT * FROM checkout_holds')).results.length===0,'abandoned checkout restores availability without restocking sold units');
 let rolledBack=false;try{await DB.batch([DB.prepare("INSERT INTO orders(id,status,total_cents) VALUES (?,'pending',100)").bind('rollback-order'),DB.prepare('INSERT INTO checkout_holds(order_id,variant_id,quantity,unit_price_cents) VALUES (?,?,?,?)').bind('rollback-order',v,3,1699)])}catch{rolledBack=true}
 assert(rolledBack&&!(await DB.prepare('SELECT * FROM orders WHERE id=?').bind('rollback-order').first()),'reservation trigger rolls back the entire order transaction');

 providerError={code:'parameter_invalid_integer',param:'expires_at',message:'Do not return this raw message: sk_test_example'};
 const rejectedKey='88888888-8888-4888-8888-888888888888';const refused=await request('start',{items:[{variant_id:v,quantity:1}],code:'WELCOME10',checkout_key:rejectedKey});
 assert(refused.status===400&&refused.body.restart_checkout===true,'definitive rejection tells browser to discard failed checkout');
 assert(refused.body.error.includes('expires_at')&&!JSON.stringify(refused).includes('sk_test_example'),'safe Stripe parameter error contains no raw message or key');
 assert((await sql('SELECT * FROM checkout_holds')).results.length===0,'definitive rejection releases reservation');
 const restarted=await request('start',{items:[{variant_id:v,quantity:1}],code:'WELCOME10',checkout_key:'99999999-9999-4999-8999-999999999999'});
 assert(restarted.status===200,'new checkout succeeds after rejection');
 result=JSON.stringify({passed,failed:0});
})().catch(error=>result='FAIL: '+error.message+' | '+error.stack);
'''
evaluate(tests);result=evaluate('result');print(result)
if result.startswith('FAIL')or result=='pending':raise SystemExit(1)

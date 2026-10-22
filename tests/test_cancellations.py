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
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.commit()
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
  else{const a=new URLSearchParams(options.body);
   if(a.get('payment_method_types[0]'))return {ok:false,status:400,async json(){return {error:{param:'payment_method_types',type:'invalid_request_error'}}}};
   if(a.get('allowed_payment_method_types[0]')!=='card')throw Error('Checkout must filter to immediate card payments');
   if(options.headers['Stripe-Version']!=='2026-09-30.endive')throw Error('Stripe API version must be pinned');
   const id='cs_test_'+String(provider.size+1);let total=Number(a.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'));
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

for file in ['cancel.js','admin.js']:
 evaluate('new Function('+json.dumps((root/file).read_text())+');"syntax ok"')
evaluate("const database=env=>env.DB; crypto.subtle.digest=async()=>new Uint8Array([1,2,3]).buffer;")
for file in ['functions/api/_cancellation.js','functions/api/cancellations.js']:
 source=(root/file).read_text()
 source=re.sub(r'^import .*?;\n','',source,flags=re.M).replace("export const onRequest=()=>cancellationReply({error:'Not found.'},404);",'').replace('export ','')
 evaluate(source)
evaluate('const reply=cancellationReply;')
tests=r'''

let outcome='pending',passed=0;const assert=(v,m)=>{if(!v)throw Error(m);passed++};
let calls=[],mailFails=false;
fetch=async(url,options)=>{assert(url==='https://api.resend.com/emails','mail goes only to provider');calls.push(JSON.parse(options.body));return {ok:!mailFails,async json(){return {id:'synthetic-email'}}};};
const env={DB,RESEND_API_KEY:'synthetic-secret',CANCELLATION_FROM:'MaeLinne <test@example.test>'};
const origin='https://www.maelinne.ie';
const first={id:'11111111-1111-4111-8111-111111111111',name:'Test Customer',email:'test@example.test',order_reference:'ORDER-123',items:'Top size S'};
async function request(body,overrides={},configuration=env){const raw=JSON.stringify(body);return onRequest({env:configuration,request:{method:body?'POST':'GET',url:origin+'/api/cancellations',headers:{get:key=>({Origin:origin,'Content-Type':'application/json',...overrides}[key]||null)},async text(){return raw}}});}
(async()=>{
 let r=await request();assert(r.body.enabled,'configured form available');
 r=await request(undefined,{},{});assert(!r.body.enabled,'unconfigured form unavailable');
 r=await request(first,{Origin:'https://evil.test'});assert(r.status===403,'cross origin rejected');
 r=await request(first,{'Content-Type':'text/plain'});assert(r.status===403,'content type enforced');
 r=await request(first,{'Content-Length':'9000'});assert(r.status===413,'oversize rejected');
 r=await request({...first,email:'bad'});assert(r.status===400,'invalid email rejected');
 r=await request({...first,name:'Test\r\nInjected'});assert(r.status===400,'control chars rejected');
 r=await request(first,{}, {DB});assert(r.status===503&&calls.length===0,'missing email configuration does not claim receipt');
 r=await request(first);assert(r.status===200&&r.body.received&&r.body.email_sent,'notice and acknowledgement accepted');
 const originalTime=r.body.received_at;
 assert(r.body.receipt.includes('I give notice')&&r.body.receipt.includes(originalTime)&&r.body.receipt.includes('Top size S'),'receipt has statement and original timestamp');
 assert(calls.length===2&&calls[0].to[0]===first.email&&calls[1].to[0]==='maelinnestore@gmail.com','customer and merchant notified separately');
 assert(calls[0].reply_to==='maelinnestore@gmail.com','reply goes to merchant');
 r=await request(first);assert(r.status===200&&r.body.received_at===originalTime&&calls.length===2,'retry preserves timestamp and does not resend sent mail');
 r=await request({...first,items:'Different'});assert(r.status===409,'same reference cannot be overwritten');
 const second={...first,id:'22222222-2222-4222-8222-222222222222',items:''};mailFails=true;
 r=await request(second);assert(r.status===202&&r.body.received&&!r.body.email_sent&&r.body.receipt.includes('Entire order'),'mail failure preserves notice and gives receipt');
 const saved=await DB.prepare('SELECT * FROM cancellation_notices WHERE id=?').bind(second.id).first();assert(saved.items==='Entire order'&&saved.customer_email_sent===0,'notice persisted before email');
 mailFails=false;r=await request(second);assert(r.status===200&&r.body.email_sent&&r.body.received_at===saved.received_at,'email retry retains original notice');
 assert(cancellationData({...first,items:'Top\nsize S'}).items==='Top size S','multiline descriptions normalised');
 // A request cannot read arbitrary notices: GET provides only readiness.
 r=await request();assert(Object.keys(r.body).join(',')==='enabled','no saved personal information on GET');
 for(let i=3;i<=7;i++){
  const id=String(i).repeat(8)+'-'+String(i).repeat(4)+'-4'+String(i).repeat(3)+'-8'+String(i).repeat(3)+'-'+String(i).repeat(12);
  r=await request({...first,id},{'CF-Connecting-IP':'192.0.2.1'});assert(r.status===200,'within submission limit '+i);
 }
 r=await request({...first,id:'88888888-8888-4888-8888-888888888888'},{'CF-Connecting-IP':'192.0.2.1'});assert(r.status===429,'abuse limit enforced');
 const count=await DB.prepare('SELECT COUNT(*) AS n FROM cancellation_notices').first();assert(count.n===7,'retries and failed validation never duplicate notices');
 const noStore=await request(first);assert(noStore.status===200,'existing notice can still be acknowledged');
 outcome=JSON.stringify({passed,failed:0});
})().catch(e=>outcome='FAIL: '+e.message+' | '+e.stack);

'''
evaluate(tests);result=evaluate('outcome');print(result)
if result.startswith('FAIL') or result=='pending':raise SystemExit(1)

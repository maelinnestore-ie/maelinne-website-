"""Exercise actual bag JS with a minimal DOM; not a browser layout test."""
import runpy,json
from pathlib import Path
h=runpy.run_path(str(Path(__file__).with_name('test_checkout.py')))
evaluate=h['evaluate']; source=(Path(__file__).resolve().parents[1]/'commerce.js').read_text()
setup=r'''
var uiResult='pending';
(async()=>{
let passed=0;function check(value,message){if(!value)throw Error(message);passed++}
class El{constructor(){this.children=[];this.dataset={};this.classList={toggle(){}};this.value='';}append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}setAttribute(){}querySelector(selector){return this.children.find(c=>c.className===selector.slice(1))||null}}
const desktop=new El(),mobile=new El(),ids={};const get=id=>ids[id]||(ids[id]=new El());
const document={createElement:()=>new El(),getElementById:id=>id==='purchase-controls'?null:get(id),querySelectorAll:selector=>selector==='.desktop-nav,.mobile-nav'?[desktop,mobile]:selector==='[data-bag-count]'?[...desktop.children,...mobile.children].map(a=>a.children[1]):[]};
const rows=[{variant_id:'v',quantity:1}],snapshot=JSON.stringify({items:rows,code:'VIP40'});let pending=JSON.stringify({key:'key',snapshot,session_id:'cs_test'});
const localStorage={getItem:()=>JSON.stringify(rows),setItem:(key,value)=>rows.splice(0,rows.length,...JSON.parse(value))},sessionStorage={getItem:()=>pending,removeItem:()=>{pending=null}};
const location={search:'?cancelled=1'},window={addEventListener(){}};
class URLSearchParams{get(){return null}has(k){return k==='cancelled'}}
const calls=[];async function fetch(url,options){calls.push(url);let data;if(url.endsWith('/config'))data={enabled:true,test_mode:true};else if(url.endsWith('/cancel'))data={status:'expired'};else if(url==='/api/products')data={products:[{id:'p',name:'Top',price_cents:2499,variants:[{id:'v',label:'S',quantity:10}]}]};else if(url.endsWith('/quote')){check(JSON.parse(options.body).code==='VIP40','promo restored on cancellation');data={subtotal_cents:2499,discount_cents:1000,shipping_cents:500,total_cents:1999,promo_code:'VIP40',percent:40}}else throw Error(url);return {ok:true,async json(){return data}}}
'''
finish=r'''
for(let i=0;i<20;i++)await Promise.resolve();
check(desktop.children.length===1&&mobile.children.length===1,'bag link in both menus');
check(mobile.children[0].children[1].textContent===' (1)','mobile bag count');
check(calls.indexOf('/api/checkout/cancel')<calls.indexOf('/api/products'),'stock fetched after releasing checkout');
check(pending===null,'expired checkout key removed');
check(get('bag-total').textContent==='€19.99','discount and delivery rendered');
check(get('bag-message').textContent.includes('Checkout cancelled.')&&get('bag-message').textContent.includes('VIP40 is still applied.'),'cancellation confirmation preserves promo');
check(get('bag-checkout').disabled===false,'checkout available after cancellation');
get('bag-items').children[0].children[2].children[0].children[1].value='0';get('bag-items').children[0].children[2].children[0].children[1].onchange();
check(get('bag-message').textContent==='Choose a quantity from 1 to 10.','invalid quantity rejected');
const stepper=get('bag-items').children[0].children[2].children[0];stepper.children[2].onclick();for(let i=0;i<10;i++)await Promise.resolve();check(rows[0].quantity===2&&stepper.children[1].value==='2','plus increases displayed quantity');stepper.children[0].onclick();check(rows[0].quantity===1&&stepper.children[1].value==='1','minus decreases quantity');
uiResult=JSON.stringify({ui_passed:passed,failed:0});
})().catch(e=>uiResult=String(e.stack||e));
'''
evaluate(setup+source+finish)
result=evaluate('uiResult');print(result)
if '"failed":0' not in result:raise SystemExit(1)

"""Actual product purchase JS with a minimal DOM and simulated availability."""
import runpy,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
h=runpy.run_path(str(Path(__file__).with_name('test_checkout.py')));evaluate=h['evaluate']
setup=r'''
var productResult='pending';
(async()=>{
let passed=0;const check=(v,m)=>{if(!v)throw Error(m);passed++};
class El{constructor(){this.children=[];this.dataset={};this.classList={toggle(){}};this.value='';}append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}setAttribute(){}querySelector(){return null}}
const holder=new El(),document={createElement:()=>new El(),getElementById:id=>id==='purchase-controls'?holder:null,querySelectorAll:()=>[]};
let bag=[];const localStorage={getItem:()=>JSON.stringify(bag),setItem:(key,value)=>{bag=JSON.parse(value)}};
const window={addEventListener(){}},location={search:'?id=p'};class URLSearchParams{get(){return 'p'}}
let quotes=0;async function fetch(url,options){if(url==='/api/products')return {ok:true,async json(){return {products:[{id:'p',variants:[{id:'v',label:'S'}]}]}}};quotes++;const items=JSON.parse(options.body).items,okay=items[0].quantity<=2;return {ok:okay,async json(){return okay?{}:{error:'Please choose fewer items.'}}}}
'''
finish=r'''
for(let i=0;i<10;i++)await Promise.resolve();
const form=holder.children[0],size=form.children[0].children[0],qty=form.children[1].children[0],button=form.children[2],message=form.children[3];
check(size.children[1].textContent==='S','size has no inventory count');check(qty.children.length===10&&qty.value==='1','quantity selector defaults to one');
size.value='v';qty.value='2';const pending=form.onsubmit({preventDefault(){}});check(button.disabled,'double submit blocked while checking');await pending;
check(bag[0].quantity===2,'selected quantity saved');check(message.children[0].textContent==='2 items added to your bag. ','quantity confirmation');
qty.value='1';await form.onsubmit({preventDefault(){}});check(bag[0].quantity===2&&message.textContent==='Please choose fewer items.','stock rejection preserves existing bag');check(!button.disabled,'button restored after rejection');
qty.value='10';await form.onsubmit({preventDefault(){}});check(bag[0].quantity===2&&quotes===2,'per size cap before server request');
size.value='';await form.onsubmit({preventDefault(){}});check(message.textContent==='Choose a size.','size required');
productResult=JSON.stringify({product_ui_passed:passed,failed:0});
})().catch(e=>productResult=String(e.stack||e));
'''
evaluate(setup+(root/'commerce.js').read_text()+finish)
r=evaluate('productResult');print(r)
if '"failed":0' not in r:raise SystemExit(1)
s=(root/'functions/api/products.js').read_text().replace('export async function onRequestGet','async function publicCatalogue')
evaluate(s)
evaluate("var catalogueResult='pending'; publicCatalogue({env:{DB}}).then(r=>{if(r.status===503)throw Error('Catalogue failed');if(r.body.products.some(p=>p.variants.some(v=>'quantity' in v)))throw Error('Inventory exposed');catalogueResult='public catalogue hides stock';}).catch(e=>catalogueResult=String(e));")
r=evaluate('catalogueResult');print(r)
if r!='public catalogue hides stock':raise SystemExit(1)

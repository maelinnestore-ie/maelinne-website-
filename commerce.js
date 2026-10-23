(() => {
 const storageKey='maelinne-bag-v1',money=n=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(n/100);
 const element=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
 function read(){try{const data=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(data)?data.filter(r=>r&&typeof r.variant_id==='string'&&Number.isInteger(r.quantity)&&r.quantity>0&&r.quantity<=10).slice(0,20):[];}catch{return [];}}
 function write(items){try{localStorage.setItem(storageKey,JSON.stringify(items));}catch{throw Error('Your browser could not save the bag. Allow site storage and try again.');}updateCounts();}

 const favouritesKey='maelinne-favourites-v1';
 function savedIds(){try{const ids=JSON.parse(localStorage.getItem(favouritesKey)||'[]');return Array.isArray(ids)?[...new Set(ids.filter(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id)))].slice(0,200):[];}catch{return [];}}
 function icon(kind){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',kind==='bag'?'M6 7h12l1 14H5L6 7ZM9 8V6a3 3 0 0 1 6 0v2':'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z');
  svg.append(path);return svg;
 }
 function headerLink(kind,href,title){
  const link=element('a');link.href=href;link.className='header-icon '+kind+'-link';link.title=title;link.setAttribute('aria-label',title);link.append(icon(kind));
  const count=element('span');count.className='header-count';count.hidden=true;
  if(kind==='bag')count.dataset.bagCount='';else count.dataset.favouritesCount='';
  count.setAttribute('aria-hidden','true');link.append(count);return link;
 }
 document.querySelectorAll('.site-header').forEach(header=>{
  header.querySelectorAll('.bag-link').forEach(link=>link.remove());
  let actions=header.querySelector('.header-actions');
  if(!actions){actions=element('div');actions.className='header-actions';header.append(actions);}
  const icons=element('div');icons.className='shopping-icons';icons.append(headerLink('bag','/bag.html','Shopping bag'),headerLink('favourites','/shop.html?favourites=1','Favourites'));actions.prepend(icons);
 });
 function updateCounts(){
  const count=read().reduce((n,row)=>n+row.quantity,0),favourites=savedIds().length;
  document.querySelectorAll('[data-bag-count]').forEach(el=>{el.textContent=String(count);el.hidden=!count;el.closest('a')?.setAttribute('aria-label','Shopping bag, '+count+' '+(count===1?'item':'items'));});
  document.querySelectorAll('[data-favourites-count]').forEach(el=>{el.textContent=String(favourites);el.hidden=!favourites;el.closest('a')?.setAttribute('aria-label','Favourites, '+favourites+' saved '+(favourites===1?'item':'items'));});
 }
 let favouritesMessage;
 function refreshHearts(){
  const ids=new Set(savedIds());
  document.querySelectorAll('[data-favourite-product]').forEach(button=>{
   const selected=ids.has(button.dataset.favouriteProduct);
   button.setAttribute('aria-pressed',String(selected));
   button.setAttribute('aria-label',(selected?'Remove ':'Save ')+button.dataset.productName+(selected?' from favourites':' to favourites'));
   button.title=selected?'Remove from favourites':'Save to favourites';
  });
  updateCounts();
 }
 function favouriteButton(id,name,inline=false){
  const button=element('button');button.type='button';button.className='favourite-toggle'+(inline?' product-favourite':'');button.dataset.favouriteProduct=id;button.dataset.productName=name;button.append(icon('heart'));
  if(inline)button.append(element('span','Save to favourites'));
  button.addEventListener('click',()=>{
   const ids=savedIds(),selected=ids.includes(id),next=selected?ids.filter(value=>value!==id):[...ids,id];
   try{if(next.length>200)throw Error('Limit reached');localStorage.setItem(favouritesKey,JSON.stringify(next));}
   catch{announce('Could not save this favourite. Check that browser storage is allowed.');return;}
   refreshHearts();announce(selected?'Removed from favourites.':'Saved to favourites.');document.dispatchEvent(new Event('maelinne:favourites-changed'));
  });
  return button;
 }
 function announce(text){
  if(!favouritesMessage){favouritesMessage=element('p');favouritesMessage.className='favourites-message';favouritesMessage.setAttribute('role','status');document.body.append(favouritesMessage);}
  favouritesMessage.textContent=text;clearTimeout(announce.timer);announce.timer=setTimeout(()=>{favouritesMessage.textContent='';},3000);
 }
 function decorateFavourites(){
  document.querySelectorAll('.editorial-product-card,.real-card').forEach(card=>{
   if(card.querySelector('.favourite-toggle'))return;
   const link=card.querySelector('a[href*="/product.html?id="]'),name=card.querySelector('h2,h3')?.textContent;
   if(!link||!name)return;const id=new URL(link.href).searchParams.get('id');if(!/^[a-f0-9-]{36}$/.test(id||''))return;
   card.append(favouriteButton(id,name));
  });
  const holder=document.getElementById('purchase-controls'),name=document.getElementById('name')?.textContent,id=new URLSearchParams(location.search).get('id');
  if(holder&&name&&/^[a-f0-9-]{36}$/.test(id||'')&&!document.querySelector('.product-favourite'))holder.before(favouriteButton(id,name,true));
  refreshHearts();
 }
 document.addEventListener('maelinne:products-rendered',decorateFavourites);
 window.addEventListener('storage',event=>{if(event.key===favouritesKey||event.key===null){refreshHearts();document.dispatchEvent(new Event('maelinne:favourites-changed'));}else updateCounts();});
 decorateFavourites();
 async function api(path,body){const response=await fetch('/api/checkout/'+path,{cache:'no-store',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok){const error=Error(result.error||'Could not connect. Please retry.');error.restartCheckout=result.restart_checkout===true;throw error;}return result;}
 async function purchase(){
  const holder=document.getElementById('purchase-controls');if(!holder)return;
  try{
   const id=new URLSearchParams(location.search).get('id'),r=await fetch('/api/products',{cache:'no-store'});if(!r.ok)throw Error('Product options are temporarily unavailable.');
   const product=(await r.json()).products.find(p=>p.id===id);if(!product?.variants?.length){holder.textContent='This piece is currently sold out.';return;}
   const form=element('form');form.className='purchase-form';const label=element('label','Choose your size'),sizes=element('select');sizes.required=true;
   const placeholder=element('option','Choose a size');placeholder.value='';sizes.append(placeholder);
   product.variants.forEach(v=>{const o=element('option',v.label);o.value=v.id;sizes.append(o);});label.append(sizes);
   const add=element('button','Add to bag');add.type='submit';const message=element('p');message.setAttribute('role','status');
   form.append(label,add,message);holder.replaceChildren(form);
   form.onsubmit=async e=>{e.preventDefault();if(add.disabled)return;add.disabled=true;try{const variant=product.variants.find(v=>v.id===sizes.value);if(!variant)throw Error('Choose a size.');const amount=1;const bag=read(),row=bag.find(r=>r.variant_id===variant.id);if((row?.quantity||0)+amount>10)throw Error('Use up to 10 of a size per order.');if(bag.reduce((n,r)=>n+r.quantity,0)+amount>20)throw Error('Use up to 20 items per order.');if(row)row.quantity+=amount;else bag.push({variant_id:variant.id,quantity:amount});message.textContent='Checking availability…';await api('quote',{items:bag,code:''});write(bag);message.replaceChildren(element('span',amount===1?'Added to your bag. ':amount+' items added to your bag. '));const a=element('a','View bag →');a.href='/bag.html';message.append(a);}catch(error){message.textContent=error.message;}finally{add.disabled=false;}};
  }catch(error){holder.textContent=error.message;}
 }
 async function bagPage(){
  const list=document.getElementById('bag-items');if(!list)return;
  const summary=document.getElementById('bag-summary'),message=document.getElementById('bag-message'),checkout=document.getElementById('bag-checkout'),promo=document.getElementById('promo-code'),promoForm=document.getElementById('promo-form');
  let items=read(),code='',catalogue=[],config={enabled:false},latest=null,requestNumber=0,busy=false,attemptKey=null,attemptSnapshot=null;
  function say(text,error=false){message.textContent=text;message.classList.toggle('error',error);}
  const session=new URLSearchParams(location.search).get('session_id');
  if(session){
   document.getElementById('bag-title').textContent='Your order';document.getElementById('bag-layout').hidden=true;
   const result=document.getElementById('bag-result');result.hidden=false;result.textContent='Confirming your payment…';
   try{let state;for(let i=0;i<6;i++){state=await api('status?session_id='+encodeURIComponent(session));if(state.status!=='pending')break;await new Promise(resolve=>setTimeout(resolve,2000));}
    if(state.status==='paid'){
     try{const pending=JSON.parse(sessionStorage.getItem('maelinne-checkout')||'null');if(pending?.session_id===session){const purchased=JSON.parse(pending.snapshot).items;const remaining=read().map(row=>({...row,quantity:Math.max(0,row.quantity-(purchased.find(p=>p.variant_id===row.variant_id)?.quantity||0))})).filter(row=>row.quantity>0);write(remaining);sessionStorage.removeItem('maelinne-checkout');}}catch{}
     result.className='bag-success';result.replaceChildren(element('h2',state.test_mode?'Test order confirmed':'Thank you—your order is confirmed'),element('p','Order reference: '+state.reference),element('p',state.test_mode?'This was a test payment. No money was charged and this order will not be dispatched.':'Your payment has been confirmed. Keep your order reference for any queries.'));}
    else result.textContent=state.status==='expired'?'This checkout expired. Your bag is still saved.':'Your payment is still being confirmed. Please check back shortly; don’t pay again.';
   }catch{result.textContent='We couldn’t check your payment yet. Please refresh this page shortly; don’t pay again.';}return;
  }
  let cancellationNotice='';
  try{config=await api('config');}catch(error){say(error.message,true);}
  if(config.enabled&&new URLSearchParams(location.search).has('cancelled')){
   try{const pending=JSON.parse(sessionStorage.getItem('maelinne-checkout')||'null');if(pending){try{code=JSON.parse(pending.snapshot).code||'';promo.value=code;}catch{}const result=await api('cancel',{checkout_key:pending.key});if(result.status==='paid'){location.replace('/bag.html?session_id='+encodeURIComponent(result.session_id));return;}if(result.status==='expired'){sessionStorage.removeItem('maelinne-checkout');cancellationNotice='Checkout cancelled. Your bag is saved and your items are available again.';}}}
   catch{say('Your previous checkout may still be holding stock. Please try again shortly.',true);}
  }
  try{const r=await fetch('/api/products',{cache:'no-store'});if(!r.ok)throw Error('The collection is temporarily unavailable.');catalogue=(await r.json()).products;}catch(error){say(error.message,true);}
  document.getElementById('bag-test').hidden=!config.test_mode;
  function draw(){
   list.replaceChildren();latest=null;checkout.disabled=true;
   if(!items.length){list.append(element('p','Your bag is empty. Find your next favourite in the collection.'));summary.hidden=true;return;}
   summary.hidden=false;
   for(const item of items){const p=catalogue.find(p=>p.variants.some(v=>v.id===item.variant_id)),v=p?.variants.find(v=>v.id===item.variant_id),row=element('article');row.className='bag-item';
    const image=element('img');image.alt='';image.src=p?.images?.[0]||p?.image_url||'/assets/henley.webp';const detail=element('div');detail.append(element('h2',p?.name||'Unavailable item'),element('p',[p?.color,v?.label].filter(Boolean).join(' · ')),element('p',p?money(p.price_cents):'Please remove this item.'));
    const remove=element('button','Remove');remove.className='bag-remove';remove.type='button';remove.onclick=()=>{if(busy)return;items=items.filter(r=>r!==item);write(items);draw();refresh();};detail.append(remove);
    const label=element('label','Quantity'),qty=element('input');qty.type='text';qty.inputMode='numeric';qty.pattern='[0-9]+';qty.maxLength=2;qty.className='bag-quantity';qty.value=item.quantity;qty.setAttribute('aria-label','Quantity for '+(p?.name||'unavailable item')+' '+(v?.label||''));
    qty.onchange=()=>{if(busy)return;const value=Number(qty.value);if(!/^\d+$/.test(qty.value)||!Number.isInteger(value)||value<1||value>10){qty.value=item.quantity;say('Choose a quantity from 1 to 10.',true);return;}item.quantity=value;write(items);refresh();};const stepper=element('div');stepper.className='bag-stepper';const minus=element('button','−'),plus=element('button','+');minus.type=plus.type='button';minus.setAttribute('aria-label','Decrease quantity for '+(p?.name||'item'));plus.setAttribute('aria-label','Increase quantity for '+(p?.name||'item'));minus.onclick=()=>{if(busy)return;if(item.quantity<=1){say('Use Remove to take this item out of your bag.');return;}qty.value=String(item.quantity-1);qty.onchange();};plus.onclick=()=>{if(busy)return;qty.value=String(item.quantity+1);qty.onchange();};stepper.append(minus,qty,plus);label.append(stepper);row.append(image,detail,label);list.append(row);
   }
  }
  async function refresh(){const request=++requestNumber;latest=null;checkout.disabled=true;if(!items.length)return;
   if(!config.enabled){say('Checkout is not open yet. Your bag is saved.');return;}
   say('Updating your bag…');try{const priced=await api('quote',{items,code});if(request!==requestNumber)return;latest=priced;
    document.getElementById('bag-subtotal').textContent=money(priced.subtotal_cents);document.getElementById('bag-discount').textContent=priced.discount_cents?'-'+money(priced.discount_cents):'—';document.getElementById('bag-delivery').textContent=priced.shipping_cents?money(priced.shipping_cents):'Free';document.getElementById('bag-total').textContent=money(priced.total_cents);
    say(priced.promo_code?priced.promo_code+' applied: '+priced.percent+'% off your items.':'Your bag is up to date.');checkout.disabled=false;
   }catch(error){if(request===requestNumber){document.querySelectorAll('[data-bag-total]').forEach(el=>el.textContent='—');say(error.message,true);}}}
  promoForm.onsubmit=e=>{e.preventDefault();if(busy)return;code=promo.value.trim().toUpperCase();promo.value=code;refresh();};
  document.getElementById('remove-promo').onclick=()=>{if(busy)return;code='';promo.value='';refresh();};
  checkout.onclick=async()=>{if(busy||!latest)return;busy=true;checkout.disabled=true;const controls=[...document.querySelectorAll('#bag-layout input,#bag-layout button')];controls.forEach(el=>el.disabled=true);say('Opening secure checkout…');
   const snapshot=JSON.stringify({items,code});if(snapshot!==attemptSnapshot){
    try{const saved=JSON.parse(sessionStorage.getItem('maelinne-checkout')||'null');attemptKey=saved?.snapshot===snapshot?saved.key:crypto.randomUUID();}catch{attemptKey=crypto.randomUUID();}attemptSnapshot=snapshot;
   }
   try{sessionStorage.setItem('maelinne-checkout',JSON.stringify({key:attemptKey,snapshot}));}catch{}
   try{const result=await api('start',{items,code,checkout_key:attemptKey});if(!result.url?.startsWith('https://checkout.stripe.com/'))throw Error('Checkout could not be verified.');try{sessionStorage.setItem('maelinne-checkout',JSON.stringify({key:attemptKey,snapshot,session_id:result.session_id}));}catch{}location.assign(result.url);}
   catch(error){say(error.message,true);if(error.restartCheckout||/expired|already paid/.test(error.message)){attemptKey=null;attemptSnapshot=null;try{sessionStorage.removeItem('maelinne-checkout');}catch{}}busy=false;controls.forEach(el=>el.disabled=false);checkout.disabled=!latest;}
  };
  draw();await refresh();if(cancellationNotice&&latest)say(cancellationNotice+(latest.promo_code?' '+latest.promo_code+' is still applied.':''));
 }
 purchase();bagPage();
})();

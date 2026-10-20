const status=document.getElementById('status'),draftsEl=document.getElementById('draft-products'),publishedEl=document.getElementById('published-products'),ordersEl=document.getElementById('orders');
const photoInput=document.getElementById('photo-file'),imageUrlInput=document.getElementById('image-url'),photoPreview=document.getElementById('photo-preview');
photoInput.addEventListener('change',()=>{photoPreview.replaceChildren();for(const file of photoInput.files){const preview=node('img');preview.alt='Selected photo';preview.style.cssText='width:110px;height:140px;object-fit:contain;margin:5px;';preview.src=URL.createObjectURL(file);preview.onload=()=>URL.revokeObjectURL(preview.src);photoPreview.append(preview);}});
const euros=c=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(c/100);
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
async function api(path,options){const r=await fetch('/api/admin/'+path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options?.headers||{})}});const v=await r.json().catch(()=>({}));if(!r.ok)throw Error(v.error||'Request failed');return v;}
function notify(message){status.textContent=message;}
async function load(){
 try{
 const [p,o]=await Promise.all([api('products'),api('orders')]);draftsEl.replaceChildren();publishedEl.replaceChildren();ordersEl.replaceChildren();
 document.getElementById('product-count').textContent=`${p.products.filter(x=>!x.active).length} draft(s) · ${p.products.filter(x=>x.active).length} published`;draftsEl.append(node('h3','Saved drafts'));publishedEl.append(node('h3','Published products'));if(!p.products.some(x=>!x.active))draftsEl.append(node('p','No drafts yet.'));if(!p.products.some(x=>x.active))publishedEl.append(node('p','No published products yet.'));
 for(const product of p.products){
  const box=node('div');box.className='product';
  const heading=node('h3',product.name+' · '+euros(product.price_cents));box.append(heading,node('p',product.description||'No description'));
  const publish=node('button',product.active?'Unpublish':'Publish');publish.className='secondary';
  publish.onclick=()=>run(async()=>{await api('products/'+product.id,{method:'PATCH',body:JSON.stringify({active:!product.active})});await load();},'Product updated.');
  box.append(node('p',product.active?'Published':'Draft — not visible to shoppers'));box.append(publish);
  const edit=node('button','Edit product');edit.className='secondary';edit.type='button';box.append(edit);
  const editForm=node('form');editForm.hidden=true;editForm.style.marginTop='1rem';
  const addField=(title,element)=>{const label=node('label',title);label.append(element);editForm.append(label);return element;};
  const nameInput=addField('Name',node('input'));nameInput.value=product.name;nameInput.required=true;nameInput.maxLength=120;
  const descriptionInput=addField('Description',node('textarea'));descriptionInput.value=product.description||'';descriptionInput.maxLength=2000;
  const priceInput=addField('Price (€)',node('input'));priceInput.type='number';priceInput.step='0.01';priceInput.min='0';priceInput.required=true;priceInput.value=(product.price_cents/100).toFixed(2);
  const photos=[...(product.images||[])];const gallery=node('div');gallery.className='gallery-editor';const drawPhotos=()=>{gallery.replaceChildren();photos.forEach((url,i)=>{const tile=node('div');tile.className='photo-tile';const img=node('img');img.src=url;img.alt='Photo '+(i+1);tile.append(img);const del=node('button','Remove');del.type='button';del.className='secondary';del.onclick=()=>{photos.splice(i,1);drawPhotos();};tile.append(del);if(i){const cover=node('button','Make cover');cover.type='button';cover.onclick=()=>{photos.splice(i,1);photos.unshift(url);drawPhotos();};tile.append(cover);}gallery.append(tile);});};drawPhotos();editForm.append(gallery);
  const newImage=addField('Add photos (up to 12 total)',node('input'));newImage.type='file';newImage.multiple=true;newImage.accept='image/jpeg,image/png,image/webp';
  const saveBtn=node('button','Save changes');saveBtn.type='submit';editForm.append(saveBtn);
  edit.onclick=()=>{editForm.hidden=!editForm.hidden;edit.textContent=editForm.hidden?'Edit product':'Close editor';};
  editForm.onsubmit=e=>{e.preventDefault();run(async()=>{if(photos.length+newImage.files.length>12)throw Error('Maximum 12 photos.');for(const file of newImage.files)photos.push(await uploadPhoto(file));await api('products/'+product.id+'/gallery',{method:'PUT',body:JSON.stringify({images:photos,color:''})});await api('products/'+product.id,{method:'PATCH',body:JSON.stringify({name:nameInput.value,description:descriptionInput.value,price_cents:Math.round(Number(priceInput.value)*100),image_url:photos[0]||''})});await load();},'Changes saved.');};
  box.append(editForm);const galleryLink=node('a','Preview photos & zoom ↗');galleryLink.href='/product.html?id='+encodeURIComponent(product.id);galleryLink.target='_blank';galleryLink.rel='noopener';if(product.active)box.append(galleryLink);
  const list=node('div');for(const v of product.variants){
   const row=node('div');row.className='variant';row.append(node('span',v.label+' · SKU '+v.sku));
   const form=node('form');const label=node('label','In stock');const qty=node('input');qty.type='number';qty.min=0;qty.step=1;qty.value=v.quantity;label.append(qty);const button=node('button','Update');form.append(label,button);
   form.onsubmit=e=>{e.preventDefault();run(async()=>{await api('variants/'+v.id,{method:'PATCH',body:JSON.stringify({quantity:Number(qty.value)})});await load();},'Stock saved.');};
   row.append(form);list.append(row);
  }
  box.append(list);
  const form=node('form');const label=node('label','Size');const size=node('input');size.placeholder='e.g. S, M or L';size.required=true;const colourLabel=node('label','Colour');const colour=node('input');colour.placeholder='e.g. Black, Cream, Burgundy';colour.required=true;colour.maxLength=40;const skuLabel=node('label','SKU');const sku=node('input');sku.placeholder='e.g. ML-TOP-001-S';sku.required=true;const stockLabel=node('label','Initial stock');const qty=node('input');qty.type='number';qty.min=0;qty.step=1;qty.value=0;qty.required=true;
  label.append(size);colourLabel.append(colour);skuLabel.append(sku);stockLabel.append(qty);form.append(label,colourLabel,skuLabel,stockLabel,node('button','Add size / colour'));
  form.onsubmit=e=>{e.preventDefault();run(async()=>{await api('variants',{method:'POST',body:JSON.stringify({product_id:product.id,label:size.value.trim()+' / '+colour.value.trim(),sku:sku.value,quantity:Number(qty.value)})});await load();},'Size and colour added.');};
  box.append(form);(product.active?publishedEl:draftsEl).append(box);
 }
 if(!o.orders.length)ordersEl.append(node('p','No orders yet.'));
 for(const order of o.orders){const el=node('div');el.className='order';el.append(node('strong',order.id+' — '+order.status),node('p',order.customer_email+' · '+euros(order.total_cents)+' · '+order.created_at));ordersEl.append(el);}
 notify('Dashboard connected. Changes to products and stock are saved to your D1 database.');
 }catch(e){notify('Dashboard unavailable: '+e.message+'. Check Cloudflare Access and D1 setup.');}
}
async function uploadPhoto(file){const fd=new FormData();fd.append('photo',file);const r=await fetch('/api/admin/images',{method:'POST',credentials:'same-origin',body:fd});const v=await r.json().catch(()=>({}));if(!r.ok)throw Error(v.error||'Photo upload failed');return v.url;}
async function run(fn,success){try{await fn();notify(success);}catch(e){notify('Could not save: '+e.message);}}
document.getElementById('product-form').onsubmit=e=>{e.preventDefault();const form=e.currentTarget,v=new FormData(form);run(async()=>{if(photoInput.files.length>12)throw Error('Maximum 12 photos.');const images=[];for(const photo of photoInput.files){notify('Uploading photo '+(images.length+1)+' of '+photoInput.files.length+'…');images.push(await uploadPhoto(photo));}const saved=await api('products',{method:'POST',body:JSON.stringify({name:v.get('name'),description:v.get('description'),image_url:images[0]||'',price_cents:Math.round(Number(v.get('price'))*100),active:false})});await api('products/'+saved.id+'/gallery',{method:'PUT',body:JSON.stringify({images,color:''})});form.reset();photoPreview.replaceChildren();await load();},'Draft saved.');};
load();

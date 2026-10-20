const status=document.getElementById('status'),draftsEl=document.getElementById('draft-products'),publishedEl=document.getElementById('published-products'),ordersEl=document.getElementById('orders');
const photoInput=document.getElementById('photo-file'),imageUrlInput=document.getElementById('image-url'),photoPreview=document.getElementById('photo-preview');
photoInput.addEventListener('change',()=>{imageUrlInput.value='';photoPreview.replaceChildren();const file=photoInput.files[0];if(file){const preview=node('img');preview.alt='Selected product photo';preview.style.cssText='max-width:200px;max-height:230px;object-fit:contain;border-radius:8px;';preview.src=URL.createObjectURL(file);preview.onload=()=>URL.revokeObjectURL(preview.src);photoPreview.append(preview);}});
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
  const currentImage=product.image_url||'';if(currentImage){const img=node('img');img.src=currentImage;img.alt=product.name;img.style.cssText='max-width:180px;max-height:230px;object-fit:contain;';editForm.append(img);}
  const newImage=addField('Replace photo (optional)',node('input'));newImage.type='file';newImage.accept='image/jpeg,image/png,image/webp';
  const saveBtn=node('button','Save changes');saveBtn.type='submit';editForm.append(saveBtn);
  edit.onclick=()=>{editForm.hidden=!editForm.hidden;edit.textContent=editForm.hidden?'Edit product':'Close editor';};
  editForm.onsubmit=e=>{e.preventDefault();run(async()=>{let image_url=product.image_url||'';if(newImage.files[0]){const fd=new FormData();fd.append('photo',newImage.files[0]);const r=await fetch('/api/admin/images',{method:'POST',credentials:'same-origin',body:fd});const result=await r.json().catch(()=>({}));if(!r.ok)throw Error(result.error||'Photo upload failed');image_url=result.url;}await api('products/'+product.id,{method:'PATCH',body:JSON.stringify({name:nameInput.value,description:descriptionInput.value,price_cents:Math.round(Number(priceInput.value)*100),image_url})});await load();},'Changes saved.');};
  box.append(editForm);
  const list=node('div');for(const v of product.variants){
   const row=node('div');row.className='variant';row.append(node('span',v.label+' · SKU '+v.sku));
   const form=node('form');const label=node('label','In stock');const qty=node('input');qty.type='number';qty.min=0;qty.step=1;qty.value=v.quantity;label.append(qty);const button=node('button','Update');form.append(label,button);
   form.onsubmit=e=>{e.preventDefault();run(async()=>{await api('variants/'+v.id,{method:'PATCH',body:JSON.stringify({quantity:Number(qty.value)})});await load();},'Stock saved.');};
   row.append(form);list.append(row);
  }
  box.append(list);
  const form=node('form');const label=node('label','Add size / colour');const size=node('input');size.placeholder='e.g. S / Burgundy';size.required=true;const skuLabel=node('label','SKU');const sku=node('input');sku.placeholder='e.g. ML-TOP-001-S';sku.required=true;const stockLabel=node('label','Initial stock');const qty=node('input');qty.type='number';qty.min=0;qty.step=1;qty.value=0;qty.required=true;
  label.append(size);skuLabel.append(sku);stockLabel.append(qty);form.append(label,skuLabel,stockLabel,node('button','Add variant'));
  form.onsubmit=e=>{e.preventDefault();run(async()=>{await api('variants',{method:'POST',body:JSON.stringify({product_id:product.id,label:size.value,sku:sku.value,quantity:Number(qty.value)})});await load();},'Size added.');};
  box.append(form);(product.active?publishedEl:draftsEl).append(box);
 }
 if(!o.orders.length)ordersEl.append(node('p','No orders yet.'));
 for(const order of o.orders){const el=node('div');el.className='order';el.append(node('strong',order.id+' — '+order.status),node('p',order.customer_email+' · '+euros(order.total_cents)+' · '+order.created_at));ordersEl.append(el);}
 notify('Dashboard connected. Changes to products and stock are saved to your D1 database.');
 }catch(e){notify('Dashboard unavailable: '+e.message+'. Check Cloudflare Access and D1 setup.');}
}
async function run(fn,success){try{await fn();notify(success);}catch(e){notify('Could not save: '+e.message);}}
document.getElementById('product-form').onsubmit=e=>{e.preventDefault();const form=e.currentTarget,v=new FormData(form);run(async()=>{let imageUrl='';const photo=photoInput.files[0];if(photo){notify('Uploading photo…');const body=new FormData();body.append('photo',photo);const uploaded=await fetch('/api/admin/images',{method:'POST',credentials:'same-origin',body});const result=await uploaded.json().catch(()=>({}));if(!uploaded.ok)throw Error(result.error||'Photo upload failed');imageUrl=result.url;imageUrlInput.value=imageUrl;}await api('products',{method:'POST',body:JSON.stringify({name:v.get('name'),description:v.get('description'),image_url:imageUrl,price_cents:Math.round(Number(v.get('price'))*100),active:false})});form.reset();photoPreview.replaceChildren();await load();},'Draft saved.');};
load();

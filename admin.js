const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
const status = document.getElementById('status');
const draftsEl = document.getElementById('draft-products');
const publishedEl = document.getElementById('published-products');
const ordersEl = document.getElementById('orders');
const createForm = document.getElementById('product-form');
const search = document.getElementById('product-search');
const categoryFilter = document.getElementById('category-filter');
const statusFilter = document.getElementById('status-filter');
const categories = ['Tops','Knitwear','Bottoms','Dresses & Skirts','Sets','Outerwear','Sleepwear','Accessories','Other'];
const euros = cents => new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(cents/100);
function priceInCents(value) {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw Error('Enter the price as 16.99 or 16,99, with no more than two decimal places.');
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2,'0'));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 10000000) throw Error('Enter a price between €0.00 and €100,000.00.');
  return cents;
}

let allProducts = [], busy = false;
const hasUnsavedChanges = () => !!document.querySelector('form[data-dirty="true"]');
function markDirty(element) { const form = element.closest("form"); if (form) { form.dataset.dirty = "true"; element.dataset.dirty = "true"; } }
const uploaded = new WeakMap();
function notify(message) { status.textContent = message; }
async function api(path, options = {}) {
  const response = await fetch('/api/admin/' + path, {credentials:'same-origin', cache:'no-store', ...options, headers:{'content-type':'application/json', ...options.headers}});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(response.status === 403 ? 'Dashboard access could not be verified. Sign in again in another tab, then retry. Your entries are still here.' : data.error || 'Request failed. Please try again.');
  return data;
}
function field(parent, title, element = node('input')) {
  const label = node('label', title); label.append(element); parent.append(label); return element;
}
function button(text, action, secondary = true) {
  const el = node('button', text); el.type = 'button'; if (secondary) el.className = 'secondary'; el.onclick = action; return el;
}
function feedback(parent) { const el = node('p'); el.className = 'form-message'; el.setAttribute('role','status'); el.tabIndex = -1; parent.append(el); return el; }
async function save(form, message, action, success) {
  if (busy) return;
  busy = true;
  const controls = [...form.querySelectorAll('button,input,select,textarea')];
  const wasDisabled = controls.map(el => el.disabled);
  controls.forEach(el => el.disabled = true);
  message.textContent = 'Saving…'; message.classList.remove('error');
  try {
    await action();
    message.textContent = success; notify(success); form.dataset.dirty = 'false';
    try { await loadProducts(); } catch { notify(success + ' Refresh the product list when your connection returns.'); }
  } catch (error) {
    message.textContent = error.message; message.classList.add('error'); notify('Could not save: ' + error.message); message.focus();
  } finally { controls.forEach((el,i) => el.disabled = wasDisabled[i]); busy = false; }
}
async function uploadPhoto(file) {
  if (uploaded.has(file)) return uploaded.get(file);
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || !file.size || file.size > 5*1024*1024) throw Error('Choose JPG, PNG or WebP photos smaller than 5 MB.');
  const data = new FormData(); data.append('photo',file);
  const response = await fetch('/api/admin/images',{method:'POST',credentials:'same-origin',body:data});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(response.status === 403 ? 'Dashboard access could not be verified. Sign in again, then retry; your entries are still here.' : result.error || 'Photo upload failed.');
  uploaded.set(file,result.url); return result.url;
}
function stockQuantity(value) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > 100000) throw Error('Enter a whole-number stock quantity from 0 to 100000 for each size.');
  return Number(text);
}
function confirmStock(expected, saved) {
  if (!Array.isArray(saved) || expected.some(row => !saved.some(item => (row.id ? item.id === row.id : item.label === row.label) && item.quantity === row.quantity))) throw Error('The saved stock could not be confirmed. Your entries are still here; please retry.');
}
function sizeEditor(parent, initial = []) {
  const section = node('div'); section.className = 'size-editor'; parent.append(section);
  section.append(node('h4','Sizes & stock'), node('p','Add the sizes you have, then enter the quantity for each. Leave SKU blank to generate it automatically.'));
  const quick = node('div'); quick.className = 'size-shortcuts'; section.append(quick);
  const tableWrap = node('div'); tableWrap.className = 'size-table-wrap';
  const table = node('table'); table.className = 'size-table';
  const head = node('thead'), header = node('tr');
  for (const title of ['Size','In stock','SKU (optional)','']) { const th = node('th', title); th.scope = 'col'; if (title.startsWith('SKU')) th.className = 'sku-column'; header.append(th); }
  head.append(header); const body = node('tbody'); table.append(head,body); tableWrap.append(table); section.append(tableWrap);
  const rows = [];
  function addRow(value = {}) {
    const row = node('tr'); const size = node('input'); size.value = value.label || ''; size.maxLength = 80; size.required = true; size.setAttribute('aria-label','Size'); size.placeholder = 'e.g. S or 10';
    const qty = node('input'); qty.type = 'text'; qty.inputMode = 'numeric'; qty.pattern = '[0-9]+'; qty.maxLength = 6; qty.autocomplete = 'off'; qty.title = 'Whole-number stock from 0 to 100000'; qty.required = true; qty.value = value.quantity ?? 0; qty.setAttribute('aria-label','In stock');
    const sku = node('input'); sku.value = value.sku || ''; sku.maxLength = 80; sku.placeholder = 'Automatic'; sku.setAttribute('aria-label','SKU (optional)');
    const entry = {id:value.id, row, size, qty, sku}; rows.push(entry);
    for (const [input, className] of [[size,''],[qty,''],[sku,'sku-column']]) { const td = node('td'); td.className = className; td.append(input); row.append(td); }
    const actions = node('td');
    if (!value.id) actions.append(button('Remove', () => { rows.splice(rows.indexOf(entry),1); row.remove(); markDirty(section); }));
    else actions.append(node('span','Use 0 if sold out'));
    row.append(actions); body.append(row); return entry;
  }
  const addSize = label => { if (!rows.some(r => r.size.value.trim().toLowerCase() === label.toLowerCase())) addRow({label}); markDirty(section); };
  for (const label of ['XS','S','M','L','XL','XXL']) quick.append(button('+ ' + label, () => addSize(label)));
  quick.append(button('+ Other size', () => addRow().size.focus()));
  const skuToggle = node('input'); skuToggle.type = 'checkbox';
  field(section,'Show SKUs (optional)',skuToggle).parentElement.className = 'inline-check';
  skuToggle.onchange = () => table.classList.toggle('show-skus',skuToggle.checked);
  initial.forEach(addRow);
  return () => rows.map(r => ({...(r.id ? {id:r.id} : {}),label:r.size.value.trim(),sku:r.sku.value.trim(),quantity:stockQuantity(r.qty.value)}));
}
function colourEditor(parent, initial = {}, removable = false) {
  const group = node('fieldset'); group.className = 'colour-editor'; group.append(node('legend','Colour, photos & sizes')); parent.append(group);
  const colour = field(group,'Colour',node('input')); colour.value = initial.color || ''; colour.maxLength = 80; colour.placeholder = 'e.g. Oatmeal';
  const photos = [...(initial.images || [])], gallery = node('div'); gallery.className = 'gallery-editor'; group.append(gallery);
  function drawPhotos() {
    gallery.replaceChildren();
    photos.forEach((url,index) => {
      const tile = node('div'); tile.className = 'photo-tile'; const image = node('img'); image.src = url; image.alt = 'Product photo ' + (index+1); tile.append(image);
      tile.append(button('Remove photo', () => { photos.splice(index,1); drawPhotos(); drawPending(); markDirty(group); }));
      if (index) tile.append(button('Make cover', () => { photos.splice(index,1); photos.unshift(url); drawPhotos(); markDirty(group); },false));
      else tile.append(node('span','Cover photo'));
      gallery.append(tile);
    });
  }
  drawPhotos();
  const files = field(group,'Add photos for this colour (up to 12)',node('input')); files.type = 'file'; files.multiple = true; files.accept = 'image/jpeg,image/png,image/webp';
  group.append(node('p','Choose several photos together, or open the picker again to add more. On a Mac, hold Command while clicking photos.'));
  const pending = [], previews = node('div'); previews.className = 'selected-photos gallery-editor'; group.append(previews);
  const photoCount = node('p'); photoCount.setAttribute('role','status'); group.append(photoCount);
  const photoError = feedback(group);
  function drawPending() {
    previews.replaceChildren();
    for (const file of pending) {
      const tile = node('div'); tile.className = 'photo-tile';
      const image = node('img'); image.alt = 'Selected photo: ' + file.name;
      const url = URL.createObjectURL(file); image.src = url; image.onload = image.onerror = () => URL.revokeObjectURL(url);
      tile.append(image, node('span',file.name), button('Remove selected photo', () => {
        pending.splice(pending.indexOf(file),1); drawPending(); markDirty(group);
      }));
      previews.append(tile);
    }
    photoCount.textContent = photos.length + pending.length + ' of 12 photos' + (pending.length ? ' · ' + pending.length + ' ready to upload when you save' : '');
  }
  files.onchange = () => {
    const selected = [...files.files];
    const added = selected.filter(file => !pending.some(p => p.name === file.name && p.size === file.size && p.lastModified === file.lastModified));
    const invalid = added.find(file => !['image/jpeg','image/png','image/webp'].includes(file.type) || !file.size || file.size > 5*1024*1024);
    let error = '';
    if (invalid) error = invalid.name + ': choose JPG, PNG or WebP photos smaller than 5 MB.';
    else if (photos.length + pending.length + added.length > 12) error = 'That selection would exceed 12 photos. Remove a photo or choose fewer files; your previous selections are still here.';
    else { pending.push(...added); if (added.length) markDirty(group); }
    photoError.textContent = error; photoError.classList.toggle('error',!!error);
    files.value = ''; // A fresh selection appends to the queue, including after cancelling the picker.
    drawPending();
  };
  drawPending();
  group.append(node('p','JPG, PNG or WebP; up to 5 MB each. Use photos of this colour.'));
  const getSizes = sizeEditor(group,initial.variants || []);
  if (removable) group.append(button('Remove this colour', () => { markDirty(group); group.remove(); }));
  return {group, getSizes, async read() {
    if (photos.length + pending.length > 12) throw Error('Use no more than 12 photos per colour.');
    const images = [...photos];
    for (const file of pending) images.push(await uploadPhoto(file));
    return {color:colour.value.trim(), images, variants:getSizes()};
  }};
}
const colourContainer = document.getElementById('new-colours');
let colourEditors = [];
function addColour(initial = {}) { if (colourEditors.filter(c => c.group.isConnected).length >= 8) return; colourEditors.push(colourEditor(colourContainer,initial,true)); }
document.getElementById('add-colour').onclick = () => addColour(); addColour();
const copyNotice = node('div'); copyNotice.className = 'copy-notice'; copyNotice.hidden = true; copyNotice.setAttribute('role','status'); createForm.prepend(copyNotice);
function duplicateItem(savedProduct) {
  if (busy) return;
  if (createForm.dataset.dirty === 'true' && !window.confirm('Replace the unsaved new product with a copy of "'+savedProduct.name+'"?')) return;
  const product = allProducts.find(item => item.id === savedProduct.id) || savedProduct;
  createForm.reset();
  for (const element of createForm.querySelectorAll('[data-dirty]')) delete element.dataset.dirty;
  const values = {name:product.name,description:product.description || '',category:categories.includes(product.category) ? product.category : 'Other',fabric:product.fabric || '',style_group:product.style_group || product.name.slice(0,80),price:(product.price_cents/100).toFixed(2)};
  for (const [key,value] of Object.entries(values)) createForm.elements.namedItem(key).value = value;
  colourContainer.replaceChildren(); colourEditors = [];
  addColour({color:product.color || '',images:[...(product.images?.length ? product.images : product.image_url ? [product.image_url] : [])],variants:product.variants.map(variant => ({label:variant.label,quantity:0,sku:''}))});
  copyNotice.textContent = 'Copy of '+product.name+(product.color ? ' — '+product.color : '')+' ready. Edit the details below, then save as a new draft. Stock starts at 0; new SKUs will be generated.';
  copyNotice.hidden = false;
  const message = document.getElementById('create-message'); message.textContent = ''; message.classList.remove('error');
  createForm.dataset.dirty = 'true';
  notify('Copy ready — save the new draft when you have finished editing.');
  createForm.scrollIntoView({block:'start'});
  createForm.elements.namedItem('name').focus({preventScroll:true});
}
createForm.onsubmit = event => {
  event.preventDefault();
  const value = new FormData(createForm);
  save(createForm,document.getElementById('create-message'),async () => {
    const colours = [];
    for (const editor of colourEditors.filter(c => c.group.isConnected)) colours.push(await editor.read());
    if (!colours.length) throw Error('Add at least one colour.');
    await api('listings',{method:'POST',body:JSON.stringify({name:value.get('name'),description:value.get('description'),price_cents:priceInCents(value.get('price')),category:value.get('category'),fabric:value.get('fabric'),style_group:value.get('style_group'),colours})});
    createForm.reset(); copyNotice.hidden = true; copyNotice.textContent = ''; colourContainer.replaceChildren(); colourEditors = []; addColour();
  },'Drafts saved with all colours, sizes and stock.');
};
async function loadProducts() { const result = await api('products'); allProducts = result.products; renderProducts(); }
function renderProducts() {
  const preserved = new Map([...document.querySelectorAll('.product')].filter(el => el.querySelector('form[data-dirty="true"]')).map(el => [el.dataset.productId,el]));
  draftsEl.replaceChildren(); publishedEl.replaceChildren();
  const q = search.value.trim().toLowerCase(), cat = categoryFilter.value, state = statusFilter.value;
  const visible = allProducts.filter(p => preserved.has(p.id) || (!cat || (p.category || 'Uncategorised') === cat) && (!state || (state === 'draft' ? !p.active : !!p.active)) && (!q || [p.name,p.color,p.style_group,p.category,p.fabric,...p.variants.map(v => v.sku)].join(' ').toLowerCase().includes(q)));
  document.getElementById('product-count').textContent = allProducts.length + ' colour listings · ' + visible.length + ' matching';
  if (!visible.length) draftsEl.append(node('p','No matching products.'));
  for (const product of visible) {
    if (preserved.has(product.id)) { (product.active ? publishedEl : draftsEl).append(preserved.get(product.id)); continue; }
    const box = node('div'); box.className = 'product'; box.dataset.productId = product.id; const details = node('details');
    const summary = node('summary'); summary.append(node('h3',product.name + (product.color ? ' — ' + product.color : '') + ' · ' + euros(product.price_cents)),node('span',(product.active?'Published':'Draft') + ' · ' + product.variants.reduce((sum,v) => sum+v.quantity,0) + ' in stock')); details.append(summary); box.append(details);
    const actions = node('div'); actions.className = 'product-actions'; details.append(actions);
    const actionMessage = feedback(details);
    actions.append(button('Duplicate item',() => duplicateItem(product)));
    actions.append(button(product.active?'Unpublish':'Publish',() => save(actions,actionMessage,() => api('products/'+product.id,{method:'PATCH',body:JSON.stringify({active:!product.active})}),'Product updated.')));
    if (!product.active) actions.append(button('Delete draft',() => { if (window.confirm('Permanently delete the draft "'+product.name+'" and its sizes? This cannot be undone.')) save(actions,actionMessage,() => api('products/'+product.id,{method:'DELETE'}),'Draft deleted.'); }));
    const form = node('form'); form.className = 'product-editor'; form.hidden = true;
    const edit = button('Edit product, sizes & stock',() => { form.hidden = !form.hidden; edit.textContent = form.hidden ? 'Edit product, sizes & stock' : 'Close editor'; }); actions.append(edit);
    const name = field(form,'Name'); name.required = true; name.maxLength = 120; name.value = product.name;
    const category = field(form,'Category',node('select')); for (const title of categories) { const option = node('option',title); category.append(option); } category.value = categories.includes(product.category) ? product.category : 'Other';
    const material = field(form,'Material'); material.maxLength = 160; material.value = product.fabric || '';
    const description = field(form,'Description',node('textarea')); description.maxLength = 2000; description.value = product.description || '';
    const style = field(form,'Style group (links other colours)'); style.maxLength = 80; style.value = product.style_group || '';
    const price = field(form,'Price (€)'); price.type = 'text'; price.inputMode = 'decimal'; price.autocomplete = 'off'; price.pattern = '[0-9]+([.,][0-9]{1,2})?'; price.title = 'Use 16.99 or 16,99'; price.maxLength = 12; price.required = true; price.value = (product.price_cents/100).toFixed(2);
    const priceTools = node('div'); priceTools.className = 'price-tools'; form.append(priceTools);
    const priceMessage = feedback(priceTools);
    priceTools.prepend(button('Save price',async () => {
      if (busy) return;
      let cents;
      try { cents = priceInCents(price.value); }
      catch (error) { priceMessage.textContent = error.message; priceMessage.classList.add('error'); priceMessage.focus(); return; }
      price.disabled = true;
      await save(priceTools,priceMessage,async () => {
        await api('products/'+product.id,{method:'PATCH',body:JSON.stringify({price_cents:cents})});
        const latest = (await api('products')).products.find(item => item.id === product.id);
        if (!latest || latest.price_cents !== cents) throw Error('The saved price could not be confirmed. Please retry.');
        price.value = (cents/100).toFixed(2); price.dataset.dirty = 'false';
        form.dataset.dirty = String(!!form.querySelector('[data-dirty="true"]'));
        summary.querySelector('h3').textContent = latest.name + (latest.color ? ' — '+latest.color : '') + ' · ' + euros(cents);
      },'Price saved: '+euros(cents));
      price.disabled = false;
    },false));

    const editor = colourEditor(form,product);
    const stockTools = node('div'); stockTools.className = 'stock-tools'; form.append(stockTools);
    const stockMessage = feedback(stockTools);
    stockTools.prepend(button('Save stock',async () => {
      if (busy) return;
      let rows;
      try {
        rows = editor.getSizes();
        if (rows.some(row => !row.id) || rows.length !== product.variants.length) throw Error('Use Save product, sizes & stock to save new sizes first.');
      } catch (error) { stockMessage.textContent = error.message; stockMessage.classList.add('error'); return; }
      const quantities = [...editor.group.querySelectorAll('[aria-label="In stock"]')];
      quantities.forEach(input => input.disabled = true);
      await save(stockTools,stockMessage,async () => {
        const result = await api('products/'+product.id+'/stock',{method:'PUT',body:JSON.stringify({variants:rows.map(({id,quantity}) => ({id,quantity}))})});
        confirmStock(rows,result.variants);
        for (const input of editor.group.querySelectorAll('[aria-label="In stock"]')) delete input.dataset.dirty;
        form.dataset.dirty = String(!!form.querySelector('[data-dirty="true"]'));
        stock.textContent = rows.map(row => row.label+': '+row.quantity).join(' · ');
        summary.querySelector('span').textContent = (product.active?'Published':'Draft')+' · '+rows.reduce((sum,row) => sum+row.quantity,0)+' in stock';
      },'Stock saved: '+rows.map(row => row.label+': '+row.quantity).join(' · '));
      quantities.forEach(input => input.disabled = false);
    },false));
    stockTools.append(node('p','Save quantities on their own. Use the button below when changing size names, photos or other product details.'));
    const submit = node('button','Save product, sizes & stock'); submit.type = 'submit'; form.append(submit); const message = feedback(form);
    form.onsubmit = event => { event.preventDefault(); save(form,message,async () => {
      const colour = await editor.read();
      const result = await api('products/'+product.id+'/listing',{method:'PUT',body:JSON.stringify({...colour,name:name.value,description:description.value,price_cents:priceInCents(price.value),category:category.value,fabric:material.value,style_group:style.value})});
      confirmStock(colour.variants,result.variants);
    },'Product, sizes and stock saved.'); };
    details.append(form);
    const stock = node('p',product.variants.length ? product.variants.map(v => v.label+': '+v.quantity).join(' · ') : 'No sizes yet — open the editor to add them.'); details.append(stock);
    if (product.active) { const link = node('a','View product ↗'); link.href = '/product.html?id='+encodeURIComponent(product.id); link.target = '_blank'; link.rel = 'noopener'; details.append(link); }
    (product.active ? publishedEl : draftsEl).append(box);
  }
}
for (const input of [search,categoryFilter,statusFilter]) input.addEventListener('input',() => renderProducts());
document.addEventListener('input',event => markDirty(event.target));
window.addEventListener('beforeunload',event => { if (hasUnsavedChanges() || busy) { event.preventDefault(); event.returnValue = ''; } });
(async () => {
  try { await loadProducts(); notify('Dashboard connected.'); } catch (error) { notify(error.message); }
  try { const {orders} = await api('orders'); ordersEl.replaceChildren(); if (!orders.length) ordersEl.append(node('p','No orders yet.')); for (const order of orders) { const el = node('div'); el.className = 'order'; el.append(node('strong',(order.test_mode?'TEST · ':'')+order.id+' — '+order.status),node('p',order.customer_email+' · '+euros(order.total_cents)+' · '+order.created_at));
      if(order.promo_code)el.append(node('p',order.promo_code+' · discount '+euros(order.discount_cents)+' · delivery '+euros(order.shipping_cents)));
      if(order.test_mode)el.append(node('p','Test order — do not dispatch.'));
      const details=node('details'),summary=node('summary','Items & delivery');details.append(summary);el.append(details);let loaded=false;
      details.ontoggle=async()=>{if(!details.open||loaded)return;loaded=true;try{const result=await api('orders/'+order.id);for(const item of result.items)details.append(node('p',item.quantity+' × '+item.name+' · '+item.label+' · SKU '+item.sku));let address={};try{address=JSON.parse(result.order.shipping_address||'{}');}catch{}details.append(node('p',[result.order.customer_name,address.line1,address.line2,address.city,address.state,address.postal_code,address.country].filter(Boolean).join(', ')));}catch{loaded=false;details.append(node('p','Could not load order details. Close and reopen to retry.'));}};
      ordersEl.append(el); } } catch { ordersEl.textContent = 'Orders are temporarily unavailable.'; }
})();

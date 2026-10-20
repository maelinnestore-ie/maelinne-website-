// Private admin API. Fails closed until D1 and Cloudflare Access are configured.
// Authentication: verified Cloudflare Access RS256 JWT from Cf-Access-Jwt-Assertion.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const b64url=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function authorized(request,env){
 const domain=env.ACCESS_TEAM_DOMAIN, aud=env.ACCESS_AUD;
 if(!domain||!aud)return false;
 const token=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!token)return false;
 const parts=token.split('.');if(parts.length!==3)return false;
 try{
  const header=JSON.parse(new TextDecoder().decode(b64url(parts[0])));
  const claims=JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  if(header.alg!=='RS256'||!header.kid||claims.iss!==`https://${domain}`||!Array.isArray(claims.aud)||!claims.aud.includes(aud)||!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000||!Number.isFinite(claims.nbf)||claims.nbf>Date.now()/1000)return false;
  const r=await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if(!r.ok)return false;
  const keys=(await r.json()).keys||[];
  const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA');
  if(!jwk)return false;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
 }catch{return false;}
}
function fail(message,status=400){return json({error:message},status);}
async function handler({request,env}){
 if(!await authorized(request,env))return fail('Admin access is not configured or authentication has expired.',403);
 if(!env.DB)return fail('D1 database is not configured.',503);
 const url=new URL(request.url),section=url.pathname.replace(/^\/api\/admin\/?/,'').replace(/\/$/,'');
 try{
  if(request.method==='POST'&&section==='images'){
   if(!env.IMAGES)return fail('Image storage is not configured.',503);
   const max=5*1024*1024;
   if(Number(request.headers.get('content-length')||0)>max+65536)return fail('Photo must be smaller than 5 MB.',413);
   let form;try{form=await request.formData();}catch{return fail('Invalid photo upload.');}
   const photo=form.get('photo');
   if(!photo||typeof photo.arrayBuffer!=='function'||photo.size<1||photo.size>max)return fail('Please choose an image smaller than 5 MB.');
   const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
   const ext=types[photo.type];if(!ext)return fail('Use a JPG, PNG or WebP image.');
   const data=new Uint8Array(await photo.arrayBuffer());
   const jpeg=data[0]===255&&data[1]===216&&data[2]===255;
   const png=data.length>8&&[137,80,78,71,13,10,26,10].every((n,i)=>data[i]===n);
   const webp=data.length>12&&new TextDecoder().decode(data.slice(0,4))==='RIFF'&&new TextDecoder().decode(data.slice(8,12))==='WEBP';
   if(!(ext==='jpg'&&jpeg||ext==='png'&&png||ext==='webp'&&webp))return fail('The selected file is not a valid image.');
   const key=crypto.randomUUID()+'.'+ext;
   await env.IMAGES.put(key,data,{httpMetadata:{contentType:photo.type},customMetadata:{source:'maelinne-admin'}});
   return json({url:'/api/images/'+key},201);
  }
  if(request.method==='GET'&&section==='products'){
   const products=(await env.DB.prepare('SELECT * FROM products ORDER BY created_at DESC').all()).results;
   const variants=(await env.DB.prepare('SELECT * FROM variants ORDER BY label').all()).results;const galleries={};if(env.IMAGES){await Promise.all(products.map(async p=>{const obj=await env.IMAGES.get('galleries/'+p.id+'.json');if(obj){try{galleries[p.id]=JSON.parse(await obj.text());}catch{}}}));}
   return json({products:products.map(p=>({...p,images:Array.isArray(galleries[p.id]?.images)?galleries[p.id].images:(p.image_url?[p.image_url]:[]),color:galleries[p.id]?.color||'',style_group:galleries[p.id]?.style_group||'',category:galleries[p.id]?.category||'Uncategorised',fabric:galleries[p.id]?.fabric||'',variants:variants.filter(v=>v.product_id===p.id)}))});
  }
  if(request.method==='GET'&&section==='orders'){
   const orders=(await env.DB.prepare('SELECT id,status,customer_email,customer_name,total_cents,created_at FROM orders ORDER BY created_at DESC LIMIT 100').all()).results;
   return json({orders});
  }
  if(request.method==='PUT'&&/^products\/[a-f0-9-]{36}\/gallery$/.test(section)){
   if(!env.IMAGES)return fail('Image storage unavailable.',503);
   const id=section.split('/')[1];if(!await env.DB.prepare('SELECT id FROM products WHERE id=?').bind(id).first())return fail('Product not found.',404);
   let v;try{v=await request.json();}catch{return fail('Invalid JSON.');}
   const good=url=>typeof url==='string'&&(/^\/api\/images\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(url)||/^\/assets\/[a-zA-Z0-9._/-]+$/.test(url));
   if(!Array.isArray(v.images)||v.images.length>12||v.images.some(url=>!good(url))||typeof v.color!=='string'||v.color.length>80||typeof v.style_group!=='string'||v.style_group.length>80||typeof v.category!=='string'||v.category.length>50||typeof v.fabric!=='string'||v.fabric.length>160)return fail('Invalid colour or photo list.');
   const images=[...new Set(v.images)],color=v.color.trim(),style_group=v.style_group.trim(),category=v.category.trim()||'Uncategorised',fabric=v.fabric.trim();
   await env.IMAGES.put('galleries/'+id+'.json',JSON.stringify({images,color,style_group,category,fabric}),{httpMetadata:{contentType:'application/json'}});
   await env.DB.prepare('UPDATE products SET image_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(images[0]||'',id).run();return json({ok:true});
  }
  // Save only quantities, atomically, and read back from the same transaction.
  if(request.method==='PUT'&&/^products\/[a-f0-9-]{36}\/stock$/.test(section)){
   const id=section.split('/')[1];
   if(!await env.DB.prepare('SELECT id FROM products WHERE id=?').bind(id).first())return fail('Product not found.',404);
   let body;try{body=await request.json();}catch{return fail('Invalid JSON.');}
   const rows=body?.variants;
   if(!Array.isArray(rows)||!rows.length||rows.length>20)return fail('Choose between one and twenty saved sizes.');
   const existing=(await env.DB.prepare('SELECT * FROM variants WHERE product_id=?').bind(id).all()).results;
   const known=new Set(existing.map(row=>row.id)),seen=new Set();
   for(const row of rows){
    if(!row||!known.has(row.id)||seen.has(row.id))return fail('A size row is no longer valid. Reload the product and try again.',409);
    if(!Number.isSafeInteger(row.quantity)||row.quantity<0||row.quantity>100000)return fail('Enter whole-number stock from 0 to 100000.');
    seen.add(row.id);
   }
   if(rows.length!==existing.length)return fail('Use the full product save when adding sizes.',409);
   const statements=rows.map(row=>env.DB.prepare('UPDATE variants SET quantity=? WHERE id=? AND product_id=?').bind(row.quantity,row.id,id));
   statements.push(env.DB.prepare('SELECT * FROM variants WHERE product_id=?').bind(id));
   const results=await env.DB.batch(statements),variants=results[results.length-1].results;
   if(rows.some(row=>!variants.some(saved=>saved.id===row.id&&saved.quantity===row.quantity)))return fail('The saved stock could not be confirmed. Please retry.',500);
   return json({ok:true,variants});
  }
  // Save a whole colour/size grid with the product, preserving existing variant IDs.
  if((request.method==='POST'&&section==='listings')||(request.method==='PUT'&&/^products\/[a-f0-9-]{36}\/listing$/.test(section))){
   if(!env.IMAGES)return fail('Image storage unavailable.',503);
   let body;try{body=await request.json();}catch{return fail('Invalid JSON.');}
   if(!body||typeof body!=='object')return fail('Invalid listing.');
   const editing=request.method==='PUT',productId=editing?section.split('/')[1]:null;
   const existing=editing?await env.DB.prepare('SELECT * FROM products WHERE id=?').bind(productId).first():null;
   if(editing&&!existing)return fail('Product not found.',404);
   const name=String(body.name||'').trim(),description=String(body.description||'').trim(),price=body.price_cents;
   if(!name||name.length>120||description.length>2000||!Number.isSafeInteger(price)||price<0||price>10000000)return fail('Check the name, description and price.');
   const colours=editing?[body]:body.colours;
   if(!Array.isArray(colours)||!colours.length||colours.length>8)return fail('Add between one and eight colours.');
   const validImage=url=>typeof url==='string'&&(/^\/api\/images\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(url)||/^\/assets\/[a-zA-Z0-9._/-]+$/.test(url));
   const oldVariants=editing?(await env.DB.prepare('SELECT * FROM variants WHERE product_id=?').bind(productId).all()).results:[];
   const knownIds=new Set(oldVariants.map(v=>v.id)),seenIds=new Set(),seenSkus=new Set(),seenColours=new Set(),planned=[];
   let total=0;
   for(const colour of colours){
    if(!colour||typeof colour!=='object')return fail('Invalid colour entry.');
    const color=String(colour.color||'').trim(),style_group=String(body.style_group||name.slice(0,80)).trim(),category=String(body.category||'Other').trim(),fabric=String(body.fabric||'').trim();
    if(color.length>80||style_group.length>80||category.length>50||fabric.length>160)return fail('Check the colour, style group, category and material lengths.');
    if(colours.length>1&&!color)return fail('Give each colour a name.');
    if(seenColours.has(color.toLowerCase()))return fail('Each colour must have a different name.');seenColours.add(color.toLowerCase());
    if(!Array.isArray(colour.images)||colour.images.length>12||colour.images.some(image=>!validImage(image)))return fail('Use up to 12 uploaded product photos per colour.');
    if(!Array.isArray(colour.variants)||colour.variants.length>20)return fail('Check the size rows.');
    total+=colour.variants.length;if(total>40)return fail('Save up to 40 size entries at a time.');
    const id=editing?productId:crypto.randomUUID(),labels=new Set(),variants=[];
    for(const row of colour.variants){
     if(!row||typeof row!=='object')return fail('Invalid size row.');
     const label=String(row.label||'').trim(),quantity=row.quantity,sku=String(row.sku||'').trim()||'ML-'+crypto.randomUUID();
     if(!label||label.length>80||sku.length>80||!Number.isSafeInteger(quantity)||quantity<0||quantity>100000)return fail('Each size needs a name and a whole-number stock quantity from 0 to 100000.');
     if(labels.has(label.toLowerCase()))return fail('Size '+label+' appears twice in '+(color||'this listing')+'.');labels.add(label.toLowerCase());
     if(seenSkus.has(sku))return fail('SKU '+sku+' is repeated. Leave SKU blank to generate a unique one.');seenSkus.add(sku);
     if(row.id&&(!knownIds.has(row.id)||seenIds.has(row.id)))return fail('A size row is no longer valid. Reload the product and try again.',409);
     if(row.id)seenIds.add(row.id);
     variants.push({id:row.id||crypto.randomUUID(),existing:!!row.id,label,sku,quantity});
    }
    planned.push({id,variants,gallery:{images:[...new Set(colour.images)],color,style_group,category,fabric}});
   }
   // Existing sizes are retained, including those used by orders. Set stock to zero instead.
   if(editing&&oldVariants.some(v=>!seenIds.has(v.id)))return fail('Existing sizes must stay in the list. Set their stock to 0 if unavailable.');
   const requested=planned.flatMap(item=>item.variants);
   if(requested.length){
    const duplicates=(await env.DB.prepare('SELECT id,sku FROM variants WHERE sku IN ('+requested.map(()=>'?').join(',')+')').bind(...requested.map(row=>row.sku)).all()).results;
    for(const duplicate of duplicates){if(!requested.some(row=>row.existing&&row.id===duplicate.id&&row.sku===duplicate.sku))return fail('SKU '+duplicate.sku+' is already used. Leave SKU blank for a new size, or choose another SKU.',409);}
   }
   const statements=[],backups=[];
   for(const item of planned){
    const key='galleries/'+item.id+'.json',previous=editing?await env.IMAGES.get(key):null;
    backups.push({key,value:previous?await previous.text():null});
    if(editing){statements.push(env.DB.prepare('UPDATE products SET name=?,description=?,image_url=?,price_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name,description,item.gallery.images[0]||'',price,item.id));}
    else{statements.push(env.DB.prepare('INSERT INTO products (id,name,description,image_url,price_cents,active) VALUES (?,?,?,?,?,0)').bind(item.id,name,description,item.gallery.images[0]||'',price));}
    for(const row of item.variants){
     statements.push(row.existing?env.DB.prepare('UPDATE variants SET label=?,sku=?,quantity=? WHERE id=? AND product_id=?').bind(row.label,row.sku,row.quantity,row.id,item.id):env.DB.prepare('INSERT INTO variants (id,product_id,label,sku,quantity) VALUES (?,?,?,?,?)').bind(row.id,item.id,row.label,row.sku,row.quantity));
    }
   }
   let savedVariants=[];
   statements.push(env.DB.prepare('SELECT * FROM variants WHERE product_id IN ('+planned.map(()=>'?').join(',')+')').bind(...planned.map(item=>item.id)));
   try{
    for(const item of planned)await env.IMAGES.put('galleries/'+item.id+'.json',JSON.stringify(item.gallery),{httpMetadata:{contentType:'application/json'}});
    const results=await env.DB.batch(statements);savedVariants=results[results.length-1].results;
   }catch(error){
    await Promise.allSettled(backups.map(b=>b.value===null?env.IMAGES.delete(b.key):env.IMAGES.put(b.key,b.value,{httpMetadata:{contentType:'application/json'}})));
    if(String(error).includes('UNIQUE'))return fail('A SKU was saved elsewhere at the same time. Use another SKU or leave new SKUs blank.',409);
    throw error;
   }
   return json({ok:true,ids:planned.map(item=>item.id),variants:savedVariants},editing?200:201);
  }
  if(request.method==='POST'&&section==='products'){
   let v;try{v=await request.json();}catch{return fail('Invalid JSON');}
   const name=String(v.name||'').trim(),description=String(v.description||'').trim(),image=String(v.image_url||'').trim(),price=Number(v.price_cents),active=v.active===true?1:0;
   if(!name||name.length>120||description.length>2000||!Number.isSafeInteger(price)||price<0||price>10000000)return fail('Check name, description and price.');
   if(image&&!(/^\/api\/images\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(image)||/^\/assets\/[a-zA-Z0-9._/-]+$/.test(image)||/^https:\/\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9._/?=&%-]+$/.test(image)))return fail('Image must be an HTTPS URL or an assets/ path.');
   const id=crypto.randomUUID();
   await env.DB.prepare('INSERT INTO products (id,name,description,image_url,price_cents,active) VALUES (?,?,?,?,?,?)').bind(id,name,description,image,price,active).run();
   return json({id},201);
  }
  if(request.method==='POST'&&section==='variants'){
   let v;try{v=await request.json();}catch{return fail('Invalid JSON');}
   const product=String(v.product_id||''),label=String(v.label||'').trim(),sku=String(v.sku||'').trim(),qty=Number(v.quantity);
   if(!product||!label||label.length>80||!sku||sku.length>80||!Number.isSafeInteger(qty)||qty<0||qty>100000)return fail('Check variant, SKU and quantity.');
   const id=crypto.randomUUID();
   await env.DB.prepare('INSERT INTO variants (id,product_id,label,sku,quantity) VALUES (?,?,?,?,?)').bind(id,product,label,sku,qty).run();
   return json({id},201);
  }
  if(request.method==='DELETE'&&/^products\/[a-f0-9-]{36}$/.test(section)){
   const id=section.slice(9);
   const existing=await env.DB.prepare('SELECT id,active FROM products WHERE id=?').bind(id).first();
   if(!existing)return fail('Product not found',404);
   if(existing.active)return fail('Unpublish this product before deleting it.',409);
   await env.DB.batch([
    env.DB.prepare('DELETE FROM variants WHERE product_id=?').bind(id),
    env.DB.prepare('DELETE FROM products WHERE id=? AND active=0').bind(id)
   ]);
   if(env.IMAGES){await env.IMAGES.delete('galleries/'+id+'.json');}
   return json({ok:true});
  }
  if(request.method==='PATCH'&&section.startsWith('products/')){
   const id=section.slice(9);let v;try{v=await request.json();}catch{return fail('Invalid JSON');}
   const existing=await env.DB.prepare('SELECT * FROM products WHERE id=?').bind(id).first();if(!existing)return fail('Product not found',404);
   const name=v.name===undefined?existing.name:String(v.name).trim();const description=v.description===undefined?existing.description:String(v.description).trim();const image=v.image_url===undefined?existing.image_url:String(v.image_url).trim();const price=v.price_cents===undefined?existing.price_cents:Number(v.price_cents);const active=typeof v.active==='boolean'?(v.active?1:0):existing.active;
   if(!name||name.length>120||description.length>2000||!Number.isSafeInteger(price)||price<0||price>10000000)return fail('Check product name, description and price.');
   if(image&&!(/^\/api\/images\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(image)||/^\/assets\/[a-zA-Z0-9._/-]+$/.test(image)||/^https:\/\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9._/?=&%-]+$/.test(image)))return fail('Invalid image URL.');
   const result=await env.DB.prepare('UPDATE products SET name=?,description=?,image_url=?,price_cents=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name,description,image,price,active,id).run();
   return result.meta.changes?json({ok:true}):fail('Product not found',404);
  }
  if(request.method==='PATCH'&&section.startsWith('variants/')){
   const id=section.slice(9);let v;try{v=await request.json();}catch{return fail('Invalid JSON');}
   const qty=Number(v.quantity);
   if(!Number.isSafeInteger(qty)||qty<0||qty>100000)return fail('Invalid stock quantity.');
   const result=await env.DB.prepare('UPDATE variants SET quantity=? WHERE id=?').bind(qty,id).run();
   return result.meta.changes?json({ok:true}):fail('Variant not found',404);
  }
  return fail('Not found',404);
 }catch(e){console.error('Admin API failure',e);return fail('Unable to complete request. Check database setup or duplicate SKU.',500);}
}
export const onRequest=handler;

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

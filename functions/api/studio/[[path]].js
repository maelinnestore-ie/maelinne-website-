// MaeLinne team studio API. Deliberately fails closed until Cloudflare Access is configured.
// Configure STUDIO_ACCESS_AUD, ACCESS_TEAM_DOMAIN, STUDIO_ALLOWED_EMAILS, DB and IMAGES.
const json=(value,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY"}});
const fail=(message,status=400)=>json({error:message},status);
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const utf=s=>new TextDecoder().decode(decode(s));
async function authenticate(request,env){
 const domain=String(env.ACCESS_TEAM_DOMAIN||"").replace(/^https?:\/\//,"").replace(/\/$/,"");
 const aud=env.STUDIO_ACCESS_AUD;
 const allowed=String(env.STUDIO_ALLOWED_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(!domain||!aud||!allowed.length)return null;
 const token=request.headers.get("Cf-Access-Jwt-Assertion");
 if(!token)return null;
 const bits=token.split(".");if(bits.length!==3)return null;
 try{
  const header=JSON.parse(utf(bits[0])),payload=JSON.parse(utf(bits[1]));
  const now=Date.now()/1000;
  if(header.alg!=="RS256"||!header.kid||payload.iss!=="https://"+domain||!Array.isArray(payload.aud)||!payload.aud.includes(aud)||typeof payload.exp!=="number"||payload.exp<=now||typeof payload.nbf!=="number"||payload.nbf>now||typeof payload.email!=="string"||!allowed.includes(payload.email.toLowerCase()))return null;
  const r=await fetch("https://"+domain+"/cdn-cgi/access/certs");
  if(!r.ok)return null;
  const jwk=(await r.json()).keys?.find(k=>k.kid===header.kid&&k.kty==="RSA");
  if(!jwk)return null;
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decode(bits[2]),new TextEncoder().encode(bits[0]+"."+bits[1])))return null;
  return payload.email.toLowerCase();
 }catch{return null;}
}
const schema="CREATE TABLE IF NOT EXISTS studio_posts (id TEXT PRIMARY KEY, data TEXT NOT NULL, modified_at TEXT NOT NULL, modified_by TEXT NOT NULL)";
const imageSchema="CREATE TABLE IF NOT EXISTS studio_assets (id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL)";
async function setup(db){await db.prepare(schema).run();await db.prepare(imageSchema).run();}
const fields=["id","title","platform","pillar","status","date","hook","caption","notes","link","views","saves","comments","votes"];
function cleaned(x){
 if(!x||typeof x!=="object"||Array.isArray(x))throw Error("Invalid content item.");
 const out={};
 for(const key of fields)out[key]=["views","saves","comments","votes"].includes(key)?Math.max(0,Math.floor(Number(x[key])||0)):String(x[key]??"");
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(out.id))throw Error("Invalid content ID.");
 if(!out.title||out.title.length>120||out.hook.length>400||out.caption.length>10000||out.notes.length>10000||out.link.length>1000)throw Error("Content is missing a title or is too long.");
 if(!["Idea","Planning","Ready to post","Published"].includes(out.status))throw Error("Invalid stage.");
 if(out.date&&!/^\d{4}-\d{2}-\d{2}$/.test(out.date))throw Error("Invalid date.");
 if(out.link&&!/^https:\/\/[^\s]+$/i.test(out.link))throw Error("Use an HTTPS link.");
 return out;
}
async function handler({request,env}){
 const email=await authenticate(request,env);
 if(!email)return fail("Studio access is not configured or you are not authorised.",403);
 if(!env.DB)return fail("Studio database binding is missing.",503);
 const url=new URL(request.url);
 if(!["GET","POST","PUT","DELETE"].includes(request.method))return fail("Method not allowed.",405);
 if(request.method!=="GET"&&request.headers.get("Origin")!==url.origin)return fail("Invalid request origin.",403);
 const path=url.pathname.replace(/^\/api\/studio\/?/,"").replace(/\/$/,"");
 const db=env.DB;
 try{
  await setup(db);
  if(request.method==="GET"&&path==="status")return json({ready:true,email,images:!!env.IMAGES});
  if(request.method==="GET"&&path==="posts"){
   const rows=(await db.prepare("SELECT data,modified_at,modified_by FROM studio_posts ORDER BY modified_at DESC LIMIT 1000").all()).results;
   return json({posts:rows.map(r=>({...JSON.parse(r.data),modified_at:r.modified_at,modified_by:r.modified_by}))});
  }
  if(request.method==="PUT"&&path==="posts"){
   if(Number(request.headers.get("content-length")||0)>30000)return fail("Post too large.",413);
   const post=cleaned(await request.json()),stamp=new Date().toISOString();
   const original=await db.prepare("SELECT modified_at FROM studio_posts WHERE id=?").bind(post.id).first();
   const expected=request.headers.get("If-Unmodified-Since-Post")||"";
   if(original&&expected!==original.modified_at)return fail("This post has changed on another device. Refresh before editing.",409);
   if(!original&&expected)return fail("The post was deleted on another device.",409);
   await db.prepare("INSERT INTO studio_posts (id,data,modified_at,modified_by) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, modified_at=excluded.modified_at, modified_by=excluded.modified_by").bind(post.id,JSON.stringify(post),stamp,email).run();
   return json({post:{...post,modified_at:stamp,modified_by:email}});
  }
  if(request.method==="DELETE"&&/^posts\/[a-zA-Z0-9_-]{1,100}$/.test(path)){
   const id=path.split("/")[1];
   const original=await db.prepare("SELECT modified_at FROM studio_posts WHERE id=?").bind(id).first();
   if(!original)return fail("Post not found.",404);
   if(request.headers.get("If-Unmodified-Since-Post")!==original.modified_at)return fail("Post changed on another device. Refresh.",409);
   await db.prepare("DELETE FROM studio_posts WHERE id=?").bind(id).run();return json({ok:true});
  }
  if(request.method==="GET"&&path==="assets"){
   const assets=(await db.prepare("SELECT * FROM studio_assets ORDER BY created_at DESC LIMIT 200").all()).results;
   return json({assets});
  }
  if(request.method==="POST"&&path==="assets"){
   if(!env.IMAGES)return fail("Image storage is not configured.",503);
   if(Number(request.headers.get("content-length")||0)>5*1024*1024+65536)return fail("Image must be smaller than 5 MB.",413);
   const form=await request.formData(),f=form.get("image"),limit=5*1024*1024;
   if(!f||typeof f.arrayBuffer!=="function"||f.size<1||f.size>limit)return fail("Choose an image below 5 MB.");
   const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[f.type];
   if(!ext)return fail("Only JPG, PNG and WebP are supported.");
   const bytes=new Uint8Array(await f.arrayBuffer());
   const magic=ext==="jpg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:ext==="png"?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
   if(!magic)return fail("Invalid image file.");
   const id=crypto.randomUUID(),filename=String(f.name||"image").replace(/[^a-zA-Z0-9 ._-]/g,"").slice(0,100)||"image";
   await env.IMAGES.put("studio-private/"+id+"."+ext,bytes,{httpMetadata:{contentType:f.type},customMetadata:{private:"true"}});
   await db.prepare("INSERT INTO studio_assets (id,filename,mime,bytes,created_at,created_by) VALUES (?,?,?,?,?,?)").bind(id,filename,f.type,f.size,new Date().toISOString(),email).run();
   return json({id,filename,mime:f.type},201);
  }
  if(request.method==="GET"&&/^assets\/[a-f0-9-]{36}\/image$/.test(path)){
   if(!env.IMAGES)return fail("Image storage is not configured.",503);
   const id=path.split("/")[1],a=await db.prepare("SELECT mime FROM studio_assets WHERE id=?").bind(id).first();
   if(!a)return fail("Not found.",404);
   const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[a.mime];
   const image=await env.IMAGES.get("studio-private/"+id+"."+ext);
   if(!image)return fail("Image not found.",404);
   return new Response(image.body,{headers:{"content-type":a.mime,"cache-control":"private, no-store","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; sandbox"}});
  }
  if(request.method==="DELETE"&&/^assets\/[a-f0-9-]{36}$/.test(path)){
   if(!env.IMAGES)return fail("Image storage is not configured.",503);
   const id=path.split("/")[1],a=await db.prepare("SELECT mime FROM studio_assets WHERE id=?").bind(id).first();
   if(!a)return fail("Image not found.",404);
   await env.IMAGES.delete("studio-private/"+id+"."+{"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[a.mime]);
   await db.prepare("DELETE FROM studio_assets WHERE id=?").bind(id).run();return json({ok:true});
  }
  return fail("Not found.",404);
 }catch(e){if(/Invalid|missing|too long|too large|Use an HTTPS/.test(e.message))return fail(e.message);return fail("Studio operation failed. Check the database migration and bindings.",500)}
}
export const onRequest=handler;

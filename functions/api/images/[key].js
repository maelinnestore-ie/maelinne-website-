// Read-only image delivery. Bucket remains private; only image keys can be requested.
export async function onRequestGet({params,env}){
 const key=String(params.key||'');
 if(!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key))return new Response('Not found',{status:404});
 if(!env.IMAGES)return new Response('Image storage unavailable',{status:503});
 const file=await env.IMAGES.get(key);
 if(!file)return new Response('Not found',{status:404});
 const types={jpg:'image/jpeg',png:'image/png',webp:'image/webp'};
 return new Response(file.body,{headers:{'content-type':types[key.split('.').pop()],'cache-control':'public, max-age=86400','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
}

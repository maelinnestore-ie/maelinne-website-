// Public catalogue includes only published products. No customer/order data.
export async function onRequestGet({env}){
 if(!env.DB)return Response.json({error:'Catalogue not configured',products:[]},{status:503});
 try{
  const products=(await env.DB.prepare('SELECT id,name,description,image_url,price_cents FROM products WHERE active=1 ORDER BY created_at DESC').all()).results;
  const variants=(await env.DB.prepare('SELECT id,product_id,label,quantity FROM variants WHERE quantity>0').all()).results;
  return Response.json({products:products.map(p=>({...p,variants:variants.filter(v=>v.product_id===p.id)}))},{headers:{'cache-control':'no-store'}});
 }catch{return Response.json({error:'Catalogue unavailable',products:[]},{status:503});}
}

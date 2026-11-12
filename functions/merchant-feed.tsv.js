// Public, automatically refreshed Google Merchant Center TSV product feed.
// Uses only published product data and current sellable size variants.
const origin = 'https://www.maelinne.ie';
const columns = ['id','item_group_id','title','description','link','image_link','availability','price','condition','brand','google_product_category','color','size','gender','age_group','material'];
const clean = value => String(value ?? '').replace(/<[^>]*>/g,' ').replace(/[\t\r\n]+/g,' ').replace(/\s{2,}/g,' ').trim();
const url = value => {
  try {
    const u = new URL(String(value||''),origin);
    return u.protocol==='https:'?u.href:'';
  } catch {return '';}
};
export async function onRequestGet({env}) {
  if (!env.DB) return new Response('Catalogue unavailable',{status:503});
  try {
    const products=(await env.DB.prepare("SELECT id,name,description,image_url,price_cents FROM products WHERE active=1 AND UPPER(name) NOT LIKE 'TEST ONLY%' ORDER BY created_at DESC").all()).results||[];
    let variants;
    try {
      variants=(await env.DB.prepare("SELECT v.id,v.product_id,v.label,v.quantity-COALESCE((SELECT SUM(quantity) FROM checkout_holds WHERE variant_id=v.id),0) AS quantity FROM variants v JOIN products p ON p.id=v.product_id WHERE p.active=1").all()).results||[];
    } catch(error) {
      if(!String(error).includes('no such table'))throw error;
      variants=(await env.DB.prepare("SELECT v.id,v.product_id,v.label,v.quantity FROM variants v JOIN products p ON p.id=v.product_id WHERE p.active=1").all()).results||[];
    }
    const byProduct=new Map();
    for(const v of variants) {
      if(!byProduct.has(v.product_id))byProduct.set(v.product_id,[]);
      byProduct.get(v.product_id).push(v);
    }
    const lines=[columns.join('\t')];
    for(const p of products) {
      if(!Number.isSafeInteger(p.price_cents)||p.price_cents<=0)continue;
      const sizes=byProduct.get(p.id)||[];
      if(!sizes.length)continue;
      let gallery={};
      if(env.IMAGES) {
        try {
          const object=await env.IMAGES.get('galleries/'+p.id+'.json');
          if(object) gallery=JSON.parse(await object.text())||{};
        } catch {/* Use product's primary image if gallery is not readable. */}
      }
      const image=url((Array.isArray(gallery.images)?gallery.images.find(Boolean):'')||p.image_url);
      if(!image)continue;
      const productUrl=origin+'/product?id='+encodeURIComponent(p.id);
      const title=clean(p.name).slice(0,150);
      const description=clean(p.description||p.name).slice(0,5000);
      if(!title||!description)continue;
      for(const v of sizes) {
        const row={
          id:v.id,
          item_group_id:p.id,
          title,
          description,
          link:productUrl,
          image_link:image,
          availability:Number(v.quantity)>0?'in_stock':'out_of_stock',
          price:(p.price_cents/100).toFixed(2)+' EUR',
          condition:'new',
          brand:'MaeLinne',
          google_product_category:'Apparel & Accessories > Clothing > Shirts & Tops',
          color:clean(gallery.color),
          size:clean(v.label),
          gender:'female',
          age_group:'adult',
          material:clean(gallery.fabric)
        };
        if(!row.size)continue;
        lines.push(columns.map(field=>clean(row[field])).join('\t'));
      }
    }
    return new Response('\uFEFF'+lines.join('\n')+'\n',{headers:{
      'content-type':'text/tab-separated-values; charset=utf-8',
      'content-disposition':'inline; filename="maelinne-products.tsv"',
      'cache-control':'public, max-age=900',
      'x-content-type-options':'nosniff'
    }});
  } catch {
    return new Response('Product feed temporarily unavailable',{status:503,headers:{'cache-control':'no-store'}});
  }
}

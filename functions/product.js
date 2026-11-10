// Enhance the existing Cloudflare Pages product response without changing shop logic.
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function onRequestGet(context) {
  // context.next() lets Pages serve the existing HTML asset using its own routing.
  const original = await context.next();
  if (!original.ok || !original.headers.get('content-type')?.includes('text/html')) return original;
  const id = new URL(context.request.url).searchParams.get('id');
  if (!id || id.length > 150 || !context.env.DB) return original;
  let p;
  try {
    p = await context.env.DB.prepare('SELECT id,name,description,image_url,price_cents FROM products WHERE active=1 AND id=?').bind(id).first();
  } catch { return original; }
  if (!p) return original;
  const url='https://www.maelinne.ie/product?id='+encodeURIComponent(p.id);
  const description=String(p.description||('Shop '+p.name+' at MaeLinne Ireland.')).replace(/\s+/g,' ').trim().slice(0,155);
  const test=/^TEST ONLY/i.test(p.name);
  const offer={ '@type':'Offer',priceCurrency:'EUR',price:(p.price_cents/100).toFixed(2),url };
  const data={'@context':'https://schema.org','@type':'Product',name:p.name,description,url,brand:{'@type':'Brand',name:'MaeLinne'},offers:offer};
  if (p.image_url && /^https:\/\//.test(p.image_url)) data.image=[p.image_url];
  const json=JSON.stringify(data).replace(/</g,'\\u003c');
  const meta='<title>'+esc(p.name+' | MaeLinne Ireland')+'</title><meta name="description" content="'+esc(description)+'"><link rel="canonical" href="'+esc(url)+'">'+(test?'<meta name="robots" content="noindex,follow">':'<script type="application/ld+json">'+json+'</script>');
  const html=(await original.text()).replace(/<title>[^<]*<\/title>/i,meta);
  const headers=new Headers(original.headers);
  headers.delete('content-length');
  headers.set('cache-control','no-store');
  return new Response(html,{status:original.status,headers});
}

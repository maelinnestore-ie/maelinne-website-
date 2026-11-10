// Cloudflare Pages: add product-specific SEO to the initial HTML response.
// The existing client-side product display and checkout remain unchanged.
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const summary = value => String(value || '').replace(/\s+/g,' ').trim().slice(0,155);
export async function onRequestGet({request,env}) {
  const assetUrl = new URL('/product.html', request.url);
  const original = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!original.ok || !env.DB) return original;
  const id = new URL(request.url).searchParams.get('id');
  if (!id || id.length > 150) return original;
  let product;
  try {
    product = await env.DB.prepare('SELECT id,name,description,image_url,price_cents FROM products WHERE active=1 AND id=?').bind(id).first();
  } catch { return original; }
  if (!product) return original;
  const url = 'https://www.maelinne.ie/product?id=' + encodeURIComponent(product.id);
  const title = product.name + ' | MaeLinne Ireland';
  const description = summary(product.description) || ('Shop ' + product.name + ' at MaeLinne, Ireland. Discover easy-to-wear fashion with a little Y2K personality.');
  const json = {'@context':'https://schema.org','@type':'Product',name:product.name,description:description,url:url,brand:{'@type':'Brand',name:'MaeLinne'},offers:{'@type':'Offer',priceCurrency:'EUR',price:(product.price_cents/100).toFixed(2),url:url}};
  if (product.image_url && /^https:\/\//.test(product.image_url)) json.image=[product.image_url];
  const safeJson=JSON.stringify(json).replace(/</g,'\\u003c');
  const seo = '<title>'+escapeHtml(title)+'</title><meta name="description" content="'+escapeHtml(description)+'"><link rel="canonical" href="'+escapeHtml(url)+'"><script type="application/ld+json">'+safeJson+'</script>';
  const html=(await original.text()).replace(/<title>[^<]*<\/title>/i,seo);
  const headers=new Headers(original.headers);
  headers.set('content-type','text/html; charset=utf-8');
  headers.set('cache-control','no-store');
  return new Response(html,{status:original.status,headers});
}

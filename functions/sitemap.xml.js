// Cloudflare Pages: public sitemap automatically includes published products.
const xmlEscape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export async function onRequestGet({env}) {
  const urls=['https://www.maelinne.ie/','https://www.maelinne.ie/shop.html'];
  if (env.DB) {
    try {
      const rows=(await env.DB.prepare('SELECT id FROM products WHERE active=1 ORDER BY created_at DESC').all()).results || [];
      for (const p of rows) if(p.id != null) urls.push('https://www.maelinne.ie/product.html?id='+encodeURIComponent(p.id));
    } catch { return new Response('Sitemap temporarily unavailable',{status:503,headers:{'cache-control':'no-store'}}); }
  }
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls.map(u=>'  <url><loc>'+xmlEscape(u)+'</loc></url>').join('\n')+'\n</urlset>\n';
  return new Response(xml,{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'public, max-age=300'}});
}

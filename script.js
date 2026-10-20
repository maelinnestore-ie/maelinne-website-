const toggle = document.querySelector('.menu-toggle');
const mobileNav = document.getElementById('mobile-nav');
function closeMenu() {
  if (!mobileNav || !toggle) return;
  mobileNav.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open menu');
}
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!open));
  toggle.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
  mobileNav.hidden = open;
});
mobileNav?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobileNav && !mobileNav.hidden) {
    closeMenu();
    toggle.focus();
  }
});
document.getElementById('year').textContent = new Date().getFullYear();
const grid = document.getElementById('home-real-products');
const money = n => new Intl.NumberFormat('en-IE', {style: 'currency', currency: 'EUR'}).format(n / 100);
const productUrl = product => '/product.html?id=' + encodeURIComponent(product.id);
const photos = product => product.images?.length ? product.images : product.image_url ? [product.image_url] : [];

(async () => {
  try {
    const response = await fetch('/api/products', {cache: 'no-store'});
    if (!response.ok) throw Error('Catalogue unavailable');
    const {products = []} = await response.json();
    grid.replaceChildren();
    if (!products.length) {
      grid.textContent = 'Our first pieces are being prepared. Come back soon.';
      // Don't promote an old product when nothing is published.
      document.querySelector('.editorial-collage').hidden = true;
      document.querySelector('.editorial-feature').hidden = true;
      document.getElementById('hero-product-image').src = '/assets/hero.webp';
      document.getElementById('hero-product-image').alt = 'MaeLinne editorial mood photograph';
      document.querySelector('.hero-scribble').textContent = 'good clothes, better days';
      return;
    }
    for (const product of products.slice(0, 4)) {
      const card = document.createElement('article');
      card.className = 'editorial-product-card';
      const link = document.createElement('a');
      link.href = productUrl(product);
      const photo = document.createElement('div');
      photo.className = 'editorial-card-photo';
      const image = document.createElement('img');
      image.src = photos(product)[0] || '/assets/camisole.webp';
      image.alt = product.name + (product.color ? ' in ' + product.color : '');
      image.loading = 'lazy';
      photo.append(image);
      const detail = document.createElement('span');
      detail.className = 'card-view';
      detail.textContent = 'Take a closer look ↗';
      photo.append(detail);
      const name = document.createElement('h3');
      name.textContent = product.name;
      const price = document.createElement('p');
      price.textContent = money(product.price_cents);
      link.append(photo, name, price);
      if (product.fabric) {
        const material = document.createElement('p');
        material.className = 'card-material';
        material.textContent = 'Material: ' + product.fabric;
        link.append(material);
      }
      card.append(link);
      grid.append(card);
    }
    // Prefer the agreed Henley while published; otherwise feature a current piece.
    const featured = products.find(p => /hammond|henley/i.test(p.name) && photos(p).length)
      || products.find(p => photos(p).length);
    if (featured) {
      const gallery = photos(featured);
      const hero = document.getElementById('hero-product-image');
      hero.src = gallery[1] || gallery[0];
      hero.alt = featured.name + (featured.color ? ' in ' + featured.color : '');
      const heroLink = document.getElementById('hero-product-link');
      heroLink.href = productUrl(featured);
      heroLink.textContent = featured.name + ' ↗';
      heroLink.hidden = false;
      const isHenley = /hammond|henley/i.test(featured.name);
      document.querySelector('.hero-scribble').textContent = isHenley ? 'a little lace. a little throwback.' : 'your next favourite';
      for (const [id, source] of [['editorial-detail-image', gallery[1] || gallery[0]], ['feature-detail-image', gallery[0]]]) {
        const image = document.getElementById(id);
        image.src = source;
        image.alt = (isHenley ? 'A closer look at the lace and ribbed texture of ' : 'A closer look at ') + featured.name;
        image.classList.toggle('detail-crop', isHenley);
      }
      const featureLink = document.querySelector('.feature-words .editorial-cta');
      featureLink.href = productUrl(featured);
      featureLink.textContent = 'TAKE A CLOSER LOOK ↗';
      const material = document.getElementById('featured-material');
      material.hidden = !featured.fabric;
      material.textContent = featured.fabric ? 'Material: ' + featured.fabric : '';
    } else {
      document.getElementById('hero-product-image').src = '/assets/hero.webp';
      document.getElementById('hero-product-image').alt = 'MaeLinne editorial mood photograph';
      document.querySelector('.editorial-collage').hidden = true;
      document.querySelector('.editorial-feature').hidden = true;
    }
  } catch {
    grid.textContent = 'Our collection is temporarily unavailable. Please check back soon.';
  }
})();

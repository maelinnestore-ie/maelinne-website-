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
      return;
    }
    for (const product of products.slice(0, 3)) {
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
    document.dispatchEvent(new Event('maelinne:products-rendered'));
  } catch {
    grid.textContent = 'Our collection is temporarily unavailable. Please check back soon.';
  }
})();


// Detail photography rotates independently of the product catalogue.
(() => {
  const gallery = document.querySelector('.detail-gallery');
  if (!gallery) return;
  const slides = [
    {src:'lace-cami',alt:'White lace edging, a small bow and fine stripes on the Bobbie cami',caption:'A little lace, a little bow.',width:750,height:678},
    {src:'striped-sleeve',alt:'Fine black-and-white striped long sleeve beneath a plain black short sleeve',caption:'Layers worth a closer look.',width:392,height:550},
    {src:'henley-neckline',alt:'Olive ribbed Henley neckline with white buttons and a lace-trimmed white layer',caption:'Ribbed texture. Lovely little buttons.',width:698,height:1064},
    {src:'lace-hem',alt:'Scalloped white lace peeking beneath the hem of an olive ribbed top',caption:'The prettiest finishing touch.',width:808,height:246},
    {src:'black-henley-cuff-3inch',alt:'AI-generated close-up illustrating a black ribbed Henley with a fitted 3-inch cuff',caption:'3-inch cuffs.',width:1200,height:900}
  ];
  const image = document.getElementById('feature-detail-image');
  const caption = document.getElementById('detail-caption');
  const pause = document.getElementById('detail-pause');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0, requested = 0, paused = motion.matches, visible = false;
  let timer;
  const path = slide => '/assets/details/' + slide.src + '.webp';
  function schedule() {
    clearInterval(timer);
    if (!paused && visible && !document.hidden)
      timer = setInterval(() => show(index + 1), 5000);
  }
  function updatePause() {
    pause.firstElementChild.textContent = paused ? '▶' : 'Ⅱ';
    pause.title = (paused ? 'Play' : 'Pause') + ' slideshow';
    pause.setAttribute('aria-label', (paused ? 'Play' : 'Pause') + ' detail slideshow');
  }
  async function show(next) {
    const selected = (next + slides.length) % slides.length;
    const slide = slides[selected], ticket = ++requested;
    const ready = new Image();
    ready.src = path(slide);
    try { await ready.decode(); } catch { return; }
    if (ticket !== requested) return;
    index = selected;
    image.src = ready.src;
    image.alt = slide.alt;
    image.width = slide.width;
    image.height = slide.height;
    caption.textContent = slide.caption;
  }
  pause.addEventListener('click', () => { paused = !paused; updatePause(); schedule(); });
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', () => { paused = motion.matches; updatePause(); schedule(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      schedule();
    }, {threshold:0.2}).observe(gallery);
  } else { visible = true; }
  updatePause();
  schedule();
})();

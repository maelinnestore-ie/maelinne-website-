-- MaeLinne shop v1. Run against the D1 database before enabling the admin API.
CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 image_url TEXT NOT NULL DEFAULT '',
 price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS variants (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 label TEXT NOT NULL,
 sku TEXT NOT NULL UNIQUE,
 quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0)
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY,
 payment_id TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled','refunded','shipped')),
 customer_email TEXT NOT NULL DEFAULT '',
 customer_name TEXT NOT NULL DEFAULT '',
 shipping_address TEXT NOT NULL DEFAULT '',
 total_cents INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
 order_id TEXT NOT NULL REFERENCES orders(id),
 variant_id TEXT NOT NULL REFERENCES variants(id),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 unit_price_cents INTEGER NOT NULL,
 PRIMARY KEY (order_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

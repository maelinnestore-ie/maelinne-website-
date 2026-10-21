-- Run once in D1 before enabling checkout. Existing inventory is preserved.
ALTER TABLE orders ADD COLUMN checkout_state TEXT;
ALTER TABLE orders ADD COLUMN promo_code TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN shipping_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN checkout_key TEXT;
ALTER TABLE orders ADD COLUMN checkout_session_id TEXT;
ALTER TABLE orders ADD COLUMN checkout_payload TEXT;
ALTER TABLE orders ADD COLUMN checkout_url TEXT;
ALTER TABLE orders ADD COLUMN checkout_expires INTEGER;
ALTER TABLE orders ADD COLUMN test_mode INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN stock_committed INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX orders_checkout_key ON orders(checkout_key);
CREATE UNIQUE INDEX orders_checkout_session ON orders(checkout_session_id);
CREATE TABLE checkout_holds (
 order_id TEXT NOT NULL REFERENCES orders(id),
 variant_id TEXT NOT NULL REFERENCES variants(id),
 quantity INTEGER NOT NULL CHECK(quantity>0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 PRIMARY KEY(order_id,variant_id)
);
CREATE INDEX checkout_holds_variant ON checkout_holds(variant_id);
CREATE TRIGGER checkout_hold_available BEFORE INSERT ON checkout_holds BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM variants v JOIN products p ON p.id=v.product_id
  WHERE v.id=NEW.variant_id AND p.active=1
  AND v.quantity-COALESCE((SELECT SUM(h.quantity) FROM checkout_holds h WHERE h.variant_id=v.id),0)>=NEW.quantity
 ) THEN RAISE(ABORT,'STOCK_UNAVAILABLE') END;
END;
CREATE TRIGGER protect_reserved_stock BEFORE UPDATE OF quantity ON variants BEGIN
 SELECT CASE WHEN NEW.quantity<COALESCE((SELECT SUM(quantity) FROM checkout_holds WHERE variant_id=NEW.id),0)
 THEN RAISE(ABORT,'STOCK_RESERVED') END;
END;

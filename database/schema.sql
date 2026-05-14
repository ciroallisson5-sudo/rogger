-- Conforta Store - Complete Database Schema for Supabase
-- Run this SQL in Supabase SQL Editor

-- ============================================
-- DROP OLD TABLES (if upgrading from v1)
-- ============================================
DROP TABLE IF EXISTS api_v3_produtos CASCADE;
DROP TABLE IF EXISTS customer_carts CASCADE;
DROP TABLE IF EXISTS customer_orders CASCADE;
DROP TABLE IF EXISTS customer_profiles CASCADE;
DROP TABLE IF EXISTS customer_addresses CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS chat_logs CASCADE;

-- ============================================
-- PROFILES (extends auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ADDRESSES
-- ============================================
CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  label TEXT DEFAULT 'Principal',
  cep TEXT,
  street TEXT NOT NULL,
  number TEXT,
  complement TEXT,
  neighborhood TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CATEGORIES
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  image_url TEXT,
  active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PRODUCTS
-- ============================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  base_price DECIMAL(10,2) NOT NULL,
  discount_price DECIMAL(10,2),
  flash_offer_ends TIMESTAMPTZ,
  stock INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  featured BOOLEAN DEFAULT false,
  tags TEXT[] DEFAULT '{}',
  weight DECIMAL(8,2),
  dimensions TEXT,
  material TEXT,
  warranty TEXT,
  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PRODUCT PHOTOS (configurable per photo)
-- ============================================
CREATE TABLE IF NOT EXISTS product_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  url TEXT NOT NULL,
  thumb_url TEXT,
  alt_text TEXT,
  sort_order INT DEFAULT 0,
  is_video BOOLEAN DEFAULT false,
  video_url TEXT,
  -- Individual photo configurations
  price DECIMAL(10,2),
  discount_price DECIMAL(10,2),
  color_name TEXT,
  color_hex TEXT,
  size TEXT,
  custom_label TEXT,
  stock_override INT,
  -- Group configuration: if same_as_photo_id is set, this photo uses same config as that photo
  same_as_photo_id UUID REFERENCES product_photos(id) ON DELETE SET NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CART
-- ============================================
CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID REFERENCES carts(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  photo_id UUID REFERENCES product_photos(id) ON DELETE SET NULL,
  quantity INT DEFAULT 1 NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ORDERS
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  order_number TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','preparing','shipped','delivered','cancelled')),
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','refunded','cancelled')),
  payment_method TEXT,
  asaas_payment_id TEXT,
  total_amount DECIMAL(10,2) NOT NULL,
  shipping_amount DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  shipping_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL,
  tracking_code TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  photo_id UUID REFERENCES product_photos(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  photo_url TEXT,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  color_name TEXT,
  size TEXT
);

-- ============================================
-- CHAT MESSAGES (AI Chat history)
-- ============================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  context_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BANNERS (Home carousel)
-- ============================================
CREATE TABLE IF NOT EXISTS banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  subtitle TEXT,
  image_url TEXT NOT NULL,
  link_url TEXT,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  sort_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- USER FILES (photos users upload)
-- ============================================
CREATE TABLE IF NOT EXISTS user_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  url TEXT NOT NULL,
  file_type TEXT,
  original_name TEXT,
  size_bytes INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ASAAS CUSTOMERS (cache)
-- ============================================
CREATE TABLE IF NOT EXISTS asaas_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  asaas_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PAYMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  payment_method TEXT NOT NULL,
  asaas_id TEXT,
  status TEXT DEFAULT 'pending',
  value DECIMAL(10,2),
  pix_qr_code TEXT,
  pix_key TEXT,
  card_brand TEXT,
  boleto_url TEXT,
  boleto_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SITE SETTINGS
-- ============================================
CREATE TABLE IF NOT EXISTS site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO site_settings (key, value) VALUES
('store_name', '"Conforta"'),
('store_description', '"Colchões, sofás, box baú e muito mais para transformar seu conforto."'),
('primary_color', '"#1a56db"'),
('secondary_color', '"#0f3a8e"'),
('whatsapp_number', '"5527999999999"'),
('asaas_api_key', '""'),
('asaas_environment', '"sandbox"'),
('n8n_webhook_url', '""'),
('admin_emails', '["email_do_admin"]'),
('delivery_info', '{"free_from": 299, "delivery_time": "24h", "regions": ["Serra", "Vitória"]}'),
('seo_defaults', '{"title": "Conforta - Transforme seu conforto", "description": "Colchões, sofás, box baú e muito mais"}')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured);
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_product_photos_product ON product_photos(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);

-- ============================================
-- HELPER FUNCTION: get_admin_emails
-- Returns admin emails from site_settings
-- Uses SECURITY DEFINER to bypass RLS and avoid recursion
-- ============================================
CREATE OR REPLACE FUNCTION get_admin_emails()
RETURNS TEXT[] AS $$
  SELECT COALESCE(
    (SELECT array_agg(elem) FROM jsonb_array_elements_text(value) AS elem WHERE key = 'admin_emails'),
    ARRAY[]::TEXT[]
  )
  FROM site_settings
  WHERE key = 'admin_emails'
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE asaas_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Products public read" ON products FOR SELECT USING (active = true);
CREATE POLICY "Product photos public read" ON product_photos FOR SELECT USING (active = true);
CREATE POLICY "Categories public read" ON categories FOR SELECT USING (active = true);
CREATE POLICY "Banners public read" ON banners FOR SELECT USING (active = true);
CREATE POLICY "Site settings public read" ON site_settings FOR SELECT USING (true);

-- User policies
CREATE POLICY "Users manage own profile" ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "Users manage own addresses" ON addresses FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own cart" ON carts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own cart items" ON cart_items FOR ALL USING (cart_id IN (SELECT id FROM carts WHERE user_id = auth.uid()));
CREATE POLICY "Users view own orders" ON orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users view own order items" ON order_items FOR SELECT USING (order_id IN (SELECT id FROM orders WHERE user_id = auth.uid()));
CREATE POLICY "Users manage own chat" ON chat_messages FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own files" ON user_files FOR ALL USING (auth.uid() = user_id);

-- Admin policies (manage all)
-- Admin is identified by email in the admin_emails setting (bypasses RLS via SECURITY DEFINER)
CREATE POLICY "Admin all products" ON products FOR ALL USING (
  auth.email() = ANY(get_admin_emails())
);
CREATE POLICY "Admin all photos" ON product_photos FOR ALL USING (
  auth.email() = ANY(get_admin_emails())
);
CREATE POLICY "Admin all orders" ON orders FOR ALL USING (
  auth.email() = ANY(get_admin_emails())
);
CREATE POLICY "Admin all categories" ON categories FOR ALL USING (
  auth.email() = ANY(get_admin_emails())
);
CREATE POLICY "Admin all banners" ON banners FOR ALL USING (
  auth.email() = ANY(get_admin_emails())
);
CREATE POLICY "Admin view all profiles" ON profiles FOR SELECT USING (
  auth.email() = ANY(get_admin_emails())
);
-- Note: site_settings has no admin policy to avoid recursion;
-- public read allows SELECT, writes checked via application layer

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'phone'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Get or create cart
CREATE OR REPLACE FUNCTION get_or_create_cart(p_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_cart_id UUID;
BEGIN
  SELECT id INTO v_cart_id FROM carts WHERE user_id = p_user_id;
  IF v_cart_id IS NULL THEN
    INSERT INTO carts (user_id) VALUES (p_user_id) RETURNING id INTO v_cart_id;
  END IF;
  RETURN v_cart_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Product search function
CREATE OR REPLACE FUNCTION search_products(search_term TEXT)
RETURNS SETOF products AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM products
  WHERE active = true
    AND (
      name ILIKE '%' || search_term || '%'
      OR description ILIKE '%' || search_term || '%'
      OR search_term = ANY(tags)
    )
  ORDER BY featured DESC, created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- RPC for n8n - get all products with photos and categories
CREATE OR REPLACE FUNCTION get_products_n8n()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'id', p.id,
      'name', p.name,
      'slug', p.slug,
      'description', p.description,
      'category', c.name,
      'category_slug', c.slug,
      'base_price', p.base_price::float,
      'discount_price', p.discount_price::float,
      'stock', p.stock,
      'featured', p.featured,
      'tags', p.tags,
      'weight', p.weight,
      'dimensions', p.dimensions,
      'material', p.material,
      'warranty', p.warranty,
      'created_at', p.created_at,
      'photos', (
        SELECT json_agg(
          json_build_object(
            'id', ph.id,
            'url', ph.url,
            'is_video', ph.is_video,
            'video_url', ph.video_url,
            'color_name', ph.color_name,
            'color_hex', ph.color_hex,
            'size', ph.size,
            'price', ph.price::float,
            'discount_price', ph.discount_price::float,
            'custom_label', ph.custom_label,
            'stock_override', ph.stock_override
          )
          ORDER BY ph.sort_order
        )
        FROM product_photos ph
        WHERE ph.product_id = p.id AND ph.active = true
      )
    )
    ORDER BY p.name
  ) INTO result
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.active = true;

  RETURN COALESCE(result, '[]'::json);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

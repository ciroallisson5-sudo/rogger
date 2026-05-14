-- ============================================
-- Conforta Store - Policies que faltavam para o checkout
-- Rode este arquivo no SQL Editor do Supabase
-- ============================================

-- ORDERS: permitir o usuario criar pedidos proprios
DROP POLICY IF EXISTS "Users insert own orders" ON orders;
CREATE POLICY "Users insert own orders" ON orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own orders" ON orders;
CREATE POLICY "Users update own orders" ON orders
  FOR UPDATE USING (auth.uid() = user_id);

-- ORDER ITEMS: permitir o usuario criar itens em pedidos proprios
DROP POLICY IF EXISTS "Users insert own order items" ON order_items;
CREATE POLICY "Users insert own order items" ON order_items
  FOR INSERT WITH CHECK (
    order_id IN (SELECT id FROM orders WHERE user_id = auth.uid())
  );

-- ASAAS CUSTOMERS: cada usuario gerencia o proprio cache
DROP POLICY IF EXISTS "Users manage own asaas customer" ON asaas_customers;
CREATE POLICY "Users manage own asaas customer" ON asaas_customers
  FOR ALL USING (auth.uid() = user_id);

-- PAYMENTS: usuario pode ler/criar pagamentos dos proprios pedidos
DROP POLICY IF EXISTS "Users select own payments" ON payments;
CREATE POLICY "Users select own payments" ON payments
  FOR SELECT USING (
    order_id IN (SELECT id FROM orders WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users insert own payments" ON payments;
CREATE POLICY "Users insert own payments" ON payments
  FOR INSERT WITH CHECK (
    order_id IN (SELECT id FROM orders WHERE user_id = auth.uid())
  );

-- ADMIN tambem pode ver/gerenciar tudo
DROP POLICY IF EXISTS "Admin all order_items" ON order_items;
CREATE POLICY "Admin all order_items" ON order_items FOR ALL USING (
  auth.email() = ANY(get_admin_emails())
);

DROP POLICY IF EXISTS "Admin all payments" ON payments;
CREATE POLICY "Admin all payments" ON payments FOR ALL USING (
  auth.email() = ANY(get_admin_emails())
);

DROP POLICY IF EXISTS "Admin all asaas customers" ON asaas_customers;
CREATE POLICY "Admin all asaas customers" ON asaas_customers FOR ALL USING (
  auth.email() = ANY(get_admin_emails())
);

-- Permitir admin gravar em site_settings (sem recursao, checado pela funcao)
DROP POLICY IF EXISTS "Admin update site settings" ON site_settings;
CREATE POLICY "Admin update site settings" ON site_settings FOR ALL USING (
  auth.email() = ANY(get_admin_emails())
);

-- ============================================
-- ESTOQUE: descontar quando o pedido eh criado
-- ============================================
-- Funcao chamada pelo checkout (SECURITY DEFINER porque
-- products/product_photos sao apenas leitura para o cliente).
CREATE OR REPLACE FUNCTION decrement_stock_for_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID;
BEGIN
  -- O pedido tem que pertencer ao usuario que esta chamando (ou ser admin).
  SELECT user_id INTO v_user FROM orders WHERE id = p_order_id;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Pedido nao encontrado';
  END IF;

  IF v_user <> auth.uid() AND NOT (auth.email() = ANY(get_admin_emails())) THEN
    RAISE EXCEPTION 'Sem permissao para baixar estoque deste pedido';
  END IF;

  -- 1) Baixar estoque nas fotos que tem stock_override (variacoes)
  UPDATE product_photos ph
     SET stock_override = GREATEST(COALESCE(ph.stock_override, 0) - oi.qty, 0)
    FROM (
      SELECT photo_id, SUM(quantity)::INT AS qty
        FROM order_items
       WHERE order_id = p_order_id
         AND photo_id IS NOT NULL
       GROUP BY photo_id
    ) oi
   WHERE ph.id = oi.photo_id
     AND ph.stock_override IS NOT NULL;

  -- 2) Baixar estoque no produto base para os itens sem variacao
  UPDATE products p
     SET stock = GREATEST(COALESCE(p.stock, 0) - oi.qty, 0)
    FROM (
      SELECT oi2.product_id AS product_id, SUM(oi2.quantity)::INT AS qty
        FROM order_items oi2
        LEFT JOIN product_photos ph2 ON ph2.id = oi2.photo_id
       WHERE oi2.order_id = p_order_id
         AND (oi2.photo_id IS NULL OR ph2.stock_override IS NULL)
       GROUP BY oi2.product_id
    ) oi
   WHERE p.id = oi.product_id;
END;
$$;

REVOKE ALL ON FUNCTION decrement_stock_for_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decrement_stock_for_order(UUID) TO authenticated;

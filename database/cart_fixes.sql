-- Conforta Store - Carrinho (RPC + permissao)
-- Rode no SQL Editor do Supabase se add ao carrinho falhar com "permission denied" ou similar.

CREATE OR REPLACE FUNCTION public.get_or_create_cart(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cart_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acesso negado ao carrinho';
  END IF;

  SELECT id INTO v_cart_id FROM carts WHERE user_id = p_user_id LIMIT 1;
  IF v_cart_id IS NULL THEN
    INSERT INTO carts (user_id) VALUES (p_user_id) RETURNING id INTO v_cart_id;
  END IF;
  RETURN v_cart_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_cart(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_cart(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_cart(UUID) TO service_role;

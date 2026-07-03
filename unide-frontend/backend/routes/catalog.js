// ========== PUBLIC ROUTES (Frontend) ==========
// Catálogo público: productos visibles, categorías y servicios de
// reparación. Solo lectura, sin autenticación.
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';

const router = Router();

// Get products (public) - solo productos visibles en tienda
router.get('/api/products', async (req, res) => {
  try {
    const productFields = 'id,name,short_name,description,price,image,category,sub_category_id,stock,oferta,oferta_type,oferta_value,gift_product';
    let { data, error } = await supabase
      .from('products')
      .select(productFields)
      .or('visible.is.null,visible.eq.true')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (error && /short_name/i.test(error.message || '')) {
      console.warn('[GET /api/products] short_name no existe; usando fallback sin nombre corto.');
      const fallback = await supabase
        .from('products')
        .select(productFields.replace('short_name,', ''))
        .or('visible.is.null,visible.eq.true')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true });
      data = (fallback.data || []).map((p) => ({ ...p, short_name: '' }));
      error = fallback.error;
    }

    if (error) throw error;
    res.json(data);
  } catch (error) {
    const msg = error?.message || String(error);
    const cause = error?.cause?.message || error?.cause?.code || null;
    console.error('[GET /api/products] Error:', msg, cause ? `cause=${cause}` : '');
    res.status(500).json({ error: msg, cause });
  }
});

// Get categories (public)
router.get('/api/categories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sub categories (public)
router.get('/api/sub-categories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sub_categories')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get repair services (public)
router.get('/api/repair-services', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('repair_services')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

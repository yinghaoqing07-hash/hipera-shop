// =====================================================================
// Gestión del catálogo (admin): productos, categorías, subcategorías y
// servicios de reparación. CRUD directo sobre Supabase.
// =====================================================================
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = Router();

// Get all products (admin only) - incluye los no visibles
router.get('/api/admin/products', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Product management (admin only)
router.post('/api/admin/products', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const payload = { ...req.body };
    if (payload.stock === 0) payload.visible = false;
    const { data, error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/admin/reorder/products', authenticateAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase.from('products').update({ sort_order: i }).eq('id', ids[i]);
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Category management (admin only)
router.post('/api/admin/categories', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/admin/categories/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/admin/reorder/categories', authenticateAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase.from('categories').update({ sort_order: i }).eq('id', ids[i]);
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sub-category management (admin only)
router.post('/api/admin/sub-categories', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sub_categories')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/admin/sub-categories/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('sub_categories')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/admin/reorder/sub-categories', authenticateAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase.from('sub_categories').update({ sort_order: i }).eq('id', ids[i]);
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Repair service management (admin only). Solo marca, modelo, descripción; el resto se rellena por defecto.
router.post('/api/admin/repair-services', authenticateAdmin, async (req, res) => {
  try {
    const { brand, model, description } = req.body;
    const fallbackTitle = `${brand || ''} ${model || ''}`.trim() || 'Modelo';
    const payload = {
      brand: brand || '',
      model: model || '',
      description: description || 'Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO.',
      title: req.body.title != null ? req.body.title : fallbackTitle,
      repair_type: req.body.repair_type != null ? req.body.repair_type : '',
      price: req.body.price != null ? Number(req.body.price) : 0
    };
    const { data, error } = await supabase
      .from('repair_services')
      .insert([payload])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/admin/repair-services/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('repair_services')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/admin/repair-services/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('repair_services')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

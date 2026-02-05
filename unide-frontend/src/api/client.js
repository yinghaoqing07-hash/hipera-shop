import { supabase } from '../supabaseClient';

const RAILWAY_API = 'https://hipera-shop-production.up.railway.app/api';

function getBase() {
  if (import.meta.env.PROD) return null; // prod: same-origin /api (Vercel proxy → Railway)
  const v = import.meta.env.VITE_API_URL;
  if (v && typeof v === 'string' && v.startsWith('http')) {
    const u = v.replace(/\/$/, '');
    return u.endsWith('/api') ? u : u + '/api';
  }
  return RAILWAY_API;
}

const base = getBase();
const FETCH_TIMEOUT_MS = 30000; // 30s – evita colgar en móvil / cold start

if (!import.meta.env.PROD) console.log('🔧 API base:', base || 'same-origin /api');

function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

class ApiClient {
  constructor() {
    this.baseURL = base;
  }

  _url(endpoint) {
    const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    if (import.meta.env.PROD) return `/api/${path}`;
    const b = (this.baseURL || RAILWAY_API).replace(/\/$/, '') + '/';
    try {
      return new URL(path, b).href;
    } catch {
      return RAILWAY_API.replace(/\/$/, '') + '/' + path;
    }
  }

  /** Simple GET (no Content-Type/Authorization) → no preflight; use for public APIs when CORS preflight fails. */
  async requestSimple(endpoint) {
    const url = this._url(endpoint);
    try {
      const response = await fetchWithTimeout(url, { method: 'GET' });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const hint = contentType.includes('text/html') ? ' (404 o error; compruebe /api)' : '';
        throw new Error(`Unexpected response type: ${contentType}${hint}`);
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed ${response.status}`);
      return data;
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'Tiempo de espera agotado (30 s). Compruebe conexión o reintente.' : e.message;
      console.error('API Error:', msg);
      console.error('Failed URL:', url);
      throw new Error(msg);
    }
  }

  async request(endpoint, options = {}) {
    const url = this._url(endpoint);
    const token = await this.getToken();
    if (!token && endpoint.includes('/admin/')) {
      throw new Error('Sesión expirada. Cierra sesión y vuelve a iniciar sesión en /login');
    }

    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    };

    try {
      const response = await fetchWithTimeout(url, config);
      const contentType = response.headers.get('content-type') || '';

      if (!contentType.includes('application/json')) {
        const hint = contentType.includes('text/html')
          ? ' (suele ser 404 o página de error; compruebe que la URL base incluya /api)'
          : '';
        throw new Error(`Unexpected response type: ${contentType}${hint}`);
      }

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data?.error;
        const str = typeof errMsg === 'string' ? errMsg : (errMsg?.message || JSON.stringify(errMsg) || `Request failed ${response.status}`);
        throw new Error(str);
      }

      return data;
    } catch (error) {
      const msg = error.name === 'AbortError' ? 'Tiempo de espera agotado (30 s). Compruebe conexión o reintente.' : (error.message || 'API error');
      console.error('API Error:', msg);
      console.error('Failed URL:', url);
      throw new Error(msg);
    }
  }

  async getToken() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    } catch (e) {
      console.warn('Error getting token:', e);
      return null;
    }
  }

  // Public endpoints (simple GET → no preflight, avoids CORS preflight issues)
  async getProducts() {
    return this.requestSimple('/products');
  }

  async getCategories() {
    return this.requestSimple('/categories');
  }

  async getSubCategories() {
    return this.requestSimple('/sub-categories');
  }

  async getRepairServices() {
    return this.requestSimple('/repair-services');
  }

  async createOrder(orderData) {
    return this.request('/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
  }

  async getUserOrders(userId) {
    return this.request(`/orders/user/${userId}`);
  }

  // Public: Get order by ID (for QR code lookup)
  async getOrderById(orderId) {
    return this.requestSimple(`/orders/${orderId}`);
  }

  // Admin endpoints
  async getAdminOrders() {
    return this.request('/admin/orders');
  }

  async updateOrderStatus(orderId, status) {
    return this.request(`/admin/orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async getAdminProducts() {
    return this.request('/admin/products');
  }

  async createProduct(productData) {
    return this.request('/admin/products', {
      method: 'POST',
      body: JSON.stringify(productData),
    });
  }

  async updateProduct(productId, productData) {
    return this.request(`/admin/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(productData),
    });
  }

  async deleteProduct(productId) {
    return this.request(`/admin/products/${productId}`, {
      method: 'DELETE',
    });
  }

  async reorderProducts(ids) {
    return this.request('/admin/reorder/products', { method: 'PUT', body: JSON.stringify({ ids }) });
  }

  async createCategory(categoryData) {
    return this.request('/admin/categories', {
      method: 'POST',
      body: JSON.stringify(categoryData),
    });
  }

  async deleteCategory(categoryId) {
    return this.request(`/admin/categories/${categoryId}`, {
      method: 'DELETE',
    });
  }

  async reorderCategories(ids) {
    return this.request('/admin/reorder/categories', { method: 'PUT', body: JSON.stringify({ ids }) });
  }

  async createSubCategory(subCategoryData) {
    return this.request('/admin/sub-categories', {
      method: 'POST',
      body: JSON.stringify(subCategoryData),
    });
  }

  async deleteSubCategory(subCategoryId) {
    return this.request(`/admin/sub-categories/${subCategoryId}`, {
      method: 'DELETE',
    });
  }

  async reorderSubCategories(ids) {
    return this.request('/admin/reorder/sub-categories', { method: 'PUT', body: JSON.stringify({ ids }) });
  }

  async createRepairService(repairData) {
    return this.request('/admin/repair-services', {
      method: 'POST',
      body: JSON.stringify(repairData),
    });
  }

  async updateRepairService(repairId, repairData) {
    return this.request(`/admin/repair-services/${repairId}`, {
      method: 'PUT',
      body: JSON.stringify(repairData),
    });
  }

  async deleteRepairService(repairId) {
    return this.request(`/admin/repair-services/${repairId}`, {
      method: 'DELETE',
    });
  }

  /** AI: remove.bg 去背，传入图片 URL，返回 { image_url } */
  async removeBg(imageUrl) {
    return this.request('/admin/remove-bg', {
      method: 'POST',
      body: JSON.stringify({ image_url: imageUrl }),
    });
  }

  /** AI: OpenAI 根据图片提取商品信息（重量、数量、配料等），支持多张图片，返回 { description, productInfo } */
  async generateDescription(imageUrls) {
    // 支持单个 URL 或数组
    const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
    return this.request('/admin/generate-description', {
      method: 'POST',
      body: JSON.stringify({ image_urls: urls }),
    });
  }

  /** AI: 将商品居中到图片中心，传入图片 URL，返回 { image_url } */
  async centerProduct(imageUrl) {
    return this.request('/admin/center-product', {
      method: 'POST',
      body: JSON.stringify({ image_url: imageUrl }),
    });
  }
}

export const apiClient = new ApiClient();

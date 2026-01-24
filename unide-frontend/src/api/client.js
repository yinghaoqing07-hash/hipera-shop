// 生产环境唯一 API 基地址（Railway）
const PROD_BASE = 'https://hipera-shop-production.up.railway.app/api';

function getBase() {
  if (import.meta.env.PROD) return PROD_BASE;
  const v = import.meta.env.VITE_API_URL;
  if (v && typeof v === 'string' && v.startsWith('http')) {
    const u = v.replace(/\/$/, '');
    return u.endsWith('/api') ? u : u + '/api';
  }
  return PROD_BASE;
}

const base = getBase();
if (!import.meta.env.PROD) console.log('🔧 API base:', base);

class ApiClient {
  constructor() {
    this.baseURL = base;
  }

  /** 用 URL 构造函数生成绝对 https 地址，避免相对路径请求到前端 */
  _url(endpoint) {
    const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const b = (import.meta.env.PROD ? PROD_BASE : this.baseURL).replace(/\/$/, '') + '/';
    try {
      return new URL(path, b).href;
    } catch {
      return PROD_BASE.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
    }
  }

  /** Simple GET (no Content-Type/Authorization) → no preflight; use for public APIs when CORS preflight fails. */
  async requestSimple(endpoint) {
    const url = this._url(endpoint);
    try {
      const response = await fetch(url, { method: 'GET' });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const hint = contentType.includes('text/html') ? ' (404 o error; compruebe /api)' : '';
        throw new Error(`Unexpected response type: ${contentType}${hint}`);
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed ${response.status}`);
      return data;
    } catch (e) {
      console.error('API Error:', e);
      console.error('Failed URL:', url);
      throw e;
    }
  }

  async request(endpoint, options = {}) {
    const url = this._url(endpoint);
    const token = this.getToken();

    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      const contentType = response.headers.get('content-type') || '';

      if (!contentType.includes('application/json')) {
        const hint = contentType.includes('text/html')
          ? ' (suele ser 404 o página de error; compruebe que la URL base incluya /api)'
          : '';
        throw new Error(`Unexpected response type: ${contentType}${hint}`);
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      console.error('Failed URL:', url);
      throw error;
    }
  }

  getToken() {
    // Get token from Supabase session
    // Try multiple methods to get the token
    try {
      // Method 1: Try Supabase localStorage key
      const supabaseKey = `sb-${import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0]}-auth-token`;
      const sessionData = localStorage.getItem(supabaseKey);
      if (sessionData) {
        const session = JSON.parse(sessionData);
        return session?.access_token || null;
      }
      
      // Method 2: Try common Supabase storage key pattern
      const keys = Object.keys(localStorage).filter(key => key.includes('supabase.auth.token'));
      if (keys.length > 0) {
        const session = JSON.parse(localStorage.getItem(keys[0]) || '{}');
        return session?.access_token || null;
      }
    } catch (e) {
      console.warn('Error getting token:', e);
    }
    return null;
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

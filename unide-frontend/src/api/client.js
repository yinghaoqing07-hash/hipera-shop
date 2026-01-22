// API Client for backend communication
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

class ApiClient {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
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
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
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

  // Public endpoints
  async getProducts() {
    return this.request('/products');
  }

  async getCategories() {
    return this.request('/categories');
  }

  async getSubCategories() {
    return this.request('/sub-categories');
  }

  async getRepairServices() {
    return this.request('/repair-services');
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
}

export const apiClient = new ApiClient();

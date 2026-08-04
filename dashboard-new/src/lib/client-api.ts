"use client"

const API_BASE = ""

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    logout: () => request("/api/auth/logout", { method: "POST" }),
  },
  stats: {
    getReal: () => request("/api/admin/stats/real"),
  },
  settings: {
    get: () => request("/api/admin/settings"),
    update: (data: Record<string, any>) =>
      request("/api/admin/settings", { method: "POST", body: JSON.stringify(data) }),
  },
  knowledge: {
    list: (type?: string) =>
      request(`/api/admin/knowledge${type ? `?type=${type}` : ""}`),
    getBusinessInfo: () => request("/api/admin/knowledge/business-info"),
    create: (data: any) =>
      request("/api/admin/knowledge", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request(`/api/admin/knowledge/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/api/admin/knowledge/${id}`, { method: "DELETE" }),
    upload: (formData: FormData) =>
      fetch("/api/admin/knowledge/upload", { method: "POST", body: formData }).then((r) => r.json()),
    reindex: () =>
      request("/api/admin/knowledge/reindex", { method: "POST" }),
  },
  customers: {
    list: () => request("/api/admin/customers"),
  },
  orders: {
    list: () => request("/api/admin/orders"),
    updateStatus: (id: string, status: string) =>
      request(`/api/admin/orders/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      }),
  },
  products: {
    list: (params?: { category?: string; isActive?: boolean; search?: string }) => {
      const q = new URLSearchParams()
      if (params?.category) q.set("category", params.category)
      if (params?.isActive !== undefined) q.set("isActive", String(params.isActive))
      if (params?.search) q.set("search", params.search)
      const qs = q.toString()
      return request(`/api/admin/products${qs ? `?${qs}` : ""}`)
    },
    get: (id: string) => request(`/api/admin/products/${id}`),
    create: (data: any) =>
      request("/api/admin/products", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request(`/api/admin/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/api/admin/products/${id}`, { method: "DELETE" }),
    restore: (id: string) =>
      request(`/api/admin/products/${id}/restore`, { method: "PUT" }),
  },
  conversations: {
    list: () => request("/api/admin/conversations"),
    messages: (uid: string) => request(`/api/admin/messages/${uid}`),
    reply: (uid: string, message: string, platform: string) =>
      request("/api/admin/reply", {
        method: "POST",
        body: JSON.stringify({ uid, message, platform }),
      }),
  },
  analytics: {
    conversations: (days: number = 7) =>
      request(`/api/admin/analytics/conversations?days=${days}`),
  },
  aiPerformance: {
    get: (days: number = 30) =>
      request(`/api/admin/ai-performance?days=${days}`),
    feedbackStats: (days: number = 30) =>
      request(`/api/admin/feedback/stats?days=${days}`),
  },
  ads: {
    performance: (days: number = 30) =>
      request(`/api/admin/ads?days=${days}`),
    stats: (days: number = 30) =>
      request(`/api/admin/ads/stats?days=${days}`),
    clicks: (limit: number = 50) =>
      request(`/api/admin/ads/clicks?limit=${limit}`),
    create: (data: any) =>
      request("/api/admin/ads", { method: "POST", body: JSON.stringify(data) }),
    updateStatus: (adId: string, status: string) =>
      request(`/api/admin/ads/${adId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    delete: (adId: string) =>
      request(`/api/admin/ads/${adId}`, { method: "DELETE" }),
  },
  integrations: {
    get: () => request("/api/admin/integrations"),
    connectShopify: (data: { storeUrl: string; accessToken: string }) =>
      request("/api/admin/integrations/shopify", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    connectWoo: (data: { storeUrl: string; consumerKey: string; consumerSecret: string }) =>
      request("/api/admin/integrations/woocommerce", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request(`/api/admin/integrations/${id}`, { method: "DELETE" }),
  },
  team: {
    list: () => request("/api/admin/team"),
    invite: (data: { username: string; password: string; role?: string }) =>
      request("/api/admin/team/invite", { method: "POST", body: JSON.stringify(data) }),
    remove: (id: string) =>
      request(`/api/admin/team/${id}`, { method: "DELETE" }),
  },
}

import axios from "axios"

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000"

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("admin_token")
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export const apiService = {
  async login(username: string, password: string) {
    const { data } = await api.post("/api/auth/login", { username, password })
    return data
  },

  async getStats() {
    const { data } = await api.get("/api/admin/stats/real")
    return data
  },

  async getConversations() {
    const { data } = await api.get("/api/admin/conversations")
    return data
  },

  async getMessages(uid: string) {
    const { data } = await api.get(`/api/admin/messages/${uid}`)
    return data
  },

  async sendReply(uid: string, text: string, platform: string) {
    const { data } = await api.post("/api/admin/reply", { uid, message: text, platform })
    return data
  },

  async getCustomers() {
    const { data } = await api.get("/api/admin/customers")
    return data
  },

  async getOrders() {
    const { data } = await api.get("/api/admin/orders")
    return data
  },

  async getSettings() {
    const { data } = await api.get("/api/admin/settings")
    return data
  },

  async updateSettings(settings: any) {
    const { data } = await api.post("/api/admin/settings", settings)
    return data
  },

  async getIntegrations() {
    const { data } = await api.get("/api/admin/integrations")
    return data
  },

  async updateIntegration(type: string, data: any) {
    const { data: result } = await api.post(`/api/admin/integrations/${type}`, data)
    return result
  },

  async getKnowledgeBase() {
    const { data } = await api.get("/api/admin/knowledge")
    return data
  },

  async createKnowledgeEntry(data: any) {
    const { data: result } = await api.post("/api/admin/knowledge", data)
    return result
  },

  async deleteKnowledgeEntry(id: string) {
    const { data } = await api.delete(`/api/admin/knowledge/${id}`)
    return data
  },

  async reindexKnowledge() {
    const { data } = await api.post("/api/admin/knowledge/reindex")
    return data
  },

  async submitFeedback(data: any) {
    const { data: result } = await api.post("/api/admin/feedback", data)
    return result
  },

  async getFeedbackStats(days?: number) {
    const { data } = await api.get("/api/admin/feedback/stats", { params: { days } })
    return data
  },

  async getConversationAnalytics(days?: number) {
    const { data } = await api.get("/api/admin/analytics/conversations", { params: { days } })
    return data
  },

  async getAIPerformance(days?: number) {
    const { data } = await api.get("/api/admin/ai-performance", { params: { days } })
    return data
  },

  async getAdPerformance(days?: number) {
    const { data } = await api.get("/api/admin/ads", { params: { days } })
    return data
  },

  async getAdStats(days?: number) {
    const { data } = await api.get("/api/admin/ads/stats", { params: { days } })
    return data
  },

  async getAdClicks(limit?: number) {
    const { data } = await api.get("/api/admin/ads/clicks", { params: { limit } })
    return data
  },

  async createOrUpdateAd(data: any) {
    const { data: result } = await api.post("/api/admin/ads", data)
    return result
  },

  async updateAdStatus(adId: string, status: string) {
    const { data } = await api.patch(`/api/admin/ads/${adId}/status`, { status })
    return data
  },

  async deleteAd(adId: string) {
    const { data } = await api.delete(`/api/admin/ads/${adId}`)
    return data
  },
}

export default api

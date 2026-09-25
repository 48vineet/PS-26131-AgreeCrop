import axios from 'axios'
import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add auth token and the selected interface language to every request
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  config.headers['Accept-Language'] = localStorage.getItem('language') || 'en'
  return config
})

// API methods
export const apiService = {
  // Health check
  health: () => api.get('/health'),

  // Prediction
  predict: (formData) => api.post('/predict', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),

  // Profile
  getProfile: () => api.get('/profile/me'),
  updateProfile: (data) => api.put('/profile/me', data),
  updateLanguage: (language) => api.patch('/profile/language', { language }),

  // Farms
  getFarms: () => api.get('/profile/farms'),
  createFarm: (data) => api.post('/profile/farms', data),
  getFarm: (id) => api.get(`/profile/farms/${id}`),
  updateFarm: (id, data) => api.put(`/profile/farms/${id}`, data),
  deleteFarm: (id) => api.delete(`/profile/farms/${id}`),

  // Crops
  getCrops: (farmId) => api.get(`/profile/farms/${farmId}/crops`),
  createCrop: (farmId, data) => api.post(`/profile/farms/${farmId}/crops`, data),
  getCrop: (farmId, cropId) => api.get(`/profile/farms/${farmId}/crops/${cropId}`),
  updateCrop: (farmId, cropId, data) => api.put(`/profile/farms/${farmId}/crops/${cropId}`, data),
  deleteCrop: (farmId, cropId) => api.delete(`/profile/farms/${farmId}/crops/${cropId}`),

  // Screenings
  getScreenings: (params) => api.get('/screenings', { params }),
  getScreening: (id) => api.get(`/screenings/${id}`),

  // Pest observations
  getPestObservations: (params) => api.get('/pest/observations', { params }),
  createPestObservation: (data) => api.post('/pest/observations', data),

  // Weather
  getWeather: (farmId) => api.get('/weather', { params: { farm_id: farmId } }),

  // Risk assessment
  getRiskAssessment: (farmId, cropId) => api.get('/risk', {
    params: { farm_id: farmId, crop_id: cropId }
  }),

  // Geospatial
  getDiseaseHotspots: (params) => api.get('/geo/hotspots', { params }),
  getNearbyObservations: (params) => api.get('/geo/nearby', { params }),

  // Validation
  getPendingValidations: (params) => api.get('/validation/pending', { params }),
  validateObservation: (id, data) => api.post(`/validation/${id}`, data),

  // Advisories
  getAdvisories: (params) => api.get('/advisories', { params }),
  getAdvisory: (id) => api.get(`/advisories/${id}`),

  // Monitoring
  getFieldConfirmations: (params) => api.get('/confirmation/observations', { params }),
  createFieldConfirmation: (data) => api.post('/confirmation', data),

  // Notifications
  getNotifications: () => api.get('/notifications'),
  markNotificationRead: (id) => api.put(`/notifications/${id}/read`),

  // Analytics (for officials)
  getAnalytics: (params) => api.get('/official/analytics', { params }),
  getSurveillanceStats: (params) => api.get('/official/surveillance', { params }),
}

export default api

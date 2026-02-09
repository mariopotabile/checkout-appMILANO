// src/app/analytics/page.tsx
"use client"

import { useEffect, useState } from "react"
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts'

type DashboardData = {
  totalPurchases: number
  totalRevenue: number
  avgOrderValue: number
  uniqueCustomers: number
  byCampaign: Array<{
    campaign: string
    source: string
    medium: string
    purchases: number
    revenue: number
    orders?: Array<{
      orderNumber: string
      value: number
      timestamp: string
      adSet?: string | null
      adName?: string | null
    }>
  }>
  bySource: Array<{
    source: string
    purchases: number
    revenue: number
  }>
  byAd: Array<{
    adId: string
    campaign: string
    source: string
    purchases: number
    revenue: number
  }>
  byProduct: Array<{
    title: string
    quantity: number
    revenue: number
    orders: number
  }>
  byCampaignDetail: Array<{
    campaign: string
    source: string
    medium: string
    totalRevenue: number
    totalOrders: number
    cpa: number
    orders: Array<{
      orderNumber: string
      orderId: string
      sessionId: string
      value: number
      timestamp: string
      adSet: string | null
      adName: string | null
      campaignId: string | null
      adsetId: string | null
      adId: string | null
      fbclid: string | null
      gclid: string | null
      customer: string | null
      items: Array<any>
    }>
  }>
  recentPurchases: Array<any>
  dailyRevenue: Array<{
    date: string
    revenue: number
  }>
  hourlyRevenue: Array<{
    hour: number
    revenue: number
  }>
  comparison: {
    purchases: number
    revenue: number
    avgOrderValue: number
    purchasesDiff: number
    revenueDiff: number
    avgOrderDiff: number
    purchasesPercent: number
    revenuePercent: number
  } | null
}

type Insight = {
  type: 'success' | 'warning' | 'info' | 'danger'
  title: string
  message: string
  action?: string
  icon: string
}

const COLORS = {
  facebook: '#1877F2',
  google: '#EA4335',
  instagram: '#E4405F',
  tiktok: '#000000',
  direct: '#6B7280',
  email: '#7C3AED',
  organic: '#10B981',
  test: '#F59E0B',
}

const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [darkMode, setDarkMode] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [showComparison, setShowComparison] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [notification, setNotification] = useState<string | null>(null)
  const [insights, setInsights] = useState<Insight[]>([])
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set())
  
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  })
  
  const [compareRange, setCompareRange] = useState({
    start: '',
    end: ''
  })

  const calculateAdvancedKPIs = (data: DashboardData) => {
    if (!data) return null

    const repeatRate = data.totalPurchases > 0 
      ? ((data.totalPurchases - data.uniqueCustomers) / data.totalPurchases) * 100 
      : 0

    const bestCampaign = [...data.byCampaign].sort((a, b) => b.revenue - a.revenue)[0]
    const worstCampaign = [...data.byCampaign].sort((a, b) => a.revenue - b.revenue)[0]

    const recentOrders = data.recentPurchases.slice(0, 7)
    const recentAOV = recentOrders.length > 0
      ? recentOrders.reduce((sum, o) => sum + (o.valueCents || o.value * 100 || 0), 0) / recentOrders.length / 100
      : 0

    const peakHour = [...(data.hourlyRevenue || [])].sort((a, b) => b.revenue - a.revenue)[0]

    const growthRate = data.comparison
      ? ((data.totalRevenue - data.comparison.revenue) / data.comparison.revenue) * 100
      : 0

    return {
      repeatRate,
      bestCampaign,
      worstCampaign,
      recentAOV,
      aovTrend: recentAOV > data.avgOrderValue ? 'up' : 'down',
      peakHour,
      growthRate,
      totalCustomerValue: data.uniqueCustomers > 0 ? data.totalRevenue / data.uniqueCustomers : 0,
    }
  }

  const generateInsights = (data: DashboardData, kpis: any): Insight[] => {
    const insights: Insight[] = []
    if (!data || !kpis) return insights

    if (kpis.repeatRate > 30) {
      insights.push({
        type: 'success',
        icon: '🎉',
        title: 'Ottima Retention!',
        message: `${kpis.repeatRate.toFixed(0)}% di clienti ripetuti. I tuoi prodotti piacciono!`,
        action: 'Investi in email marketing per fidelizzazione'
      })
    } else if (kpis.repeatRate < 15) {
      insights.push({
        type: 'warning',
        icon: '⚠️',
        title: 'Bassa Retention',
        message: `Solo ${kpis.repeatRate.toFixed(0)}% di clienti ripetuti.`,
        action: 'Implementa programmi fedeltà e follow-up email'
      })
    }

    if (kpis.growthRate > 20) {
      insights.push({
        type: 'success',
        icon: '📈',
        title: 'Crescita Esplosiva!',
        message: `Revenue cresciuta del ${kpis.growthRate.toFixed(0)}% rispetto al periodo precedente.`,
        action: 'Scala il budget sulle campagne vincenti'
      })
    } else if (kpis.growthRate < -10) {
      insights.push({
        type: 'danger',
        icon: '📉',
        title: 'Revenue in Calo',
        message: `Revenue calata del ${Math.abs(kpis.growthRate).toFixed(0)}%.`,
        action: 'Rivedi targeting e creative delle campagne'
      })
    }

    if (kpis.bestCampaign && kpis.bestCampaign.revenue > data.totalRevenue * 0.3) {
      insights.push({
        type: 'info',
        icon: '🚀',
        title: 'Campagna Star',
        message: `"${kpis.bestCampaign.campaign}" genera il ${((kpis.bestCampaign.revenue / data.totalRevenue) * 100).toFixed(0)}% del revenue.`,
        action: 'Duplica questa campagna con budget maggiorato'
      })
    }

    if (kpis.worstCampaign && kpis.worstCampaign.purchases > 0 && kpis.worstCampaign.revenue < data.totalRevenue * 0.05) {
      insights.push({
        type: 'warning',
        icon: '💡',
        title: 'Campagna Sottoperformante',
        message: `"${kpis.worstCampaign.campaign}" genera solo ${formatMoney(kpis.worstCampaign.revenue)}.`,
        action: 'Considera di mettere in pausa o ottimizzare'
      })
    }

    if (kpis.aovTrend === 'up') {
      insights.push({
        type: 'success',
        icon: '💰',
        title: 'AOV in Crescita',
        message: `Valore medio ordine recente: ${formatMoney(kpis.recentAOV)} (media: ${formatMoney(data.avgOrderValue)})`,
        action: 'Upselling funziona! Continua con bundle e cross-sell'
      })
    }

    if (kpis.peakHour) {
      insights.push({
        type: 'info',
        icon: '⏰',
        title: 'Orario di Punta',
        message: `Massimo revenue alle ${kpis.peakHour.hour}:00 (${formatMoney(kpis.peakHour.revenue)})`,
        action: 'Programma ads e email in questa fascia oraria'
      })
    }

    const dominantSource = data.bySource[0]
    if (dominantSource && dominantSource.revenue > data.totalRevenue * 0.7) {
      insights.push({
        type: 'warning',
        icon: '🎯',
        title: 'Troppa Dipendenza',
        message: `${dominantSource.source} rappresenta il ${((dominantSource.revenue / data.totalRevenue) * 100).toFixed(0)}% del revenue.`,
        action: 'Diversifica su altre fonti di traffico per ridurre rischio'
      })
    }

    return insights
  }

  const getDateRange = (days: number) => {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    
    const start = new Date()
    start.setDate(start.getDate() - days + 1)
    start.setHours(0, 0, 0, 0)
    
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    }
  }

  const applyQuickFilter = (type: 'today' | 'yesterday' | '7days' | '14days' | '30days' | 'all') => {
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    
    let range = { start: '', end: '' }
    
    switch(type) {
      case 'today':
        range = {
          start: today.toISOString().split('T')[0],
          end: today.toISOString().split('T')[0]
        }
        showNotification('📅 Filtro: Oggi')
        break
      
      case 'yesterday':
        range = {
          start: yesterday.toISOString().split('T')[0],
          end: yesterday.toISOString().split('T')[0]
        }
        showNotification('📅 Filtro: Ieri')
        break
      
      case '7days':
        range = getDateRange(7)
        showNotification('📅 Filtro: Ultimi 7 giorni')
        break
      
      case '14days':
        range = getDateRange(14)
        showNotification('📅 Filtro: Ultimi 14 giorni')
        break
      
      case '30days':
        range = getDateRange(30)
        showNotification('📅 Filtro: Ultimi 30 giorni')
        break

      case 'all':
        range = { start: '', end: '' }
        showNotification('📅 Filtro: Tutto il periodo')
        break
    }
    
    setDateRange(range)
    setTimeout(() => loadDataWithRange(range), 100)
  }

  const loadDataWithRange = async (customRange?: { start: string, end: string }) => {
    try {
      const range = customRange || dateRange
      
      let url = '/api/analytics/dashboard?limit=1000'
      
      if (range.start) url += `&startDate=${range.start}`
      if (range.end) url += `&endDate=${range.end}`
      
      if (showComparison && compareRange.start && compareRange.end) {
        url += `&compareStartDate=${compareRange.start}&compareEndDate=${compareRange.end}`
      }
      
      const res = await fetch(url)
      const json = await res.json()
      
      if (data && json.totalPurchases > data.totalPurchases) {
        const diff = json.totalPurchases - data.totalPurchases
        showNotification(`🎉 ${diff} ${diff === 1 ? 'nuovo ordine' : 'nuovi ordini'}!`)
      }
      
      setData(json)
      
      const kpis = calculateAdvancedKPIs(json)
      if (kpis) {
        const newInsights = generateInsights(json, kpis)
        setInsights(newInsights)
      }
      
      setLastUpdate(new Date())
    } catch (err) {
      console.error('❌ Errore caricamento dashboard:', err)
      showNotification('❌ Errore caricamento dati')
    }
    setLoading(false)
  }

  const loadData = async (showNotif = false) => {
    await loadDataWithRange()
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    
    const interval = setInterval(() => {
      loadData(true)
    }, 30000)
    
    return () => clearInterval(interval)
  }, [autoRefresh, dateRange, compareRange, showComparison, data])

  const showNotification = (message: string) => {
    setNotification(message)
    setTimeout(() => setNotification(null), 4000)
  }

  const exportCSV = () => {
    if (!data) return
    
    const rows = [
      [
        'Ordine', 
        'Data', 
        'Valore', 
        'Campagna', 
        'Sorgente', 
        'Campaign ID',
        'Ad Set ID',
        'Ad Set Name', 
        'Ad ID',
        'Ad Name', 
        'fbclid',
        'gclid',
        'Email', 
        'Prodotti'
      ],
      ...data.recentPurchases.map((p: any) => [
        p.shopifyOrderNumber || p.orderNumber || '',
        p.timestamp || '',
        (p.valueCents || p.value * 100 || 0) / 100,
        p.utm?.campaign || 'direct',
        p.utm?.source || 'direct',
        p.utm?.campaign_id || '',
        p.utm?.adset_id || '',
        p.utm?.adset_name || '',
        p.utm?.ad_id || '',
        p.utm?.ad_name || '',
        p.utm?.fbclid || '',
        p.utm?.gclid || '',
        p.customer?.email || '',
        p.items?.map((i: any) => `${i.title} x${i.quantity}`).join('; ') || ''
      ])
    ]
    
    const csv = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `oltre_analytics_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    
    showNotification('📥 CSV scaricato!')
  }

  const formatMoney = (value: number) => {
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
    }).format(value)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  const formatShortDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short'
    })
  }

  const getSourceBadgeColor = (source: string) => {
    return COLORS[source.toLowerCase() as keyof typeof COLORS] || COLORS.direct
  }

  const renderTrend = (current: number, previous: number) => {
    if (previous === 0) return null
    const percent = ((current - previous) / previous) * 100
    const isPositive = percent >= 0
    
    return (
      <span className={`text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
        {isPositive ? '↑' : '↓'} {Math.abs(percent).toFixed(1)}%
      </span>
    )
  }

  const getInsightColor = (type: string) => {
    switch(type) {
      case 'success': return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
      case 'warning': return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300'
      case 'danger': return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
      default: return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300'
    }
  }

  const toggleCampaign = (campaign: string) => {
    const newExpanded = new Set(expandedCampaigns)
    if (newExpanded.has(campaign)) {
      newExpanded.delete(campaign)
    } else {
      newExpanded.add(campaign)
    }
    setExpandedCampaigns(newExpanded)
  }

  if (loading) {
    return (
      <div className={`min-h-screen ${darkMode ? 'bg-gray-900' : 'bg-gray-50'} flex items-center justify-center`}>
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className={darkMode ? 'text-gray-300' : 'text-gray-600'}>Caricamento analytics...</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={`min-h-screen ${darkMode ? 'bg-gray-900' : 'bg-gray-50'} flex items-center justify-center`}>
        <div className="text-center">
          <p className={darkMode ? 'text-gray-300' : 'text-gray-600'}>Errore caricamento dati</p>
        </div>
      </div>
    )
  }

  const kpis = calculateAdvancedKPIs(data)

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {notification && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in-right">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3">
            <span>{notification}</span>
            <button onClick={() => setNotification(null)} className="text-white hover:text-gray-200 font-bold">✕</button>
          </div>
        </div>
      )}

      <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} border-b sticky top-0 z-40 backdrop-blur-sm bg-opacity-90`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Dashboard Analytics
              </h1>
              <p className={`text-xs sm:text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Oltre Boutique • {lastUpdate.toLocaleTimeString('it-IT')}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
                  autoRefresh ? 'bg-green-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                }`}>
                {autoRefresh ? '⚡' : '⏸️'}
                <span className="hidden sm:inline ml-1">{autoRefresh ? 'Auto' : 'Pausa'}</span>
              </button>
              <button
                onClick={exportCSV}
                className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
                  darkMode ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}>
                📥 <span className="hidden sm:inline">CSV</span>
              </button>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
                  darkMode ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}>
                {darkMode ? '☀️' : '🌙'}
              </button>
              <a
                href="https://oltreboutique.com"
                className="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs sm:text-sm font-medium">
                Vai al sito
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        
        {/* FILTRI */}
        <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg shadow-sm border p-4 sm:p-6 mb-6`}>
          <h2 className="text-lg font-semibold mb-4">🔍 Filtri e Confronto</h2>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Filtri Rapidi</label>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              {[
                { type: 'today', label: 'Oggi', icon: '📅' },
                { type: 'yesterday', label: 'Ieri', icon: '📅' },
                { type: '7days', label: '7gg', icon: '📊' },
                { type: '14days', label: '14gg', icon: '📊' },
                { type: '30days', label: '30gg', icon: '📊' },
                { type: 'all', label: 'Tutto', icon: '∞' },
              ].map((filter) => (
                <button
                  key={filter.type}
                  onClick={() => applyQuickFilter(filter.type as any)}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
                    darkMode ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}>
                  <span className="hidden sm:inline">{filter.icon} </span>
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Periodo Principale</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                  className={`flex-1 px-3 py-2 border rounded-md text-sm ${
                    darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                  }`}
                />
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                  className={`flex-1 px-3 py-2 border rounded-md text-sm ${
                    darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                  }`}
                />
              </div>
            </div>
            
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium">Periodo di Confronto</label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showComparison}
                    onChange={(e) => setShowComparison(e.target.checked)}
                    className="rounded"
                  />
                  Abilita
                </label>
              </div>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={compareRange.start}
                  onChange={(e) => setCompareRange({...compareRange, start: e.target.value})}
                  disabled={!showComparison}
                  className={`flex-1 px-3 py-2 border rounded-md text-sm ${
                    darkMode ? 'bg-gray-700 border-gray-600 text-white disabled:opacity-50' : 'bg-white border-gray-300 text-gray-900 disabled:opacity-50'
                  }`}
                />
                <input
                  type="date"
                  value={compareRange.end}
                  onChange={(e) => setCompareRange({...compareRange, end: e.target.value})}
                  disabled={!showComparison}
                  className={`flex-1 px-3 py-2 border rounded-md text-sm ${
                    darkMode ? 'bg-gray-700 border-gray-600 text-white disabled:opacity-50' : 'bg-white border-gray-300 text-gray-900 disabled:opacity-50'
                  }`}
                />
              </div>
            </div>
          </div>
          
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => loadData()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition text-sm font-medium">
              Applica Filtri
            </button>
            <button
              onClick={() => {
                setDateRange({start: '', end: ''})
                setCompareRange({start: '', end: ''})
                setShowComparison(false)
                setTimeout(() => loadData(), 100)
              }}
              className={`px-4 py-2 rounded-md transition text-sm font-medium ${
                darkMode ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}>
              Reset
            </button>
          </div>

          {(dateRange.start || dateRange.end) && (
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-xs sm:text-sm text-blue-800 dark:text-blue-300">
                📅 Periodo: {dateRange.start || '∞'} → {dateRange.end || 'oggi'}
              </p>
            </div>
          )}
        </div>

        {/* CONFRONTO PERIODI */}
        {data.comparison && showComparison && (
          <div className={`${darkMode ? 'bg-gradient-to-br from-blue-900 to-blue-800 border-blue-700' : 'bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200'} border rounded-lg p-6 mb-6 shadow-lg`}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              📊 Confronto Periodi
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className={`text-sm ${darkMode ? 'text-blue-300' : 'text-blue-700'} mb-1`}>Ordini</p>
                <p className="text-2xl font-bold">{data.totalPurchases} vs {data.comparison.purchases}</p>
                <p className={`text-sm mt-1 font-medium ${data.comparison.purchasesPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {data.comparison.purchasesPercent >= 0 ? '↑' : '↓'} {Math.abs(data.comparison.purchasesPercent).toFixed(1)}%
                  <span className="ml-1">({data.comparison.purchasesDiff >= 0 ? '+' : ''}{data.comparison.purchasesDiff})</span>
                </p>
              </div>
              <div>
                <p className={`text-sm ${darkMode ? 'text-blue-300' : 'text-blue-700'} mb-1`}>Revenue</p>
                <p className="text-2xl font-bold">{formatMoney(data.totalRevenue)}</p>
                <p className="text-sm text-gray-500">vs {formatMoney(data.comparison.revenue)}</p>
                <p className={`text-sm mt-1 font-medium ${data.comparison.revenuePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {data.comparison.revenuePercent >= 0 ? '↑' : '↓'} {Math.abs(data.comparison.revenuePercent).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className={`text-sm ${darkMode ? 'text-blue-300' : 'text-blue-700'} mb-1`}>AOV</p>
                <p className="text-2xl font-bold">{formatMoney(data.avgOrderValue)}</p>
                <p className="text-sm text-gray-500">vs {formatMoney(data.comparison.avgOrderValue)}</p>
                <p className={`text-sm mt-1 font-medium ${data.comparison.avgOrderDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {data.comparison.avgOrderDiff >= 0 ? '↑' : '↓'} {formatMoney(Math.abs(data.comparison.avgOrderDiff))}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* INSIGHTS */}
        {insights.length > 0 && (
          <div className="mb-6 sm:mb-8">
            <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4">💡 Insights e Suggerimenti</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {insights.map((insight, idx) => (
                <div 
                  key={idx} 
                  className={`${getInsightColor(insight.type)} border rounded-lg p-4`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl flex-shrink-0">{insight.icon}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm sm:text-base mb-1">{insight.title}</h3>
                      <p className="text-xs sm:text-sm mb-2 opacity-90">{insight.message}</p>
                      {insight.action && (
                        <p className="text-xs font-medium mt-2 pt-2 border-t border-current border-opacity-20">
                          💡 {insight.action}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className={`${darkMode ? 'bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700' : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'} p-4 sm:p-6 rounded-xl shadow-lg border hover:shadow-xl transition-shadow`}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className={`text-xs sm:text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Ordini Totali</p>
                <p className="text-2xl sm:text-3xl font-bold mt-2">{data.totalPurchases}</p>
                <div className="mt-2">
                  {data.comparison && renderTrend(data.totalPurchases, data.comparison.purchases)}
                </div>
              </div>
              <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
            </div>
          </div>

          <div className={`${darkMode ? 'bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700' : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'} p-4 sm:p-6 rounded-xl shadow-lg border hover:shadow-xl transition-shadow`}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className={`text-xs sm:text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Revenue</p>
                <p className="text-xl sm:text-2xl font-bold text-green-600 mt-2">{formatMoney(data.totalRevenue)}</p>
                <div className="mt-2">
                  {data.comparison && renderTrend(data.totalRevenue, data.comparison.revenue)}
                </div>
              </div>
              <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          <div className={`${darkMode ? 'bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700' : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'} p-4 sm:p-6 rounded-xl shadow-lg border hover:shadow-xl transition-shadow`}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className={`text-xs sm:text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>AOV</p>
                <p className="text-2xl sm:text-3xl font-bold mt-2">{formatMoney(data.avgOrderValue)}</p>
                <div className="mt-2 flex items-center gap-2">
                  {data.comparison && renderTrend(data.avgOrderValue, data.comparison.avgOrderValue)}
                </div>
              </div>
              <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
          </div>

          <div className={`${darkMode ? 'bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700' : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'} p-4 sm:p-6 rounded-xl shadow-lg border hover:shadow-xl transition-shadow`}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className={`text-xs sm:text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Repeat Rate</p>
                <p className="text-2xl sm:text-3xl font-bold mt-2">{kpis ? kpis.repeatRate.toFixed(0) : 0}%</p>
                <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  {data.uniqueCustomers} clienti unici
                </p>
              </div>
              <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* KPI AVANZATI */}
        {kpis && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-4 sm:p-6 rounded-lg border shadow-sm hover:shadow-md transition-shadow`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Customer LTV</h3>
                <span className="text-2xl">💎</span>
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-purple-600">{formatMoney(kpis.totalCustomerValue)}</p>
              <p className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Valore medio per cliente
              </p>
            </div>

            {kpis.bestCampaign && (
              <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-4 sm:p-6 rounded-lg border shadow-sm hover:shadow-md transition-shadow`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Top Campaign</h3>
                  <span className="text-2xl">🏆</span>
                </div>
                <p className="text-base sm:text-lg font-bold truncate">{kpis.bestCampaign.campaign}</p>
                <p className="text-xl sm:text-2xl font-bold text-green-600 mt-2">{formatMoney(kpis.bestCampaign.revenue)}</p>
                <p className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {kpis.bestCampaign.purchases} ordini
                </p>
              </div>
            )}

            {kpis.peakHour && (
              <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-4 sm:p-6 rounded-lg border shadow-sm hover:shadow-md transition-shadow`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Orario di Punta</h3>
                  <span className="text-2xl">⏰</span>
                </div>
                <p className="text-2xl sm:text-3xl font-bold">{kpis.peakHour.hour}:00</p>
                <p className="text-lg sm:text-xl font-semibold text-blue-600 mt-2">{formatMoney(kpis.peakHour.revenue)}</p>
                <p className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Massimo revenue
                </p>
              </div>
            )}
          </div>
        )}

        {/* GRAFICI */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg shadow-sm border p-4 sm:p-6`}>
            <h2 className="text-lg sm:text-xl font-semibold mb-4">📈 Revenue Giornaliera</h2>
            {data.dailyRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={data.dailyRevenue}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#E5E7EB'} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => formatShortDate(String(value))} 
                    stroke={darkMode ? '#9CA3AF' : '#6B7280'}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis stroke={darkMode ? '#9CA3AF' : '#6B7280'} tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: darkMode ? '#1F2937' : '#FFFFFF', 
                      border: `1px solid ${darkMode ? '#374151' : '#E5E7EB'}`, 
                      borderRadius: '8px'
                    }}
                    formatter={(value: any) => [formatMoney(value), 'Revenue']}
                    labelFormatter={(label: any) => formatShortDate(String(label))}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#3B82F6" fillOpacity={1} fill="url(#colorRevenue)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Nessun dato disponibile</p>
            )}
          </div>

          <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg shadow-sm border p-4 sm:p-6`}>
            <h2 className="text-lg sm:text-xl font-semibold mb-4">🥧 Revenue per Sorgente</h2>
            {data.bySource.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={data.bySource}
                    dataKey="revenue"
                    nameKey="source"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(entry: any) => `${entry.source}`}
                    labelLine={false}
                  >
                    {data.bySource.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: darkMode ? '#1F2937' : '#FFFFFF', 
                      border: `1px solid ${darkMode ? '#374151' : '#E5E7EB'}`, 
                      borderRadius: '8px'
                    }}
                    formatter={(value: any) => [formatMoney(value), 'Revenue']}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Nessun dato disponibile</p>
            )}
          </div>
        </div>

        {/* TOP CAMPAGNE BAR CHART */}
        <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg shadow-sm border p-4 sm:p-6 mb-6 sm:mb-8`}>
          <h2 className="text-lg sm:text-xl font-semibold mb-4">📊 Top Campagne</h2>
          {data.byCampaign.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.byCampaign.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#E5E7EB'} />
                <XAxis 
                  dataKey="campaign" 
                  stroke={darkMode ? '#9CA3AF' : '#6B7280'} 
                  angle={-45} 
                  textAnchor="end"
                  height={100}
                  tick={{ fontSize: 11 }}
                />
                <YAxis stroke={darkMode ? '#9CA3AF' : '#6B7280'} tick={{ fontSize: 12 }} />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: darkMode ? '#1F2937' : '#FFFFFF', 
                    border: `1px solid ${darkMode ? '#374151' : '#E5E7EB'}`, 
                    borderRadius: '8px'
                  }}
                  formatter={(value: any) => [formatMoney(value), 'Revenue']}
                />
                <Bar dataKey="revenue" fill="#3B82F6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Nessun dato disponibile</p>
          )}
        </div>

        {/* DETTAGLIO CAMPAGNE CON AD SET E AD NAME */}
        {data.byCampaignDetail && data.byCampaignDetail.length > 0 && (
          <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg shadow-sm border p-4 sm:p-6 mb-6 sm:mb-8`}>
            <h2 className="text-lg sm:text-xl font-semibold mb-4">🎯 Dettaglio Campagne e Ad Performance</h2>
            
            <div className="space-y-4">
              {data.byCampaignDetail.map((campaign, idx) => (
                <div 
                  key={idx}
                  className={`${darkMode ? 'bg-gray-750 border-gray-600' : 'bg-gray-50 border-gray-200'} border rounded-lg overflow-hidden`}
                >
                  {/* Header Campagna */}
                  <div 
                    onClick={() => toggleCampaign(campaign.campaign)}
                    className={`p-4 cursor-pointer hover:bg-opacity-80 transition ${
                      darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="font-semibold text-base">{campaign.campaign}</h3>
                          <span 
                            className="px-2 py-1 rounded text-xs font-medium text-white"
                            style={{ backgroundColor: getSourceBadgeColor(campaign.source) }}
                          >
                            {campaign.source}
                          </span>
                          {campaign.medium && (
                            <span className={`px-2 py-1 rounded text-xs ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-gray-200 text-gray-700'}`}>
                              {campaign.medium}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-6 mt-2 text-sm">
                          <span className="text-green-600 font-semibold">{formatMoney(campaign.totalRevenue)}</span>
                          <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>{campaign.totalOrders} ordini</span>
                          <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>AOV: {formatMoney(campaign.totalRevenue / campaign.totalOrders)}</span>
                        </div>
                      </div>
                      <svg 
                        className={`w-6 h-6 transition-transform ${expandedCampaigns.has(campaign.campaign) ? 'rotate-180' : ''}`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Dettaglio Ordini con Ad Set e Ad Name */}
                  {expandedCampaigns.has(campaign.campaign) && (
                    <div className={`border-t ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
                      <div className="p-4">
                        <h4 className="text-sm font-semibold mb-3">📋 Ordini ({campaign.orders.length})</h4>
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {campaign.orders.map((order, orderIdx) => (
                            <div 
                              key={orderIdx}
                              className={`p-3 rounded-lg ${
                                darkMode ? 'bg-gray-800 border border-gray-600' : 'bg-white border border-gray-200'
                              }`}
                            >
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex-1">
                                  <span className="font-mono text-sm font-semibold">#{order.orderNumber}</span>
                                  <span className="text-xs ml-2 text-gray-500">{formatDate(order.timestamp)}</span>
                                </div>
                                <span className="text-sm font-bold text-green-600">{formatMoney(order.value)}</span>
                              </div>
                              
                              {/* Parametri Ads */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs">
                                {order.adName && (
                                  <div className={`p-2 rounded ${darkMode ? 'bg-gray-700' : 'bg-blue-50'}`}>
                                    <span className="font-semibold">🎯 Ad Name:</span>
                                    <p className="mt-1 truncate">{order.adName}</p>
                                  </div>
                                )}
                                {order.adSet && (
                                  <div className={`p-2 rounded ${darkMode ? 'bg-gray-700' : 'bg-purple-50'}`}>
                                    <span className="font-semibold">📊 Ad Set:</span>
                                    <p className="mt-1 truncate">{order.adSet}</p>
                                  </div>
                                )}
                                {order.campaignId && (
                                  <div className={`p-2 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                                    <span className="font-semibold">🆔 Campaign ID:</span>
                                    <p className="mt-1 font-mono text-xs">{order.campaignId}</p>
                                  </div>
                                )}
                                {order.adsetId && (
                                  <div className={`p-2 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                                    <span className="font-semibold">🆔 AdSet ID:</span>
                                    <p className="mt-1 font-mono text-xs">{order.adsetId}</p>
                                  </div>
                                )}
                                {order.adId && (
                                  <div className={`p-2 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                                    <span className="font-semibold">🆔 Ad ID:</span>
                                    <p className="mt-1 font-mono text-xs">{order.adId}</p>
                                  </div>
                                )}
                                {order.fbclid && (
                                  <div className={`p-2 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                                    <span className="font-semibold">🔗 fbclid:</span>
                                    <p className="mt-1 font-mono text-xs truncate">{order.fbclid}</p>
                                  </div>
                                )}
                              </div>

                              {/* Prodotti */}
                              {order.items && order.items.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                                  <p className="text-xs font-semibold mb-1">Prodotti:</p>
                                  <div className="text-xs text-gray-600 dark:text-gray-400">
                                    {order.items.map((item: any, i: number) => (
                                      <span key={i}>
                                        {item.title} x{item.quantity}
                                        {i < order.items.length - 1 && ', '}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TOP PRODOTTI */}
        {data.byProduct && data.byProduct.length > 0 && (
          <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg shadow-sm border p-4 sm:p-6 mb-6 sm:mb-8`}>
            <h2 className="text-lg sm:text-xl font-semibold mb-4">🏆 Top Prodotti</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={darkMode ? 'bg-gray-700' : 'bg-gray-100'}>
                  <tr>
                    <th className="text-left p-3 rounded-tl-lg">Prodotto</th>
                    <th className="text-right p-3">Quantità</th>
                    <th className="text-right p-3">Ordini</th>
                    <th className="text-right p-3 rounded-tr-lg">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProduct.slice(0, 10).map((product, idx) => (
                    <tr key={idx} className={`border-t ${darkMode ? 'border-gray-700 hover:bg-gray-750' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <td className="p-3 font-medium">{product.title}</td>
                      <td className="p-3 text-right">{product.quantity}</td>
                      <td className="p-3 text-right">{product.orders}</td>
                      <td className="p-3 text-right font-semibold text-green-600">{formatMoney(product.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ULTIMI ORDINI */}
        {data.recentPurchases && data.recentPurchases.length > 0 && (
          <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg shadow-sm border p-4 sm:p-6 mb-6 sm:mb-8`}>
            <h2 className="text-lg sm:text-xl font-semibold mb-4">📦 Ultimi Ordini</h2>
            <div className="space-y-3">
              {data.recentPurchases.slice(0, 10).map((order: any, idx: number) => (
                <div 
                  key={idx}
                  className={`p-4 rounded-lg border ${
                    darkMode ? 'bg-gray-750 border-gray-600' : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="font-mono font-semibold">#{order.shopifyOrderNumber || order.orderNumber}</span>
                      <p className="text-xs text-gray-500 mt-1">{formatDate(order.timestamp)}</p>
                    </div>
                    <span className="text-lg font-bold text-green-600">{formatMoney((order.valueCents || order.value * 100) / 100)}</span>
                  </div>
                  
                  <div className="flex gap-2 flex-wrap mb-2">
                    <span 
                      className="px-2 py-1 rounded text-xs font-medium text-white"
                      style={{ backgroundColor: getSourceBadgeColor(order.utm?.source || 'direct') }}
                    >
                      {order.utm?.source || 'Direct'}
                    </span>
                    {order.utm?.campaign && (
                      <span className={`px-2 py-1 rounded text-xs ${darkMode ? 'bg-gray-600' : 'bg-gray-200'}`}>
                        {order.utm.campaign}
                      </span>
                    )}
                  </div>

                  {order.customer?.email && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      👤 {order.customer.email}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* REVENUE ORARIA */}
        {data.hourlyRevenue && data.hourlyRevenue.length > 0 && (
          <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg shadow-sm border p-4 sm:p-6 mb-6 sm:mb-8`}>
            <h2 className="text-lg sm:text-xl font-semibold mb-4">🕐 Revenue per Ora</h2>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.hourlyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#E5E7EB'} />
                <XAxis 
                  dataKey="hour" 
                  stroke={darkMode ? '#9CA3AF' : '#6B7280'}
                  tickFormatter={(hour) => `${hour}:00`}
                  tick={{ fontSize: 12 }}
                />
                <YAxis stroke={darkMode ? '#9CA3AF' : '#6B7280'} tick={{ fontSize: 12 }} />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: darkMode ? '#1F2937' : '#FFFFFF', 
                    border: `1px solid ${darkMode ? '#374151' : '#E5E7EB'}`, 
                    borderRadius: '8px'
                  }}
                  formatter={(value: any) => [formatMoney(value), 'Revenue']}
                  labelFormatter={(hour: any) => `${hour}:00`}
                />
                <Bar dataKey="revenue" fill="#10B981" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

      </div>
    </div>
  )
}


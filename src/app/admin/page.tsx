// src/app/admin/page.tsx
"use client"

import { useEffect, useState } from 'react'

type Transaction = {
  id: string
  amount: number
  currency: string
  status: string
  created: number
  email: string
  fullName: string
  items: any[]
  orderNumber?: string
  errorCode?: string
  errorMessage?: string
  declineCode?: string
}

export default function AdminDashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [password, setPassword] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all')

  async function loadTransactions() {
    if (!password.trim()) {
      alert('Inserisci la password')
      return
    }

    try {
      setLoading(true)
      const res = await fetch('/api/admin/transactions', {
        headers: {
          'Authorization': `Bearer ${password}`
        }
      })

      if (!res.ok) {
        throw new Error('Password errata')
      }

      const data = await res.json()
      setTransactions(data.transactions)
      setAuthenticated(true)
      setLoading(false)
    } catch (err: any) {
      alert(err.message)
      setLoading(false)
    }
  }

  const formatMoney = (cents: number, currency: string) => {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100)
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getErrorLabel = (errorCode?: string, declineCode?: string) => {
    const errors: Record<string, string> = {
      card_declined: 'Carta rifiutata',
      insufficient_funds: 'Fondi insufficienti',
      expired_card: 'Carta scaduta',
      incorrect_cvc: 'CVV errato',
      incorrect_number: 'Numero carta errato',
      processing_error: 'Errore temporaneo',
      card_not_supported: 'Carta non supportata',
      fraudulent: 'Transazione fraudolenta',
      do_not_honor: 'Rifiutata dalla banca',
      generic_decline: 'Rifiutata generica',
      lost_card: 'Carta smarrita',
      stolen_card: 'Carta rubata',
    }

    if (declineCode) return errors[declineCode] || declineCode
    if (errorCode) return errors[errorCode] || errorCode
    return 'Errore sconosciuto'
  }

  const isSuccess = (tx: Transaction) => tx.status === 'succeeded'
  const isFailed = (tx: Transaction) => 
    tx.status === 'failed' || tx.errorCode || tx.declineCode

  const filteredTransactions = transactions.filter(tx => {
    if (filter === 'success') return isSuccess(tx)
    if (filter === 'failed') return isFailed(tx)
    return true
  })

  const successCount = transactions.filter(isSuccess).length
  const failedCount = transactions.filter(isFailed).length
  const successRate = transactions.length > 0 
    ? ((successCount / transactions.length) * 100).toFixed(1) 
    : '0'

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-lg border max-w-md w-full">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-600 text-sm mt-2">Inserisci la password per accedere</p>
          </div>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') loadTransactions()
            }}
          />
          <button
            onClick={loadTransactions}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Caricamento...' : 'Accedi'}
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Caricamento transazioni...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Dashboard Transazioni</h1>
            <button
              onClick={() => {
                setAuthenticated(false)
                setPassword('')
              }}
              className="text-sm text-red-600 hover:text-red-700 font-medium"
            >
              Esci
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Totale</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{transactions.length}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Successo</p>
                <p className="text-3xl font-bold text-green-600 mt-2">{successCount}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Falliti</p>
                <p className="text-3xl font-bold text-red-600 mt-2">{failedCount}</p>
              </div>
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Tasso successo</p>
                <p className="text-3xl font-bold text-blue-600 mt-2">{successRate}%</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Tutte ({transactions.length})
            </button>
            <button
              onClick={() => setFilter('success')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filter === 'success'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              ✓ Successo ({successCount})
            </button>
            <button
              onClick={() => setFilter('failed')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filter === 'failed'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              ✗ Falliti ({failedCount})
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Data
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Cliente
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Importo
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Azioni
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="text-gray-400">
                        <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                        </svg>
                        <p className="text-sm">Nessuna transazione trovata</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => {
                    const success = isSuccess(tx)
                    const failed = isFailed(tx)
                    
                    return (
                      <tr 
                        key={tx.id} 
                        className={`hover:bg-gray-50 transition ${
                          success ? 'bg-green-50' : failed ? 'bg-red-50' : ''
                        }`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{formatDate(tx.created)}</div>
                          {tx.orderNumber && (
                            <div className="text-xs text-gray-500">Ordine #{tx.orderNumber}</div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900">{tx.fullName}</div>
                          <div className="text-xs text-gray-500">{tx.email}</div>
                          {failed && (
                            <div className="mt-1 inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">
                              🚫 {getErrorLabel(tx.errorCode, tx.declineCode)}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-bold text-gray-900">
                            {formatMoney(tx.amount, tx.currency)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {success && (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                              ✓ Completato
                            </span>
                          )}
                          {failed && (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                              ✗ Fallito
                            </span>
                          )}
                          {!success && !failed && (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                              ⏳ In sospeso
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <a
                            href={`https://dashboard.stripe.com/payments/${tx.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Vedi su Stripe →
                          </a>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

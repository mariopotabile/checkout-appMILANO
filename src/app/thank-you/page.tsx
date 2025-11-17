// src/app/thank-you/page.tsx
"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"

type OrderData = {
  shopifyOrderNumber?: string
  shopifyOrderId?: string
  email?: string
  totalCents?: number
  currency?: string
}

function ThankYouContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId")

  const [orderData, setOrderData] = useState<OrderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadOrderData() {
      if (!sessionId) {
        setError("Sessione non valida")
        setLoading(false)
        return
      }

      try {
        const res = await fetch(`/api/cart-session?sessionId=${sessionId}`)
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || "Errore caricamento ordine")
        }

        setOrderData({
          shopifyOrderNumber: data.shopifyOrderNumber,
          shopifyOrderId: data.shopifyOrderId,
          email: data.customer?.email,
          totalCents: data.totalCents,
          currency: data.currency || "EUR",
        })
        setLoading(false)
      } catch (err: any) {
        console.error("Errore caricamento ordine:", err)
        setError(err.message)
        setLoading(false)
      }
    }

    loadOrderData()
  }, [sessionId])

  const homepageUrl = process.env.NEXT_PUBLIC_SHOPIFY_STORE_URL || "https://notforresale.it"

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm text-gray-600">Caricamento ordine...</p>
        </div>
      </div>
    )
  }

  if (error || !orderData) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-4">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-semibold text-gray-900">Ordine non trovato</h1>
          <p className="text-gray-600">{error}</p>
          <a
            href={homepageUrl}
            className="inline-block mt-6 px-6 py-3 bg-[#005bd3] text-white font-semibold rounded-md hover:bg-[#004db5] transition"
          >
            Torna alla homepage
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-center">
            <a href={homepageUrl}>
              <img
                src="https://cdn.shopify.com/s/files/1/0899/2188/0330/files/logo_checkify_d8a640c7-98fe-4943-85c6-5d1a633416cf.png?v=1761832152"
                alt="Logo"
                className="h-12 sm:h-16 cursor-pointer"
                style={{ maxWidth: "200px", width: "auto" }}
              />
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Success Icon */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-100 rounded-full mb-4">
            <svg
              className="w-10 h-10 text-emerald-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Grazie per il tuo ordine!
          </h1>
          <p className="text-lg text-gray-600">
            Il pagamento è stato elaborato con successo
          </p>
        </div>

        {/* Order Details Card */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-gray-200">
            <div>
              <p className="text-sm text-gray-600">Numero ordine</p>
              <p className="text-2xl font-bold text-gray-900">
                #{orderData.shopifyOrderNumber || "In elaborazione"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">Stato</p>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-emerald-100 text-emerald-800">
                ✓ Pagato
              </span>
            </div>
          </div>

          {orderData.email && (
            <div>
              <p className="text-sm text-gray-600 mb-1">Email di conferma</p>
              <p className="text-base font-medium text-gray-900">{orderData.email}</p>
              <p className="text-sm text-gray-500 mt-1">
                Ti abbiamo inviato una conferma via email con i dettagli dell'ordine
              </p>
            </div>
          )}
        </div>

        {/* Next Steps */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-blue-900 mb-3">
            📦 Cosa succede ora?
          </h2>
          <ul className="space-y-2 text-sm text-blue-800">
            <li className="flex items-start">
              <span className="mr-2">1.</span>
              <span>Riceverai un'email di conferma con tutti i dettagli dell'ordine</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">2.</span>
              <span>Il tuo ordine verrà preparato e spedito entro 1-2 giorni lavorativi</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">3.</span>
              <span>
                Riceverai un'email con il tracking quando il pacco sarà in viaggio
              </span>
            </li>
          </ul>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4">
          <a
            href={homepageUrl}
            className="flex-1 text-center px-6 py-3 bg-[#005bd3] text-white font-semibold rounded-md hover:bg-[#004db5] transition"
          >
            Torna alla homepage
          </a>
          <a
            href={homepageUrl}
            className="flex-1 text-center px-6 py-3 bg-white text-[#005bd3] font-semibold rounded-md border-2 border-[#005bd3] hover:bg-gray-50 transition"
          >
            Continua lo shopping
          </a>
        </div>

        {/* Support */}
        <div className="mt-12 text-center text-sm text-gray-600">
          <p>Hai bisogno di aiuto?</p>
          <a
            href={`${homepageUrl}/pages/contact`}
            className="text-[#005bd3] hover:underline font-medium"
          >
            Contatta il supporto
          </a>
        </div>
      </div>
    </div>
  )
}

export default function ThankYouPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
          <p className="text-sm text-gray-600">Caricamento...</p>
        </div>
      }
    >
      <ThankYouContent />
    </Suspense>
  )
}

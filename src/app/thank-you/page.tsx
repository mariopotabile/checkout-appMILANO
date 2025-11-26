// src/app/thank-you/page.tsx
"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { sendFacebookPurchaseEvent } from "@/lib/facebook-capi"

type OrderData = {
  shopifyOrderNumber?: string
  shopifyOrderId?: string
  email?: string
  subtotalCents?: number
  shippingCents?: number
  discountCents?: number
  totalCents?: number
  currency?: string
  shopDomain?: string
  rawCart?: { id?: string; token?: string }
  customer?: {
    fullName?: string
    email?: string
    phone?: string
    city?: string
    postalCode?: string
    countryCode?: string
    address1?: string
    address2?: string
    province?: string
  }
  items?: Array<{
    id: string | number
    title: string
    quantity: number
    image?: string
    variantTitle?: string
    priceCents?: number
    linePriceCents?: number
  }>
}

function ThankYouContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId")

  const [orderData, setOrderData] = useState<OrderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cartCleared, setCartCleared] = useState(false)
  const [orderSaved, setOrderSaved] = useState(false)
  const [facebookSent, setFacebookSent] = useState(false)

  const shopUrl = "https://notforresale.it"

  useEffect(() => {
    async function loadAndProcess() {
      if (!sessionId) {
        setError("Sessione non valida")
        setLoading(false)
        return
      }

      try {
        // ═══════════════════════════════════════════════════════
        // CARICA DATI ORDINE
        // ═══════════════════════════════════════════════════════
        console.log('[ThankYou] 📥 Caricamento dati ordine...')
        const res = await fetch(`/api/cart-session?sessionId=${sessionId}`)
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || "Errore caricamento ordine")
        }

        const subtotal = data.subtotalCents || 0
        const total = data.totalCents || 0
        const shipping = data.shippingCents || 590
        const discount = subtotal > 0 && total > 0 ? subtotal - (total - shipping) : 0

        const orderInfo: OrderData = {
          shopifyOrderNumber: data.shopifyOrderNumber,
          shopifyOrderId: data.shopifyOrderId,
          email: data.customer?.email,
          subtotalCents: subtotal,
          shippingCents: shipping,
          discountCents: discount > 0 ? discount : 0,
          totalCents: total + shipping,
          currency: data.currency || "EUR",
          shopDomain: data.shopDomain,
          rawCart: data.rawCart,
          customer: data.customer,
          items: data.items || [],
        }

        setOrderData(orderInfo)
        console.log('[ThankYou] ✅ Dati ordine caricati')

        // ═══════════════════════════════════════════════════════
        // SALVA ORDINE IN FIREBASE
        // ═══════════════════════════════════════════════════════
        console.log('[ThankYou] 💾 Salvataggio ordine in Firebase...')
        
        const customer = orderInfo.customer || {}
        const items = orderInfo.items || []

        const completeOrderData = {
          orderId: orderInfo.shopifyOrderId || sessionId,
          sessionId: sessionId,
          shopifyOrderId: orderInfo.shopifyOrderId || null,
          shopifyOrderNumber: orderInfo.shopifyOrderNumber || null,
          orderNumber: orderInfo.shopifyOrderNumber || sessionId.substring(0, 8),

          status: {
            payment: "paid",
            shopify: orderInfo.shopifyOrderId ? "created" : "pending",
            fulfillment: "unfulfilled",
          },

          customer: {
            fullName: customer.fullName || "",
            firstName: customer.fullName?.split(" ")[0] || "",
            lastName: customer.fullName?.split(" ").slice(1).join(" ") || "",
            email: customer.email || orderInfo.email || "",
            phone: customer.phone || "",
            
            shippingAddress: {
              address1: customer.address1 || "",
              address2: customer.address2 || "",
              city: customer.city || "",
              province: customer.province || "",
              postalCode: customer.postalCode || "",
              countryCode: customer.countryCode || "IT",
            },
          },

          items: items.map((item: any, index: number) => {
            const variantId = item.id || item.variant_id || ""
            const cleanVariantId = typeof variantId === "string" 
              ? variantId.includes("gid://") ? variantId.split("/").pop() : variantId
              : String(variantId)

            return {
              position: index + 1,
              variantId: cleanVariantId,
              title: item.title || "Prodotto",
              variantTitle: item.variantTitle || null,
              quantity: item.quantity || 1,
              priceCents: item.priceCents || 0,
              priceEuro: ((item.priceCents || 0) / 100).toFixed(2),
              linePriceCents: item.linePriceCents || 0,
              linePriceEuro: ((item.linePriceCents || 0) / 100).toFixed(2),
              image: item.image || null,
            }
          }),

          pricing: {
            subtotalCents: orderInfo.subtotalCents || 0,
            subtotalEuro: ((orderInfo.subtotalCents || 0) / 100).toFixed(2),
            shippingCents: orderInfo.shippingCents || 0,
            shippingEuro: ((orderInfo.shippingCents || 0) / 100).toFixed(2),
            discountCents: orderInfo.discountCents || 0,
            discountEuro: ((orderInfo.discountCents || 0) / 100).toFixed(2),
            totalCents: orderInfo.totalCents || 0,
            totalEuro: ((orderInfo.totalCents || 0) / 100).toFixed(2),
            currency: orderInfo.currency?.toUpperCase() || "EUR",
          },

          shopify: {
            orderId: orderInfo.shopifyOrderId || null,
            orderNumber: orderInfo.shopifyOrderNumber || null,
            orderName: orderInfo.shopifyOrderNumber ? `#${orderInfo.shopifyOrderNumber}` : null,
            orderCreated: !!orderInfo.shopifyOrderId,
            shopDomain: orderInfo.shopDomain || "",
          },

          timestamps: {
            orderCompletedAt: new Date().toISOString(),
            savedAt: new Date().toISOString(),
          },

          totals: {
            itemsCount: items.length,
            totalQuantity: items.reduce((sum: number, item: any) => sum + (item.quantity || 1), 0),
          },

          source: "thank_you_page",
        }

        // Salva in Firebase
        const saveRes = await fetch('/api/save-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: sessionId,
            orderData: completeOrderData,
          }),
        })

        if (saveRes.ok) {
          console.log('[ThankYou] ✅ Ordine salvato in Firebase')
          setOrderSaved(true)
        }

        // ═══════════════════════════════════════════════════════
        // FACEBOOK CONVERSION API
        // ═══════════════════════════════════════════════════════
        if (orderInfo.items && orderInfo.items.length > 0) {
          console.log('[ThankYou] 📊 Invio Facebook CAPI Purchase...')
          
          const fbpCookie = document.cookie.split('; ').find(row => row.startsWith('_fbp='))?.split('=')[1]
          const fbcCookie = document.cookie.split('; ').find(row => row.startsWith('_fbc='))?.split('=')[1]
          const fbclid = searchParams.get('fbclid')

          await sendFacebookPurchaseEvent({
            email: customer.email || orderInfo.email || '',
            phone: customer.phone,
            firstName: customer.fullName?.split(" ")[0],
            lastName: customer.fullName?.split(" ").slice(1).join(" "),
            city: customer.city,
            postalCode: customer.postalCode,
            country: customer.countryCode || 'IT',
            orderValue: orderInfo.totalCents || 0,
            currency: orderInfo.currency || 'EUR',
            orderItems: orderInfo.items.map(item => ({
              id: item.id.toString(),
              quantity: item.quantity
            })),
            eventSourceUrl: `${window.location.origin}/checkout?sessionId=${sessionId}`,
            clientIp: undefined,
            userAgent: navigator.userAgent,
            fbp: fbpCookie,
            fbc: fbcCookie || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined)
          })

          console.log('[ThankYou] ✅ Facebook CAPI inviato')
          setFacebookSent(true)

          // Invia anche Pixel browser-side
          if (typeof window !== 'undefined' && (window as any).fbq) {
            (window as any).fbq('track', 'Purchase', {
              content_ids: orderInfo.items.map(item => item.id),
              content_type: 'product',
              value: (orderInfo.totalCents || 0) / 100,
              currency: orderInfo.currency || 'EUR',
              num_items: orderInfo.items.reduce((sum, item) => sum + item.quantity, 0)
            })
            console.log('[ThankYou] ✅ Facebook Pixel browser-side inviato')
          }
        }

        // ═══════════════════════════════════════════════════════
        // SVUOTA CARRELLO
        // ═══════════════════════════════════════════════════════
        if (data.rawCart?.id || data.rawCart?.token) {
          const cartId = data.rawCart.id || `gid://shopify/Cart/${data.rawCart.token}`
          console.log('[ThankYou] 🧹 Svuotamento carrello...')
          
          try {
            const clearRes = await fetch('/api/clear-cart', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cartId, sessionId }),
            })

            if (clearRes.ok) {
              console.log('[ThankYou] ✅ Carrello svuotato')
              setCartCleared(true)
            }
          } catch (clearErr) {
            console.error('[ThankYou] ⚠️ Errore svuotamento:', clearErr)
          }
        }

        setLoading(false)
      } catch (err: any) {
        console.error("[ThankYou] Errore:", err)
        setError(err.message)
        setLoading(false)
      }
    }

    loadAndProcess()
  }, [sessionId, searchParams])

  const formatMoney = (cents: number | undefined) => {
    const value = (cents ?? 0) / 100
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: orderData?.currency || "EUR",
      minimumFractionDigits: 2,
    }).format(value)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900 mb-4"></div>
          <p className="text-sm text-gray-600">Caricamento ordine...</p>
        </div>
      </div>
    )
  }

  if (error || !orderData) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-6 p-8 bg-white rounded-lg shadow-sm border border-gray-200">
          <svg className="w-16 h-16 text-red-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h1 className="text-2xl font-bold text-gray-900">Ordine non trovato</h1>
          <p className="text-gray-600">{error}</p>
          <a
            href={shopUrl}
            className="inline-block mt-4 px-6 py-3 bg-gray-900 text-white font-medium rounded-md hover:bg-gray-800 transition"
          >
            Torna alla home
          </a>
        </div>
      </div>
    )
  }

  return (
    <>
      <style jsx global>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          background: #fafafa;
          color: #333333;
          -webkit-font-smoothing: antialiased;
        }
      `}</style>

      <div className="min-h-screen bg-[#fafafa]">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="flex justify-center">
              <a href={shopUrl}>
                <img
                  src="https://cdn.shopify.com/s/files/1/0899/2188/0330/files/logo_checkify_d8a640c7-98fe-4943-85c6-5d1a633416cf.png?v=1761832152"
                  alt="Logo"
                  className="h-12"
                  style={{ maxWidth: '180px' }}
                />
              </a>
            </div>
          </div>
        </header>

        <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
          
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8 mb-6">
            
            <div className="flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mx-auto mb-6">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 text-center mb-2">
              Ordine confermato
            </h1>
            <p className="text-center text-gray-600 mb-6">
              Grazie per il tuo acquisto!
            </p>

            {orderData.shopifyOrderNumber && (
              <div className="bg-gray-50 rounded-lg p-4 mb-6 text-center">
                <p className="text-sm text-gray-600 mb-1">Numero ordine</p>
                <p className="text-2xl font-bold text-gray-900">
                  #{orderData.shopifyOrderNumber}
                </p>
              </div>
            )}

            {orderData.email && (
              <div className="border-t border-gray-200 pt-6 mb-6">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-900 mb-1">
                      Conferma inviata a
                    </p>
                    <p className="text-sm text-gray-600">{orderData.email}</p>
                  </div>
                </div>
              </div>
            )}

            {orderData.items && orderData.items.length > 0 && (
              <div className="border-t border-gray-200 pt-6 mb-6">
                <h2 className="text-base font-semibold text-gray-900 mb-4">
                  Articoli acquistati
                </h2>
                <div className="space-y-4">
                  {orderData.items.map((item, idx) => (
                    <div key={idx} className="flex gap-4">
                      {item.image && (
                        <div className="w-16 h-16 flex-shrink-0 bg-gray-100 rounded border border-gray-200">
                          <img
                            src={item.image}
                            alt={item.title}
                            className="w-full h-full object-cover rounded"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {item.title}
                        </p>
                        {item.variantTitle && (
                          <p className="text-xs text-gray-500 mt-1">
                            {item.variantTitle}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">
                          Quantità: {item.quantity}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-medium text-gray-900">
                          {formatMoney(item.linePriceCents || item.priceCents || 0)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-gray-200 pt-6">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotale</span>
                  <span className="text-gray-900">{formatMoney(orderData.subtotalCents)}</span>
                </div>

                {orderData.discountCents && orderData.discountCents > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Sconto</span>
                    <span>-{formatMoney(orderData.discountCents)}</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className="text-gray-600">Spedizione</span>
                  <span className="text-gray-900">{formatMoney(orderData.shippingCents)}</span>
                </div>

                <div className="flex justify-between text-lg font-semibold pt-3 border-t border-gray-200">
                  <span>Totale</span>
                  <span className="text-xl">{formatMoney(orderData.totalCents)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 rounded-lg border border-blue-200 p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Cosa succede ora?
            </h2>
            <ul className="space-y-3 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-semibold">1.</span>
                <span>Riceverai un&apos;email di conferma con tutti i dettagli</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-semibold">2.</span>
                <span>Il tuo ordine verrà preparato entro 1-2 giorni lavorativi</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-semibold">3.</span>
                <span>Riceverai il tracking della spedizione via email</span>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <a
              href={shopUrl}
              className="block w-full py-3 px-4 bg-gray-900 text-white text-center font-medium rounded-md hover:bg-gray-800 transition"
            >
              Torna alla home
            </a>
            <a
              href={`${shopUrl}/collections/all`}
              className="block w-full py-3 px-4 bg-white text-gray-900 text-center font-medium rounded-md border border-gray-300 hover:bg-gray-50 transition"
            >
              Continua lo shopping
            </a>
          </div>

          <div className="text-center mt-8 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-600 mb-2">
              Hai bisogno di aiuto?
            </p>
            <a
              href={`${shopUrl}/pages/contatti`}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Contatta il supporto →
            </a>
          </div>

          {(cartCleared || orderSaved || facebookSent) && (
            <div className="mt-4 space-y-2">
              {orderSaved && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-xs text-green-800 text-center">
                    ✓ Backup ordine salvato
                  </p>
                </div>
              )}
              {facebookSent && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <p className="text-xs text-blue-800 text-center">
                    ✓ Conversione Facebook tracciata
                  </p>
                </div>
              )}
              {cartCleared && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-md">
                  <p className="text-xs text-purple-800 text-center">
                    ✓ Carrello svuotato
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="border-t border-gray-200 py-6 mt-12">
          <div className="max-w-6xl mx-auto px-4 text-center">
            <p className="text-xs text-gray-500">
              © 2025 Not For Resale. Tutti i diritti riservati.
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}

export default function ThankYouPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900"></div>
        </div>
      }
    >
      <ThankYouContent />
    </Suspense>
  )
}


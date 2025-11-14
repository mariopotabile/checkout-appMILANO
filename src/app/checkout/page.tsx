"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import CheckoutLayout from "../../components/CheckoutLayout"
import Summary from "../../components/Summary"

// Wrapper richiesto da Next per usare useSearchParams
export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <CheckoutLayout>
          <div className="py-20 text-center text-sm text-gray-500">
            Caricamento checkout…
          </div>
        </CheckoutLayout>
      }
    >
      <CheckoutClient />
    </Suspense>
  )
}

// Componente "client" che usa davvero useSearchParams
function CheckoutClient() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId")

  const [cart, setCart] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!sessionId) {
        setError("Sessione di checkout non valida")
        setLoading(false)
        return
      }

      try {
        const url = `/api/cart-session?sessionId=${encodeURIComponent(
          sessionId || ""
        )}`
        const res = await fetch(url)
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || "Errore nel recupero del carrello")
        }

        setCart(data.cart)
      } catch (err: any) {
        console.error("Checkout load error:", err)
        setError(err.message || "Errore sconosciuto")
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [sessionId])

  return (
    <CheckoutLayout>
      {loading ? (
        <div className="py-20 text-center text-sm text-gray-500">
          Caricamento carrello…
        </div>
      ) : error ? (
        <div className="py-20 text-center text-sm text-red-600">
          {error}
        </div>
      ) : !cart ? (
        <div className="py-20 text-center text-sm text-gray-500">
          Nessun carrello trovato.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr,1fr] gap-8 py-8">
          {/* Colonna prodotti */}
          <section className="space-y-4">
            <h1 className="text-xl font-semibold">Riepilogo prodotti</h1>
            <div className="space-y-3">
              {cart.items?.map((item: any) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 bg-white rounded-xl shadow-sm p-3"
                >
                  {item.image && (
                    <img
                      src={item.image}
                      alt={item.title}
                      className="w-16 h-16 object-cover rounded-lg border"
                    />
                  )}
                  <div className="flex-1">
                    <div className="text-sm font-medium">{item.title}</div>
                    {item.variantTitle && (
                      <div className="text-xs text-gray-500">
                        {item.variantTitle}
                      </div>
                    )}
                    <div className="text-xs text-gray-500">
                      Quantità: {item.quantity}
                    </div>
                  </div>
                  <div className="text-sm font-semibold">
                    {((item.price ?? 0) / 100).toFixed(2)} €
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Colonna riepilogo + pagamento */}
          <Summary cart={cart} />
        </div>
      )}
    </CheckoutLayout>
  )
}
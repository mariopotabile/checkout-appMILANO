"use client"

import React, { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Summary from "@/components/Summary"

type RawItem = {
  key?: string
  id?: number
  title?: string
  product_title?: string
  variant_title?: string
  quantity?: number
  price?: number        // centesimi
  line_price?: number   // centesimi
  final_price?: number
  final_line_price?: number
  discounted_price?: number
  discounted_price_set?: any
  image?: string
  sku?: string
  properties?: any
}

type NormalizedItem = {
  key: string
  title: string
  variantTitle: string
  quantity: number
  unitPriceCents: number
  linePriceCents: number
  image?: string
}

type CheckoutData = {
  sessionId: string
  currency: string
  subtotalCents: number
  items: NormalizedItem[]
}

function formatMoney(amount: number, currency: string) {
  const value = amount / 100
  return `${value.toFixed(2)} ${currency.toUpperCase()}`
}

/**
 * Normalizza la risposta di /api/cart-session in un formato coerente,
 * indipendentemente da come il backend ha salvato i dati.
 */
function normalizeSession(raw: any): CheckoutData {
  const sessionId =
    raw.sessionId ||
    raw.id ||
    raw.uid ||
    "" // tanto lo abbiamo già dalla querystring

  const currency =
    (raw.currency ||
      raw.cart?.currency ||
      raw.cart?.presentment_currency ||
      "EUR") as string

  // Sorgenti possibili per gli items
  const itemsRaw: RawItem[] =
    raw.items ||
    raw.cart?.items ||
    raw.cart?.line_items ||
    []

  // Sorgenti possibili per il subtotale in centesimi
  let subtotalCents: number | null = null

  if (typeof raw.subtotalCents === "number") {
    subtotalCents = raw.subtotalCents
  } else if (typeof raw.subtotal === "number") {
    subtotalCents = raw.subtotal
  } else if (typeof raw.cart?.items_subtotal_price === "number") {
    subtotalCents = raw.cart.items_subtotal_price
  } else if (typeof raw.cart?.total_price === "number") {
    // fallback: totale carrello
    subtotalCents = raw.cart.total_price
  }

  const normalizedItems: NormalizedItem[] = itemsRaw.map((item, index) => {
    const quantity = item.quantity ?? 1

    const linePriceCandidate =
      item.line_price ??
      item.final_line_price ??
      (typeof item.price === "number" ? item.price * quantity : undefined) ??
      (typeof item.final_price === "number"
        ? item.final_price * quantity
        : undefined)

    const unitPriceCandidate =
      item.price ??
      item.final_price ??
      (typeof linePriceCandidate === "number"
        ? Math.round(linePriceCandidate / quantity)
        : undefined)

    const linePriceCents = typeof linePriceCandidate === "number"
      ? linePriceCandidate
      : 0

    const unitPriceCents = typeof unitPriceCandidate === "number"
      ? unitPriceCandidate
      : 0

    return {
      key: item.key || String(item.id || index),
      title: item.product_title || item.title || "Articolo",
      variantTitle: item.variant_title || "",
      quantity,
      unitPriceCents,
      linePriceCents: linePriceCents,
      image: item.image,
    }
  })

  // Se il subtotale non è stato trovato, lo calcoliamo sommando le righe
  if (subtotalCents === null) {
    subtotalCents = normalizedItems.reduce(
      (sum, it) => sum + it.linePriceCents,
      0,
    )
  }

  return {
    sessionId,
    currency,
    subtotalCents,
    items: normalizedItems,
  }
}

export default function CheckoutPage() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId")

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<CheckoutData | null>(null)

  // Spedizione (per ora mockata dalla route /api/shipping)
  const [shippingCents, setShippingCents] = useState<number>(0)
  const [shippingLoading, setShippingLoading] = useState(false)
  const [shippingError, setShippingError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!sessionId) {
        setError("Sessione di checkout mancante.")
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const url = `/api/cart-session?sessionId=${encodeURIComponent(
          sessionId,
        )}`

        const res = await fetch(url, { cache: "no-store" })
        const raw = await res.json()

        if (!res.ok) {
          throw new Error(raw.error || "Errore nel recupero del carrello")
        }

        const normalized = normalizeSession(raw)
        // forza il sessionId della query se il backend non lo mette
        normalized.sessionId = sessionId

        setData(normalized)

        // facoltativo: calcolo spedizione subito dopo aver caricato il carrello
        try {
          setShippingLoading(true)
          const shipRes = await fetch("/api/shipping", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: {
                country: "IT", // per ora mock, poi useremo l'input dell'utente
              },
              items: normalized.items.map((it) => ({
                quantity: it.quantity,
              })),
              subtotalCents: normalized.subtotalCents,
              currency: normalized.currency,
            }),
          })

          const shipJson = await shipRes.json()
          if (!shipRes.ok || !shipJson.success) {
            throw new Error(shipJson.error || "Errore calcolo spedizione")
          }

          setShippingCents(shipJson.amount || 0)
          setShippingError(null)
        } catch (err: any) {
          console.error("[checkout] errore spedizione:", err)
          setShippingCents(0)
          setShippingError(
            "Impossibile calcolare la spedizione. Verrà mostrato 0 per ora.",
          )
        } finally {
          setShippingLoading(false)
        }
      } catch (err: any) {
        console.error("[checkout] errore load:", err)
        setError(err.message || "Errore nel recupero del carrello.")
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [sessionId])

  if (!sessionId) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl px-6 py-4">
          <p className="text-sm">Sessione di checkout non valida.</p>
        </div>
      </main>
    )
  }

  if (loading || !data) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl px-6 py-4">
          <p className="text-sm">Caricamento del carrello…</p>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <div className="bg-red-500/10 border border-red-500/50 rounded-2xl px-6 py-4">
          <p className="text-sm">Errore: {error}</p>
        </div>
      </main>
    )
  }

  const { items, subtotalCents, currency } = data
  const totalCents = subtotalCents + (shippingCents || 0)

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl">
        {/* Header stile Apple/Revolut */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-slate-900 border border-slate-700/80 flex items-center justify-center shadow-lg shadow-slate-900/70">
              <span className="text-xs font-semibold tracking-[0.16em] uppercase text-slate-100">
                NFR
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                Secure Checkout
              </span>
              <span className="text-sm font-medium text-slate-50">
                Checkout Not For Resale
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>Connessione sicura</span>
          </div>
        </div>

        {/* Layout a due colonne */}
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-6">
          {/* Colonna sinistra: dati e riepilogo articoli */}
          <section className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 md:p-6 backdrop-blur-xl shadow-[0_20px_60px_rgba(15,23,42,0.9)]">
            <h1 className="text-lg md:text-xl font-semibold text-slate-50 mb-2">
              Completa i dati e paga in modo sicuro.
            </h1>
            <p className="text-xs text-slate-400 mb-6">
              Rivedi il riepilogo del tuo ordine e completa il pagamento con
              carta tramite Stripe.
            </p>

            {/* Sezione: articoli nel carrello */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium text-slate-200">
                  Articoli nel carrello ({items.length})
                </h2>
              </div>

              <div className="space-y-3">
                {items.map((item) => {
                  const unitPrice = item.unitPriceCents
                  const linePrice = item.linePriceCents || unitPrice * item.quantity

                  return (
                    <div
                      key={item.key}
                      className="flex items-start justify-between gap-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 px-3 py-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-14 h-14 rounded-2xl bg-slate-800/70 border border-slate-700/70 overflow-hidden flex items-center justify-center text-[10px] text-slate-500">
                          {item.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.image}
                              alt={item.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            "NFR"
                          )}
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-50">
                              {item.title}
                            </span>
                          </div>
                          {item.variantTitle && (
                            <span className="text-[11px] text-slate-400 mt-0.5">
                              {item.variantTitle}
                            </span>
                          )}
                          <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-400">
                            <span className="px-2 py-0.5 rounded-full bg-slate-900/70 border border-slate-700/70">
                              {item.quantity}×
                            </span>
                            <span>{formatMoney(unitPrice, currency)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right text-xs text-slate-50">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 mb-0.5">
                          Totale riga
                        </div>
                        <div className="font-semibold">
                          {formatMoney(linePrice, currency)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Subtotale + spedizione */}
            <div className="mt-4 border-t border-slate-800 pt-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Subtotale prodotti</span>
                <span className="text-slate-100 font-medium">
                  {formatMoney(subtotalCents, currency)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">
                  Spedizione{" "}
                  {shippingLoading && (
                    <span className="text-[11px] text-slate-500">
                      (calcolo…)
                    </span>
                  )}
                </span>
                <span className="text-slate-100 font-medium">
                  {shippingCents > 0
                    ? formatMoney(shippingCents, currency)
                    : "Calcolata dopo"}
                </span>
              </div>

              {shippingError && (
                <p className="text-[11px] text-amber-400 mt-1">
                  {shippingError}
                </p>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-800 mt-2">
                <span className="text-slate-200 font-medium">
                  Totale ordine
                </span>
                <span className="text-slate-50 font-semibold text-base">
                  {formatMoney(totalCents, currency)}
                </span>
              </div>
            </div>
          </section>

          {/* Colonna destra: widget pagamento inline Stripe */}
          <section className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 md:p-6 backdrop-blur-xl shadow-[0_24px_60px_rgba(15,23,42,0.95)] flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-[10px] text-slate-300">
                  💳
                </div>
                <div className="flex flex-col">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    Pagamento sicuro
                  </span>
                  <span className="text-sm font-medium text-slate-50">
                    Gestito da Stripe
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 mb-4">
                I dati della tua carta non transitano mai sui server di Not For
                Resale. Il pagamento è gestito interamente da Stripe, conforme
                agli standard PCI-DSS.
              </p>

              <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
                <span>Totale ordine</span>
                <span className="text-sm font-semibold text-slate-50">
                  {formatMoney(totalCents, currency)}
                </span>
              </div>

              {/* ✅ Componente Summary: bottone "Paga ora" con Stripe inline */}
              <Summary
                amountCents={totalCents}
                currency={currency}
                sessionId={data.sessionId}
              />
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col gap-1">
              <span className="text-[10px] text-slate-500">
                Pagamento elaborato da Stripe. I dati della tua carta non
                passano mai sui server di Not For Resale.
              </span>
              <span className="text-[10px] text-slate-500">
                In caso di problemi con il pagamento, il tuo ordine non verrà
                confermato e l&apos;importo non verrà addebitato.
              </span>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
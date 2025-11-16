"use client"

import React, {
  Suspense,
  useEffect,
  useMemo,
  useState,
  ChangeEvent,
} from "react"
import { useSearchParams } from "next/navigation"
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js"
import { loadStripe } from "@stripe/stripe-js"

// 🔑 PK pubblicabile (test o live) – la stessa che hai messo su Vercel
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
)

// ---------------------------
// Tipi di supporto
// ---------------------------

type CheckoutItem = {
  id: number | string
  title: string
  variantTitle?: string
  quantity: number
  priceCents?: number
  linePriceCents?: number
  image?: string
}

type RawCartItem = {
  id: number
  discounted_price?: number
  original_price?: number
  original_line_price?: number
  final_line_price?: number
  price?: number
  quantity?: number
  title?: string
  variant_title?: string
  total_discount?: number
}

type RawCart = {
  items?: RawCartItem[]
  original_total_price?: number
  total_discount?: number
  total_price?: number
  discount_codes?: { code: string }[]
  cart_level_discount_applications?: {
    title?: string
    total_allocated_amount?: number
  }[]
}

type Customer = {
  fullName: string
  email: string
  address1: string
  address2: string
  city: string
  province: string
  zip: string
  country: string
  phone?: string
}

// ---------------------------
// Utils
// ---------------------------

function formatMoney(cents: number, currency: string) {
  return `${(cents / 100).toFixed(2)} ${currency}`
}

function isAddressComplete(addr: Customer) {
  return (
    addr.fullName.trim().length > 3 &&
    addr.email.trim().length > 3 &&
    addr.address1.trim().length > 3 &&
    addr.city.trim().length > 1 &&
    addr.province.trim().length > 1 &&
    addr.zip.trim().length > 3 &&
    addr.country.trim().length > 1
  )
}

// ---------------------------
// COMPONENTE PRINCIPALE (con Suspense)
// ---------------------------

function CheckoutPageInner() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId") || ""

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [items, setItems] = useState<CheckoutItem[]>([])
  const [currency, setCurrency] = useState("EUR")

  const [subtotalCents, setSubtotalCents] = useState(0)
  const [shippingCents, setShippingCents] = useState(0)
  const [totalCents, setTotalCents] = useState(0)

  const [rawCart, setRawCart] = useState<RawCart | null>(null)

  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [shippingApplied, setShippingApplied] = useState(false)
  const [shippingLoading, setShippingLoading] = useState(false)
  const [paymentIntentLoading, setPaymentIntentLoading] = useState(false)

  // Dati cliente
  const [customer, setCustomer] = useState<Customer>({
    fullName: "",
    email: "",
    address1: "",
    address2: "",
    city: "",
    province: "",
    zip: "",
    country: "IT",
    phone: "",
  })

  // ---------------------------
  // Cambia campi indirizzo
  // ---------------------------
  function handleCustomerChange(
    field: keyof Customer,
    e: ChangeEvent<HTMLInputElement>,
  ) {
    const value = e.target.value
    setCustomer(prev => ({ ...prev, [field]: value }))
  }

  // ---------------------------
  // Carica carrello da Firestore
  // ---------------------------
  useEffect(() => {
    if (!sessionId) {
      setError("Nessuna sessione di checkout trovata.")
      setLoading(false)
      return
    }

    async function loadCart() {
      try {
        setLoading(true)
        const res = await fetch(
          `/api/cart-session?sessionId=${encodeURIComponent(sessionId)}`,
        )
        const data = await res.json()

        if (!res.ok) {
          setError(data.error || "Errore nel recupero del carrello")
          return
        }

        const items: CheckoutItem[] = data.items || []
        const currency = (data.currency || "EUR").toString().toUpperCase()
        const subtotal = Number(data.subtotalCents || 0)
        const shipping = Number(data.shippingCents || 0)
        const total =
          data.totalCents != null
            ? Number(data.totalCents)
            : subtotal + shipping

        setItems(items)
        setCurrency(currency)
        setSubtotalCents(subtotal)
        setShippingCents(shipping)
        setTotalCents(total)
        setRawCart((data.rawCart || null) as RawCart | null)
        setError(null)
      } catch (err) {
        console.error(err)
        setError("Errore nel caricamento del carrello")
      } finally {
        setLoading(false)
      }
    }

    loadCart()
  }, [sessionId])

  // ---------------------------
  // Calcola informazioni sconto
  // ---------------------------
  const {
    originalSubtotalCents,
    discountCents,
    discountLabel,
  } = useMemo(() => {
    const rc = rawCart
    if (!rc) {
      return {
        originalSubtotalCents: subtotalCents,
        discountCents: 0,
        discountLabel: "",
      }
    }

    const original =
      typeof rc.original_total_price === "number"
        ? rc.original_total_price
        : subtotalCents

    const disc =
      typeof rc.total_discount === "number"
        ? rc.total_discount
        : original - subtotalCents > 0
        ? original - subtotalCents
        : 0

    let label = ""
    if (Array.isArray(rc.cart_level_discount_applications)) {
      const app = rc.cart_level_discount_applications[0]
      if (app?.title) label = app.title
    } else if (Array.isArray(rc.discount_codes)) {
      const d = rc.discount_codes[0]
      if (d?.code) label = d.code
    }

    return {
      originalSubtotalCents: original,
      discountCents: disc,
      discountLabel: label,
    }
  }, [rawCart, subtotalCents])

  // ---------------------------
  // Applica spedizione (flat 5,90) quando indirizzo completo
  // + crea PaymentIntent con importo finale
  // ---------------------------
  useEffect(() => {
    if (!sessionId) return
    if (!isAddressComplete(customer)) return
    if (shippingApplied) return  // evita richiami multipli

    let cancelled = false

    async function applyShippingAndPaymentIntent() {
      try {
        setShippingLoading(true)

        // 1) aggiorna la sessione carrello lato server (shipping 5,90)
        const shipRes = await fetch("/api/shipping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            address: customer,
          }),
        })

        const shipData = await shipRes.json()

        if (!shipRes.ok) {
          console.error("Errore calcolo spedizione:", shipData)
          return
        }

        if (cancelled) return

        const shipping = Number(shipData.shippingCents || 590)
        const total = Number(shipData.totalCents || subtotalCents + shipping)

        setShippingCents(shipping)
        setTotalCents(total)
        setShippingApplied(true)

        // 2) crea o recupera PaymentIntent sul backend
        setPaymentIntentLoading(true)
        const piRes = await fetch("/api/payment-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        })
        const piData = await piRes.json()

        if (!piRes.ok) {
          console.error("Errore creazione PaymentIntent:", piData)
          setError(piData.error || "Errore nel pagamento")
          return
        }

        if (cancelled) return
        setClientSecret(piData.clientSecret || null)
      } catch (err: any) {
        console.error(err)
        if (!cancelled) {
          setError(
            err?.message ||
              "Errore durante il calcolo della spedizione / pagamento",
          )
        }
      } finally {
        if (!cancelled) {
          setShippingLoading(false)
          setPaymentIntentLoading(false)
        }
      }
    }

    applyShippingAndPaymentIntent()

    return () => {
      cancelled = true
    }
  }, [
    sessionId,
    customer,
    shippingApplied,
    subtotalCents,
  ])

  // ---------------------------
  // Render stati base
  // ---------------------------

  if (loading) {
    return (
      <main className="min-h-screen bg-white text-black flex items-center justify-center">
        <p className="text-sm text-gray-600">Caricamento checkout…</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-white text-black flex items-center justify-center px-4">
        <div className="max-w-md w-full border border-red-200 bg-red-50 rounded-2xl px-5 py-4 text-center">
          <h1 className="text-base font-semibold text-red-700 mb-1">
            Errore checkout
          </h1>
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <a
            href={`/checkout?sessionId=${encodeURIComponent(sessionId)}`}
            className="inline-flex items-center justify-center rounded-full border border-black px-4 py-2 text-xs font-medium uppercase tracking-wide"
          >
            Riprova
          </a>
        </div>
      </main>
    )
  }

  if (!items.length) {
    return (
      <main className="min-h-screen bg-white text-black flex items-center justify-center px-4">
        <div className="max-w-md w-full border border-gray-200 rounded-2xl px-5 py-4 text-center">
          <h1 className="text-base font-semibold mb-2">
            Il carrello è vuoto
          </h1>
          <a
            href={`/checkout?sessionId=${encodeURIComponent(sessionId)}`}
            className="inline-flex items-center justify-center rounded-full border border-black px-4 py-2 text-xs font-medium uppercase tracking-wide"
          >
            Torna allo shop
          </a>
        </div>
      </main>
    )
  }

  const itemsCount = items.reduce(
    (acc, it) => acc + Number(it.quantity || 0),
    0,
  )

  const canPay = isAddressComplete(customer)
  const finalTotalCents = totalCents || subtotalCents + shippingCents
  const totalFormatted = formatMoney(finalTotalCents, currency)

  // Mappa rapida per trovare info sconto per riga
  const rawItems = rawCart?.items || []

  return (
    <main className="min-h-screen bg-white text-black flex flex-col">
      {/* HEADER con logo */}
      <header className="border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-center">
          <a
            href={`/checkout?sessionId=${encodeURIComponent(sessionId)}`}
            className="inline-flex items-center justify-center"
            aria-label="Torna al checkout"
          >
            <img
              src="https://cdn.shopify.com/s/files/1/0899/2188/0330/files/logo_checkify_d8a640c7-98fe-4943-85c6-5d1a633416cf.png?v=1761832152"
              alt="NOT FOR RESALE"
              className="h-10 w-auto md:h-12"
            />
          </a>
        </div>
      </header>

      {/* CONTENUTO */}
      <div className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-6 md:py-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)]">
            {/* COLONNA SINISTRA – Dati cliente & spedizione */}
            <section className="space-y-6">
              <div>
                <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
                  Checkout
                </h1>
                <p className="text-xs md:text-sm text-gray-500 mt-1">
                  Inserisci i dati di spedizione e paga in modo sicuro con
                  carta.
                </p>
              </div>

              {/* DATI DI CONTATTO */}
              <div className="border border-gray-200 rounded-2xl p-4 md:p-5 space-y-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                  Dati di contatto
                </h2>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-gray-600">
                      Nome completo
                    </label>
                    <input
                      type="text"
                      value={customer.fullName}
                      onChange={e => handleCustomerChange("fullName", e)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
                      placeholder="Es. Mario Rossi"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-gray-600">
                      Email
                    </label>
                    <input
                      type="email"
                      value={customer.email}
                      onChange={e => handleCustomerChange("email", e)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
                      placeholder="esempio@email.com"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-gray-600">
                      Telefono (opzionale)
                    </label>
                    <input
                      type="tel"
                      value={customer.phone || ""}
                      onChange={e => handleCustomerChange("phone", e)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
                      placeholder="es. 333 1234567"
                    />
                  </div>
                </div>
              </div>

              {/* INDIRIZZO DI SPEDIZIONE */}
              <div className="border border-gray-200 rounded-2xl p-4 md:p-5 space-y-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                  Indirizzo di spedizione
                </h2>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-gray-600">
                      Indirizzo
                    </label>
                    <input
                      type="text"
                      value={customer.address1}
                      onChange={e => handleCustomerChange("address1", e)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
                      placeholder="Via, numero civico"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-gray-600">
                      Seconda riga (opzionale)
                    </label>
                    <input
                      type="text"
                      value={customer.address2}
                      onChange={e => handleCustomerChange("address2", e)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
                      placeholder="Interno, scala, ecc."
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1.5">
                      <label className="block text-xs text-gray-600">
                        CAP
                      </label>
                      <input
                        type="text"
                        value={customer.zip}
                        onChange={e => handleCustomerChange("zip", e)}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="block text-xs text-gray-600">
                        Città
                      </label>
                      <input
                        type="text"
                        value={customer.city}
                        onChange={e => handleCustomerChange("city", e)}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs text-gray-600">
                        Provincia
                      </label>
                      <input
                        type="text"
                        value={customer.province}
                        onChange={e => handleCustomerChange("province", e)}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="block text-xs text-gray-600">
                        Paese
                      </label>
                      <input
                        type="text"
                        value={customer.country}
                        onChange={e => handleCustomerChange("country", e)}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
                      />
                    </div>

                    <div className="flex items-end">
                      <div className="text-[11px] text-gray-500 leading-snug">
                        Una volta inserito l&apos;indirizzo completo,
                        aggiungeremo automaticamente la spedizione
                        all&apos;ordine.
                      </div>
                    </div>
                  </div>

                  {shippingLoading && (
                    <div className="text-xs text-gray-500">
                      Calcolo spedizione e preparazione del pagamento…
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* COLONNA DESTRA – Riepilogo ordine + pagamento */}
            <section className="space-y-6">
              {/* RIEPILOGO ORDINE */}
              <div className="border border-gray-200 rounded-2xl p-4 md:p-5 space-y-4">
                <header className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                    Riepilogo ordine
                  </h2>
                  <span className="text-xs text-gray-500">
                    {itemsCount} articoli
                  </span>
                </header>

                <div className="space-y-3 max-h-64 overflow-auto pr-1">
                  {items.map(item => {
                    const raw = rawItems.find(ri => ri.id === item.id)

                    const quantity = Number(item.quantity || raw?.quantity || 1)

                    const discountedUnitCents =
                      typeof raw?.discounted_price === "number"
                        ? raw.discounted_price
                        : typeof item.priceCents === "number"
                        ? item.priceCents
                        : 0

                    const originalUnitCents =
                      typeof raw?.original_price === "number"
                        ? raw.original_price
                        : discountedUnitCents

                    const lineCents =
                      typeof item.linePriceCents === "number"
                        ? item.linePriceCents
                        : discountedUnitCents * quantity

                    const hasDiscount =
                      originalUnitCents > 0 &&
                      originalUnitCents > discountedUnitCents

                    return (
                      <div
                        key={item.id}
                        className="flex gap-3 border border-gray-200 rounded-xl p-3"
                      >
                        {item.image && (
                          <div className="w-16 h-16 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.image}
                              alt={item.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <div className="flex-1 flex flex-col justify-between">
                          <div>
                            <div className="text-xs font-medium text-gray-900 line-clamp-2">
                              {item.title}
                            </div>
                            {item.variantTitle && (
                              <div className="text-[11px] text-gray-500 mt-0.5">
                                {item.variantTitle}
                              </div>
                            )}
                            <div className="text-[11px] text-gray-500 mt-0.5">
                              Quantità: {quantity}
                            </div>
                          </div>
                          <div className="mt-1 text-right">
                            {hasDiscount ? (
                              <div className="space-y-0.5">
                                <div className="text-[11px] text-gray-400 line-through">
                                  {formatMoney(
                                    originalUnitCents * quantity,
                                    currency,
                                  )}
                                </div>
                                <div className="text-xs font-semibold text-gray-900">
                                  {formatMoney(lineCents, currency)}
                                </div>
                              </div>
                            ) : (
                              <div className="text-xs font-semibold text-gray-900">
                                {formatMoney(lineCents, currency)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Totali */}
                <div className="pt-3 border-t border-gray-200 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotale</span>
                    <div className="text-right">
                      {discountCents > 0 ? (
                        <div className="space-y-0.5">
                          <div className="text-[11px] text-gray-400 line-through">
                            {formatMoney(originalSubtotalCents, currency)}
                          </div>
                          <div className="text-sm font-medium text-gray-900">
                            {formatMoney(subtotalCents, currency)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-900">
                          {formatMoney(subtotalCents, currency)}
                        </span>
                      )}
                    </div>
                  </div>

                  {discountCents > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">
                        Sconto{discountLabel ? ` (${discountLabel})` : ""}
                      </span>
                      <span className="text-green-600 font-medium">
                        -{formatMoney(discountCents, currency)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Spedizione</span>
                    <span className="text-gray-900">
                      {shippingCents > 0
                        ? formatMoney(shippingCents, currency)
                        : "Verrà calcolata dopo l'indirizzo"}
                    </span>
                  </div>

                  <div className="flex justify-between pt-2 border-t border-gray-200 text-base">
                    <span className="font-semibold text-gray-900">
                      Totale
                    </span>
                    <span className="font-semibold text-gray-900">
                      {totalFormatted}
                    </span>
                  </div>
                </div>
              </div>

              {/* PAGAMENTO STRIPE */}
              <div className="border border-gray-200 rounded-2xl p-4 md:p-5 space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                  Pagamento
                </h2>

                {!canPay && (
                  <p className="text-xs text-gray-500">
                    Compila prima tutti i dati di contatto e
                    l&apos;indirizzo di spedizione per procedere al
                    pagamento.
                  </p>
                )}

                {canPay && (shippingLoading || paymentIntentLoading) && (
                  <p className="text-xs text-gray-500">
                    Preparazione del pagamento in corso…
                  </p>
                )}

                {canPay && !shippingLoading && !paymentIntentLoading && (
                  <>
                    {!clientSecret ? (
                      <p className="text-xs text-gray-500">
                        Preparazione del modulo carta…
                      </p>
                    ) : (
                      <PaymentBox
                        clientSecret={clientSecret}
                        sessionId={sessionId}
                        customer={customer}
                        totalFormatted={totalFormatted}
                      />
                    )}
                  </>
                )}

                <p className="text-[11px] text-gray-500">
                  I pagamenti sono elaborati in modo sicuro da Stripe. I
                  dati della carta non passano mai sui nostri server.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}

/* ---------------------------------------------
   BOX PAGAMENTO STRIPE
---------------------------------------------- */

function PaymentBox({
  clientSecret,
  sessionId,
  customer,
  totalFormatted,
}: {
  clientSecret: string
  sessionId: string
  customer: Customer
  totalFormatted: string
}) {
  const options: any = {
    clientSecret,
    appearance: {
      theme: "flat",
      labels: "floating",
      variables: {
        colorPrimary: "#000000",
        colorBackground: "#ffffff",
        colorText: "#111111",
        colorDanger: "#df1c41",
        borderRadius: "10px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      },
    },
    // Proviamo a ridurre al minimo i campi extra del Payment Element
    fields: {
      billingDetails: {
        name: "never",
        email: "never",
        address: "never",
      },
    },
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <PaymentBoxInner
        sessionId={sessionId}
        customer={customer}
        totalFormatted={totalFormatted}
      />
    </Elements>
  )
}

function PaymentBoxInner({
  sessionId,
  customer,
  totalFormatted,
}: {
  sessionId: string
  customer: Customer
  totalFormatted: string
}) {
  const stripe = useStripe()
  const elements = useElements()

  const [cardholderName, setCardholderName] = useState("")
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePay() {
    if (!stripe || !elements) return

    setPaying(true)
    setError(null)

    const fullName =
      cardholderName.trim() || customer.fullName.trim() || ""

    try {
      const { error, paymentIntent } = (await stripe.confirmPayment({
        elements,
        confirmParams: {
          payment_method_data: {
            billing_details: {
              name: fullName || undefined,
              email: customer.email || undefined,
              phone: customer.phone || undefined,
              address: {
                line1: customer.address1 || undefined,
                line2: customer.address2 || undefined,
                postal_code: customer.zip || undefined,
                city: customer.city || undefined,
                state: customer.province || undefined,
                country: customer.country || undefined,
              },
            },
          },
        },
        redirect: "if_required",
      } as any)) as any

      if (error) {
        console.error(error)
        setError(error.message || "Errore durante il pagamento")
        setPaying(false)
        return
      }

      if (paymentIntent && paymentIntent.status === "succeeded") {
        try {
          // Creazione ordine Shopify lato server (se implementato)
          await fetch("/api/shopify/create-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              paymentIntentId: paymentIntent.id,
              customer,
            }),
          })
        } catch (e) {
          console.error("Errore creazione ordine Shopify", e)
        }

        window.location.href = `/thank-you?sessionId=${encodeURIComponent(
          sessionId,
        )}&pi=${encodeURIComponent(paymentIntent.id)}`
      } else {
        setError("Pagamento non completato. Riprova.")
        setPaying(false)
      }
    } catch (err: any) {
      console.error(err)
      setError(
        err?.message || "Errore imprevisto durante il pagamento",
      )
      setPaying(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Nome intestatario sopra la carta */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          Nome completo sull&apos;intestatario della carta
        </label>
        <input
          type="text"
          value={cardholderName}
          onChange={e => setCardholderName(e.target.value)}
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
          placeholder="Es. Mario Rossi"
        />
      </div>

      {/* Box carta con bordo ben visibile */}
      <div className="rounded-2xl border border-gray-900 bg-white px-4 py-4 shadow-sm">
        <PaymentElement />
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <button
        onClick={handlePay}
        disabled={paying || !stripe || !elements}
        className="w-full inline-flex items-center justify-center rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-60"
      >
        {paying ? "Elaborazione…" : `Paga ora ${totalFormatted}`}
      </button>
    </div>
  )
}

// Wrapper con Suspense richiesto da Next 13+
export default function CheckoutPage() {
  return (
    <Suspense fallback={<div>Caricamento checkout…</div>}>
      <CheckoutPageInner />
    </Suspense>
  )
}
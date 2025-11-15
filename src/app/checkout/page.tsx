"use client"

import React, { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { loadStripe } from "@stripe/stripe-js"
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js"
import type { StripeElementsOptions } from "@stripe/stripe-js"

// Stripe publishable key (LIVE o TEST, presa da Vercel)
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
)

type CheckoutItem = {
  id: number | string
  title: string
  variantTitle?: string
  quantity: number
  priceCents: number
  linePriceCents: number
  image?: string
}

type Customer = {
  email: string
  firstName: string
  lastName: string
  address1: string
  address2: string
  city: string
  province: string
  zip: string
  country: string
  phone: string
}

function CheckoutPageInner() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId") || ""

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [items, setItems] = useState<CheckoutItem[]>([])
  const [currency, setCurrency] = useState("EUR")
  const [subtotal, setSubtotal] = useState(0) // in € (non centesimi)
  const [shipping, setShipping] = useState(0) // in €
  const [total, setTotal] = useState(0) // in €

  const [clientSecret, setClientSecret] = useState<string | null>(null)

  const [customer, setCustomer] = useState<Customer>({
    email: "",
    firstName: "",
    lastName: "",
    address1: "",
    address2: "",
    city: "",
    province: "",
    zip: "",
    country: "IT",
    phone: "",
  })

  // Carica il carrello da Firestore
  useEffect(() => {
    async function loadCart() {
      if (!sessionId) {
        setError("Nessuna sessione di checkout trovata.")
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const res = await fetch(
          `/api/cart-session?sessionId=${encodeURIComponent(sessionId)}`,
        )
        const data = await res.json()

        if (!res.ok) {
          setError(data.error || "Errore nel recupero del carrello")
          setLoading(false)
          return
        }

        const itemsArr: CheckoutItem[] = data.items || []

        const currency =
          (data.currency || data.totals?.currency || "EUR").toString().toUpperCase()

        const subtotalCents =
          typeof data.subtotalCents === "number"
            ? data.subtotalCents
            : typeof data.totals?.subtotal === "number"
            ? data.totals.subtotal
            : 0

        const shippingCents =
          typeof data.shippingCents === "number" ? data.shippingCents : 0

        const totalCents =
          typeof data.totalCents === "number"
            ? data.totalCents
            : subtotalCents + shippingCents

        setItems(itemsArr)
        setCurrency(currency)
        setSubtotal(subtotalCents / 100)
        setShipping(shippingCents / 100)
        setTotal(totalCents / 100)
      } catch (err) {
        console.error(err)
        setError("Errore nel caricamento del carrello")
      } finally {
        setLoading(false)
      }
    }

    loadCart()
  }, [sessionId])

  // Richiede il PaymentIntent a Stripe (via API route)
  useEffect(() => {
    async function createPaymentIntent() {
      if (!sessionId) return

      try {
        const res = await fetch("/api/payment-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        })
        const data = await res.json()

        if (!res.ok) {
          console.error("Errore payment-intent:", data.error)
          return
        }

        if (data.clientSecret) {
          setClientSecret(data.clientSecret)
        }
      } catch (err) {
        console.error("Errore creazione payment-intent:", err)
      }
    }

    createPaymentIntent()
  }, [sessionId])

  // Quando viene inserito un CAP, setta spedizione fissa 5,90€
  useEffect(() => {
    if (customer.zip && shipping === 0 && subtotal > 0) {
      const shippingAmount = 5.9
      setShipping(shippingAmount)
      setTotal(subtotal + shippingAmount)
    }
  }, [customer.zip, subtotal, shipping])

  function handleCustomerChange<K extends keyof Customer>(
    field: K,
    value: Customer[K],
  ) {
    setCustomer(prev => ({
      ...prev,
      [field]: value,
    }))
  }

  const itemsCount = items.reduce(
    (acc, it) => acc + Number(it.quantity || 0),
    0,
  )

  const fmt = (v: number) => `${v.toFixed(2)} ${currency}`

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white text-gray-900">
        <div className="text-sm text-gray-500">Caricamento checkout…</div>
      </main>
    )
  }

  if (error || !sessionId) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white text-gray-900 px-4">
        <div className="max-w-md w-full border border-gray-200 rounded-lg p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">Errore checkout</h1>
          <p className="text-sm text-gray-600 mb-4">
            {error ||
              "Non è stato possibile recuperare il carrello per questo link."}
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-900"
          >
            Torna allo shop
          </a>
        </div>
      </main>
    )
  }

  const totalFormatted = fmt(total || subtotal + shipping)

  return (
    <main className="min-h-screen bg-white text-gray-900">
      {/* Header tipo Shopify */}
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full border border-gray-900 flex items-center justify-center text-xs font-semibold">
              NF
            </div>
            <span className="text-sm font-medium tracking-wide uppercase">
              NOT FOR RESALE
            </span>
          </div>
          <div className="hidden text-xs text-gray-500 sm:block">
            Checkout sicuro
          </div>
        </div>
      </header>

      {/* Body a due colonne */}
      <div className="mx-auto flex max-w-5xl flex-col-reverse gap-10 px-4 py-8 lg:flex-row lg:items-start">
        {/* Colonna sinistra: dati cliente / indirizzo */}
        <section className="flex-1 space-y-8">
          {/* Contatto */}
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-900">
              Contatto
            </h2>
            <div className="space-y-3">
              <input
                type="email"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                placeholder="Email"
                value={customer.email}
                onChange={e => handleCustomerChange("email", e.target.value)}
              />
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="newsletter"
                  className="h-4 w-4 rounded border-gray-300 text-black focus:ring-black"
                />
                <label
                  htmlFor="newsletter"
                  className="text-xs text-gray-600"
                >
                  Voglio ricevere offerte esclusive via email
                </label>
              </div>
            </div>
          </div>

          {/* Spedizione */}
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-900">
              Spedizione
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                  placeholder="Nome"
                  value={customer.firstName}
                  onChange={e =>
                    handleCustomerChange("firstName", e.target.value)
                  }
                />
                <input
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                  placeholder="Cognome"
                  value={customer.lastName}
                  onChange={e =>
                    handleCustomerChange("lastName", e.target.value)
                  }
                />
              </div>

              <input
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                placeholder="Indirizzo"
                value={customer.address1}
                onChange={e => handleCustomerChange("address1", e.target.value)}
              />

              <input
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                placeholder="Appartamento, scala, interno (opzionale)"
                value={customer.address2}
                onChange={e => handleCustomerChange("address2", e.target.value)}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                  placeholder="CAP"
                  value={customer.zip}
                  onChange={e => handleCustomerChange("zip", e.target.value)}
                />
                <input
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                  placeholder="Città"
                  value={customer.city}
                  onChange={e => handleCustomerChange("city", e.target.value)}
                />
                <input
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                  placeholder="Provincia"
                  value={customer.province}
                  onChange={e =>
                    handleCustomerChange("province", e.target.value)
                  }
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <select
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                  value={customer.country}
                  onChange={e =>
                    handleCustomerChange("country", e.target.value)
                  }
                >
                  <option value="IT">Italia</option>
                  <option value="SM">San Marino</option>
                  <option value="VA">Città del Vaticano</option>
                </select>
                <input
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                  placeholder="Telefono (per il corriere)"
                  value={customer.phone}
                  onChange={e => handleCustomerChange("phone", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Metodo di spedizione (mock 5,90€) */}
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-900">
              Metodo di spedizione
            </h2>
            <div className="rounded-md border border-gray-300 bg-white">
              <label className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="shipping"
                    defaultChecked
                    className="h-4 w-4 border-gray-300 text-black focus:ring-black"
                  />
                  <div className="flex flex-col">
                    <span>Spedizione Express</span>
                    <span className="text-xs text-gray-500">
                      24/48h lavorative
                    </span>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {shipping > 0 ? fmt(shipping) : "5,90 EUR"}
                </span>
              </label>
            </div>
          </div>

          {/* Pagamento: box con Stripe Payment Element */}
          <div className="space-y-3 pt-4 border-t border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">
              Pagamento
            </h2>
            <p className="text-xs text-gray-500">
              Tutte le transazioni sono sicure e crittografate.
            </p>

            <PaymentBox
              clientSecret={clientSecret}
              sessionId={sessionId}
              customer={customer}
              totalFormatted={totalFormatted}
            />
          </div>
        </section>

        {/* Colonna destra: riepilogo ordine */}
        <aside className="w-full max-w-md space-y-6 lg:sticky lg:top-0">
          <div className="space-y-4 border border-gray-200 bg-gray-50 p-4 rounded-lg">
            {/* Lista articoli */}
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {items.map(item => {
                const linePrice = Number(item.linePriceCents || 0) / 100
                const unitPrice = Number(item.priceCents || 0) / 100

                return (
                  <div
                    key={item.id}
                    className="flex gap-3 border-b border-gray-200 pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white">
                      {item.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.image}
                          alt={item.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">
                          Nessuna immagine
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {item.title}
                          </div>
                          {item.variantTitle && (
                            <div className="text-xs text-gray-500">
                              {item.variantTitle}
                            </div>
                          )}
                          <div className="mt-1 text-xs text-gray-500">
                            Qty: {item.quantity}
                          </div>
                        </div>
                        <div className="text-sm font-medium text-gray-900 text-right">
                          {linePrice > 0 ? (
                            <>
                              <div>{fmt(linePrice)}</div>
                              {unitPrice !== linePrice &&
                                item.quantity > 1 && (
                                  <div className="text-[11px] text-gray-500">
                                    ({fmt(unitPrice)} cad.)
                                  </div>
                                )}
                            </>
                          ) : (
                            <div>{fmt(unitPrice * item.quantity)}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Totali */}
            <div className="space-y-2 border-t border-gray-200 pt-4 text-sm">
              <div className="flex items-center justify-between text-gray-700">
                <span>Subtotale</span>
                <span>{fmt(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-gray-700">
                <span>Spedizione</span>
                <span>
                  {shipping > 0 ? fmt(shipping) : "Calcolata dopo indirizzo"}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 text-base font-semibold text-gray-900">
                <span>Totale</span>
                <span>{totalFormatted}</span>
              </div>
            </div>

            <p className="text-[11px] text-gray-500">
              Tassa inclusa dove applicabile. Il numero degli articoli è{" "}
              {itemsCount}.
            </p>
          </div>
        </aside>
      </div>
    </main>
  )
}

/* -----------------------------
   PAGAMENTO STRIPE — BOX
------------------------------ */

function PaymentBox({
  clientSecret,
  sessionId,
  customer,
  totalFormatted,
}: {
  clientSecret: string | null
  sessionId: string
  customer: Customer
  totalFormatted: string
}) {
  if (!clientSecret) {
    return (
      <div className="text-sm text-gray-500">
        Preparazione del pagamento in corso…
      </div>
    )
  }

  // 👇 usiamo `any` per evitare l'errore TS sulla proprietà `fields`
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
        colorBorder: "#111111",
      },
      rules: {
        ".Input": {
          borderColor: "#111111",
          boxShadow: "0 0 0 1px #111111",
          padding: "10px 12px",
        },
        ".Tab": {
          borderRadius: "9999px",
        },
        ".Label": {
          fontSize: "12px",
          fontWeight: "500",
        },
      },
    },
    // 👉 chiedi a Stripe di mostrare "Nome sulla carta" **dentro** il Payment Element
    fields: {
      billingDetails: {
        name: "always",
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

  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePay() {
    if (!stripe || !elements) return

    setPaying(true)
    setError(null)

    // Il Payment Element gestisce numero carta + scadenza + CVC + nome sulla carta
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    } as any)

    if (error) {
      console.error(error)
      setError(error.message || "Errore durante il pagamento")
      setPaying(false)
      return
    }

    if (paymentIntent && paymentIntent.status === "succeeded") {
      try {
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
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-300 bg-white p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">
            Pagamento con carta
          </h3>
          <span className="text-xs text-gray-500">
            Tutte le transazioni sono sicure.
          </span>
        </div>

        <div className="rounded-lg border-2 border-black/90 bg-white px-3 py-3">
          <PaymentElement />
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={paying || !stripe || !elements}
        className="w-full inline-flex items-center justify-center rounded-md bg-black px-4 py-3 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-60"
      >
        {paying ? "Elaborazione…" : `Paga ora ${totalFormatted}`}
      </button>

      <p className="text-[11px] text-gray-500">
        I pagamenti sono elaborati in modo sicuro da Stripe. I dati della
        carta non passano mai sui nostri server.
      </p>
    </div>
  )
}

/* -----------------------------
   EXPORT PAGINA
------------------------------ */

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div>Caricamento checkout…</div>}>
      <CheckoutPageInner />
    </Suspense>
  )
}
// src/app/checkout/page.tsx
"use client"

import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  ChangeEvent,
  FormEvent,
  Suspense,
} from "react"
import { useSearchParams } from "next/navigation"
import { loadStripe } from "@stripe/stripe-js"
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js"

export const dynamic = "force-dynamic"

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",
)

type CheckoutItem = {
  id: string | number
  title: string
  variantTitle?: string
  quantity: number
  priceCents?: number
  linePriceCents?: number
  image?: string
}

type CartSessionResponse = {
  sessionId: string
  currency: string
  items: CheckoutItem[]
  subtotalCents?: number
  shippingCents?: number
  totalCents?: number
  paymentIntentClientSecret?: string
  discountCodes?: { code: string }[]
  rawCart?: any
  error?: string
}

type CustomerForm = {
  fullName: string
  email: string
  phone: string
  address1: string
  address2: string
  city: string
  postalCode: string
  province: string
  countryCode: string
}

function formatMoney(cents: number | undefined, currency: string = "EUR") {
  const value = (cents ?? 0) / 100
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

function CheckoutInner({
  cart,
  sessionId,
}: {
  cart: CartSessionResponse
  sessionId: string
}) {
  const stripe = useStripe()
  const elements = useElements()

  const [customer, setCustomer] = useState<CustomerForm>({
    fullName: "",
    email: "",
    phone: "",
    address1: "",
    address2: "",
    city: "",
    postalCode: "",
    province: "",
    countryCode: "IT",
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [calculatedShippingCents, setCalculatedShippingCents] = useState<number>(0)
  const [isCalculatingShipping, setIsCalculatingShipping] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [shippingError, setShippingError] = useState<string | null>(null)

  // ✅ AUTOCOMPLETE GOOGLE PLACES
  const addressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)

  const currency = (cart.currency || "EUR").toUpperCase()

  const subtotalCents = useMemo(() => {
    if (typeof cart.subtotalCents === "number") return cart.subtotalCents
    return cart.items.reduce((sum, item) => {
      const line = item.linePriceCents ?? item.priceCents ?? 0
      return sum + line
    }, 0)
  }, [cart])

  const shippingCents = calculatedShippingCents

  const totalFromSession =
    typeof cart.totalCents === "number"
      ? cart.totalCents
      : subtotalCents + shippingCents

  const discountCents = useMemo(() => {
    const raw = subtotalCents + shippingCents - totalFromSession
    return raw > 0 ? raw : 0
  }, [subtotalCents, shippingCents, totalFromSession])

  const totalToPayCents = subtotalCents - discountCents + calculatedShippingCents

  // ✅ INIZIALIZZA GOOGLE PLACES AUTOCOMPLETE
  useEffect(() => {
    if (!addressInputRef.current) return

    // Carica Google Maps API
    if (!window.google) {
      const script = document.createElement("script")
      script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places&language=it`
      script.async = true
      script.defer = true
      script.onload = initAutocomplete
      document.head.appendChild(script)
    } else {
      initAutocomplete()
    }

    function initAutocomplete() {
      if (!addressInputRef.current || !window.google) return

      autocompleteRef.current = new google.maps.places.Autocomplete(
        addressInputRef.current,
        {
          types: ["address"],
          componentRestrictions: { country: ["it", "fr", "de", "es", "at", "be", "nl"] }, // Europa
          fields: ["address_components", "formatted_address"],
        }
      )

      autocompleteRef.current.addListener("place_changed", handlePlaceSelect)
    }
  }, [])

  function handlePlaceSelect() {
    const place = autocompleteRef.current?.getPlace()
    if (!place || !place.address_components) return

    console.log("[Autocomplete] Place selected:", place)

    let street = ""
    let streetNumber = ""
    let city = ""
    let province = ""
    let postalCode = ""
    let country = ""

    // Estrai componenti dall'indirizzo
    place.address_components.forEach((component) => {
      const types = component.types

      if (types.includes("route")) {
        street = component.long_name
      }
      if (types.includes("street_number")) {
        streetNumber = component.long_name
      }
      if (types.includes("locality")) {
        city = component.long_name
      }
      if (types.includes("administrative_area_level_2")) {
        province = component.short_name
      }
      if (types.includes("postal_code")) {
        postalCode = component.long_name
      }
      if (types.includes("country")) {
        country = component.short_name
      }
    })

    // Componi indirizzo
    const fullAddress = streetNumber ? `${street} ${streetNumber}` : street

    // Aggiorna form
    setCustomer((prev) => ({
      ...prev,
      address1: fullAddress,
      city: city || prev.city,
      postalCode: postalCode || prev.postalCode,
      province: province || prev.province,
      countryCode: country || prev.countryCode,
    }))

    console.log("[Autocomplete] ✅ Form aggiornato:", {
      address1: fullAddress,
      city,
      postalCode,
      province,
      countryCode: country,
    })
  }

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setCustomer((prev) => ({ ...prev, [name]: value }))
  }

  function isFormValid() {
    return (
      customer.fullName.trim().length > 2 &&
      customer.email.includes("@") &&
      customer.address1.trim().length > 3 &&
      customer.city.trim().length > 1 &&
      customer.postalCode.trim().length > 2 &&
      customer.province.trim().length > 1 &&
      customer.countryCode.trim().length >= 2
    )
  }

  useEffect(() => {
    async function calculateShipping() {
      if (!isFormValid()) {
        setCalculatedShippingCents(0)
        setClientSecret(null)
        setShippingError(null)
        return
      }

      setIsCalculatingShipping(true)
      setError(null)
      setShippingError(null)

      try {
        const shippingRes = await fetch("/api/calculate-shipping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            destination: {
              city: customer.city,
              province: customer.province,
              postalCode: customer.postalCode,
              countryCode: customer.countryCode || "IT",
            },
          }),
        })

        const shippingData = await shippingRes.json()

        if (!shippingRes.ok) {
          throw new Error(shippingData.error || "Errore calcolo spedizione")
        }

        const newShippingCents = shippingData.shippingCents || 0
        setCalculatedShippingCents(newShippingCents)

        const currentDiscountCents = subtotalCents + newShippingCents - totalFromSession
        const finalDiscountCents = currentDiscountCents > 0 ? currentDiscountCents : 0
        const newTotalCents = subtotalCents - finalDiscountCents + newShippingCents

        const piRes = await fetch("/api/payment-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            amountCents: newTotalCents,
            customer: {
              fullName: customer.fullName,
              email: customer.email,
              phone: customer.phone,
              address1: customer.address1,
              address2: customer.address2,
              city: customer.city,
              postalCode: customer.postalCode,
              province: customer.province,
              countryCode: customer.countryCode || "IT",
            },
          }),
        })

        const piData = await piRes.json()

        if (!piRes.ok || !piData.clientSecret) {
          throw new Error(piData.error || "Errore creazione pagamento")
        }

        setClientSecret(piData.clientSecret)
        setIsCalculatingShipping(false)
      } catch (err: any) {
        console.error("Errore calcolo spedizione/payment:", err)
        setShippingError(err.message || "Errore nel calcolo della spedizione")
        setIsCalculatingShipping(false)
      }
    }

    calculateShipping()
  }, [
    customer.fullName,
    customer.email,
    customer.phone,
    customer.address1,
    customer.address2,
    customer.city,
    customer.postalCode,
    customer.province,
    customer.countryCode,
    sessionId,
    subtotalCents,
    totalFromSession,
  ])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!isFormValid()) {
      setError("Compila tutti i campi obbligatori per procedere al pagamento.")
      return
    }

    if (!stripe || !elements) {
      setError("Stripe non è ancora pronto, riprova tra qualche secondo.")
      return
    }

    if (!clientSecret) {
      setError("Payment Intent non ancora creato. Attendi il calcolo della spedizione.")
      return
    }

    try {
      setLoading(true)

      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          payment_method_data: {
            billing_details: {
              name: customer.fullName,
              email: customer.email,
              phone: customer.phone || undefined,
              address: {
                line1: customer.address1,
                line2: customer.address2 || undefined,
                city: customer.city,
                postal_code: customer.postalCode,
                state: customer.province,
                country: customer.countryCode || "IT",
              },
            },
          },
          shipping: {
            name: customer.fullName,
            phone: customer.phone || undefined,
            address: {
              line1: customer.address1,
              line2: customer.address2 || undefined,
              city: customer.city,
              postal_code: customer.postalCode,
              state: customer.province,
              country: customer.countryCode || "IT",
            },
          },
        },
        redirect: "if_required",
      })

      if (stripeError) {
        console.error("Stripe error:", stripeError)
        setError(stripeError.message || "Pagamento non riuscito.")
        setLoading(false)
        return
      }

      setSuccess(true)
      setLoading(false)
    } catch (err: any) {
      console.error("Errore pagamento:", err)
      setError(err.message || "Errore imprevisto durante il pagamento.")
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex justify-center px-4 py-8">
      <div className="w-full max-w-5xl grid gap-8 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="space-y-6">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-[0.18em]">
              Checkout
            </p>
            <h1 className="mt-2 text-2xl md:text-3xl font-semibold">
              Completa i dati di spedizione e paga in modo sicuro.
            </h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="glass-card space-y-4 p-5 md:p-6">
              <h2 className="text-sm font-semibold text-slate-100">
                Dati di spedizione
              </h2>
              <p className="text-xs text-slate-400">
                Inizia a digitare l'indirizzo e seleziona dalla lista per compilare automaticamente.
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="glass-label">Nome completo</label>
                  <input
                    name="fullName"
                    value={customer.fullName}
                    onChange={handleChange}
                    className="glass-input"
                    placeholder="Nome e cognome"
                    required
                  />
                </div>

                <div>
                  <label className="glass-label">Email</label>
                  <input
                    type="email"
                    name="email"
                    value={customer.email}
                    onChange={handleChange}
                    className="glass-input"
                    placeholder="nome@email.com"
                    required
                  />
                </div>

                <div>
                  <label className="glass-label">Telefono</label>
                  <input
                    name="phone"
                    value={customer.phone}
                    onChange={handleChange}
                    className="glass-input"
                    placeholder="+39 ..."
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="glass-label">
                    Indirizzo 🔍
                    <span className="text-[10px] text-slate-500 ml-2">
                      (inizia a digitare per autocompletare)
                    </span>
                  </label>
                  <input
                    ref={addressInputRef}
                    name="address1"
                    value={customer.address1}
                    onChange={handleChange}
                    className="glass-input"
                    placeholder="Via, numero civico"
                    required
                    autoComplete="off"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="glass-label">
                    Complemento (scala, interno) — opzionale
                  </label>
                  <input
                    name="address2"
                    value={customer.address2}
                    onChange={handleChange}
                    className="glass-input"
                    placeholder="Interno, scala, c/o..."
                  />
                </div>

                <div>
                  <label className="glass-label">Città</label>
                  <input
                    name="city"
                    value={customer.city}
                    onChange={handleChange}
                    className="glass-input"
                    placeholder="Città"
                    required
                  />
                </div>

                <div>
                  <label className="glass-label">CAP</label>
                  <input
                    name="postalCode"
                    value={customer.postalCode}
                    onChange={handleChange}
                    className="glass-input"
                    placeholder="CAP"
                    required
                  />
                </div>

                <div>
                  <label className="glass-label">Provincia</label>
                  <input
                    name="province"
                    value={customer.province}
                    onChange={handleChange}
                    className="glass-input"
                    placeholder="MO"
                    required
                  />
                </div>

                <div>
                  <label className="glass-label">Paese</label>
                  <input
                    name="countryCode"
                    value={customer.countryCode}
                    onChange={handleChange}
                    className="glass-input"
                    placeholder="IT"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="glass-card space-y-4 p-5 md:p-6">
              <h2 className="text-sm font-semibold text-slate-100">
                Pagamento con carta
              </h2>
              <p className="text-xs text-slate-400">
                Tutte le transazioni sono sicure.
              </p>

              {isCalculatingShipping && (
                <p className="text-xs text-blue-300/90 bg-blue-900/30 border border-blue-500/30 rounded-xl px-3 py-2">
                  Calcolo spedizione da Shopify in corso...
                </p>
              )}

              {shippingError && (
                <p className="text-xs text-amber-300/90 bg-amber-900/30 border border-amber-500/30 rounded-xl px-3 py-2">
                  {shippingError}
                </p>
              )}

              {!clientSecret && !isCalculatingShipping && !shippingError && (
                <p className="text-xs text-slate-400 bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-2">
                  Inserisci tutti i dati di spedizione per calcolare il totale.
                </p>
              )}

              {clientSecret && (
                <div className="border border-white/10 rounded-2xl p-3 bg-slate-900/60">
                  <PaymentElement
                    options={{
                      layout: "tabs",
                    }}
                  />
                </div>
              )}

              <button
                type="submit"
                className="glass-button-primary w-full mt-2"
                disabled={
                  loading || !stripe || !elements || !isFormValid() || !clientSecret || isCalculatingShipping
                }
              >
                {loading
                  ? "Elaborazione in corso…"
                  : isCalculatingShipping
                  ? "Calcolo spedizione..."
                  : `Paga ${formatMoney(totalToPayCents, currency)}`}
              </button>

              {error && (
                <p className="text-xs text-rose-300 bg-rose-950/50 border border-rose-700/40 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}

              {success && (
                <p className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-700/40 rounded-xl px-3 py-2">
                  Pagamento riuscito! Stiamo creando il tuo ordine su Shopify.
                </p>
              )}
            </div>
          </form>
        </section>

        <aside className="space-y-4">
          {/* ... resto del codice sidebar identico ... */}
          <div className="glass-card p-5 md:p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-100">
              Articoli nel carrello
            </h2>
            <p className="text-xs text-slate-400">
              ({cart.items.length} articolo{cart.items.length !== 1 ? "i" : ""})
            </p>

            <div className="space-y-4">
              {cart.items.map((item, idx) => {
                const baseUnit =
                  typeof item.priceCents === "number"
                    ? item.priceCents
                    : item.linePriceCents ?? 0

                const line =
                  typeof item.linePriceCents === "number"
                    ? item.linePriceCents
                    : baseUnit * item.quantity

                const fullLine = baseUnit * item.quantity
                const diff = fullLine - line
                const hasDiscount = diff > 0

                return (
                  <div
                    key={`${item.id}-${idx}`}
                    className="flex gap-3 items-start"
                  >
                    {item.image && (
                      <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-slate-900/70 border border-white/10 flex-shrink-0">
                        <img
                          src={item.image}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="flex-1 space-y-1">
                      <p className="text-xs font-medium text-slate-100">
                        {item.title}
                      </p>
                      {item.variantTitle && (
                        <p className="text-[11px] text-slate-400">
                          {item.variantTitle}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-400">
                        {item.quantity}× {formatMoney(baseUnit, currency)}
                      </p>

                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold">
                          {formatMoney(line, currency)}
                        </p>
                        {hasDiscount && (
                          <span className="text-[11px] text-emerald-300">
                            Risparmi {formatMoney(diff, currency)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="glass-card p-5 md:p-6 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Riepilogo ordine
            </h2>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Subtotale prodotti</span>
                <span className="text-slate-100">
                  {formatMoney(subtotalCents, currency)}
                </span>
              </div>

              {discountCents > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Sconto</span>
                  <span className="text-emerald-300">
                    −{formatMoney(discountCents, currency)}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-slate-400">Subtotale</span>
                <span className="text-slate-100">
                  {formatMoney(subtotalCents - discountCents, currency)}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Spedizione</span>
                <span className="text-slate-100">
                  {isCalculatingShipping ? (
                    <span className="text-blue-300">Calcolo...</span>
                  ) : calculatedShippingCents > 0 ? (
                    formatMoney(calculatedShippingCents, currency)
                  ) : (
                    "Da calcolare"
                  )}
                </span>
              </div>
            </div>

            {calculatedShippingCents > 0 && (
              <p className="text-[11px] text-slate-400 mt-1">
                Spedizione calcolata da Shopify
              </p>
            )}

            <div className="border-t border-white/10 mt-3 pt-3 flex justify-between items-baseline">
              <span className="text-xs text-slate-400">Totale</span>
              <span className="text-lg font-semibold text-slate-50">
                {formatMoney(totalToPayCents, currency)}
              </span>
            </div>

            <p className="text-[11px] text-slate-500 mt-1">
              {!isFormValid()
                ? "Inserisci i dati di spedizione per calcolare il totale."
                : isCalculatingShipping
                ? "Calcolo spedizione in corso..."
                : "Totale aggiornato con spedizione."}
            </p>
          </div>
        </aside>
      </div>
    </main>
  )
}

// ... resto del codice identico (CheckoutPageContent, export default) ...

function CheckoutPageContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId") || ""

  const [cart, setCart] = useState<CartSessionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!sessionId) {
        setError("Sessione non valida: manca il sessionId.")
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const res = await fetch(
          `/api/cart-session?sessionId=${encodeURIComponent(sessionId)}`,
        )
        const data: CartSessionResponse & { error?: string } = await res.json()

        if (!res.ok || (data as any).error) {
          setError(
            data.error || "Errore nel recupero del carrello. Riprova dal sito.",
          )
          setLoading(false)
          return
        }

        setCart(data)
        setLoading(false)
      } catch (err: any) {
        console.error("Errore checkout:", err)
        setError(
          err?.message || "Errore imprevisto nel caricamento del checkout.",
        )
        setLoading(false)
      }
    }

    load()
  }, [sessionId])

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-300">
          Caricamento del checkout in corso…
        </p>
      </main>
    )
  }

  if (error || !cart) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-lg font-semibold">
            Impossibile caricare il checkout
          </h1>
          <p className="text-sm text-slate-400">{error}</p>
          <p className="text-xs text-slate-500">
            Ritorna al sito e riprova ad aprire il checkout.
          </p>
        </div>
      </main>
    )
  }

  const options = {
    clientSecret: cart.paymentIntentClientSecret || undefined,
    appearance: {
      theme: "night" as const,
      variables: {
        colorPrimary: "#22c55e",
      },
    },
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <CheckoutInner cart={cart} sessionId={sessionId} />
    </Elements>
  )
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
          <p className="text-sm text-slate-300">Caricamento del checkout…</p>
        </main>
      }
    >
      <CheckoutPageContent />
    </Suspense>
  )
}

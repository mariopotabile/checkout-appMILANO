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
import { loadStripe, Stripe } from "@stripe/stripe-js"
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js"

export const dynamic = "force-dynamic"

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
  shopDomain?: string
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

  const cartUrl = useMemo(() => {
    if (cart.shopDomain) {
      return `https://${cart.shopDomain}/cart`
    }
    return 'https://imjsqk-my.myshopify.com/cart'
  }, [cart.shopDomain])

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

  const addressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const scriptLoadedRef = useRef(false)

  const currency = (cart.currency || "EUR").toUpperCase()

  const subtotalCents = useMemo(() => {
    if (typeof cart.subtotalCents === "number") return cart.subtotalCents
    return cart.items.reduce((sum, item) => {
      const line = item.linePriceCents ?? item.priceCents ?? 0
      return sum + line
    }, 0)
  }, [cart])

  const shippingCents = calculatedShippingCents

  const discountCents = useMemo(() => {
    const shopifyTotal = typeof cart.totalCents === "number" ? cart.totalCents : subtotalCents
    const raw = subtotalCents - shopifyTotal
    return raw > 0 ? raw : 0
  }, [subtotalCents, cart.totalCents])

  const totalToPayCents = subtotalCents - discountCents + 590

  useEffect(() => {
    let mounted = true
    const win = window as any

    const initAutocomplete = () => {
      if (!mounted || !addressInputRef.current) return
      if (!win.google?.maps?.places) return

      try {
        if (autocompleteRef.current) {
          win.google.maps.event.clearInstanceListeners(autocompleteRef.current)
          autocompleteRef.current = null
        }

        autocompleteRef.current = new win.google.maps.places.Autocomplete(
          addressInputRef.current,
          {
            types: ["address"],
            componentRestrictions: {
              country: ["it", "fr", "de", "es", "at", "be", "nl", "ch", "pt"],
            },
            fields: ["address_components", "formatted_address", "geometry"],
          }
        )

        autocompleteRef.current.addListener("place_changed", () => {
          if (!mounted) return
          handlePlaceSelect()
        })
      } catch (err) {
        console.error("[Autocomplete] Errore:", err)
      }
    }

    if (!win.google?.maps?.places && !scriptLoadedRef.current) {
      scriptLoadedRef.current = true
      const script = document.createElement("script")
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

      if (!apiKey) {
        console.error("[Autocomplete] API Key mancante")
        return
      }

      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=it&callback=initGoogleMaps`
      script.async = true
      script.defer = true

      win.initGoogleMaps = () => {
        if (mounted) {
          requestAnimationFrame(() => {
            initAutocomplete()
          })
        }
      }

      script.onerror = () => {
        console.error("[Autocomplete] Errore caricamento")
      }

      document.head.appendChild(script)
    } else if (win.google?.maps?.places) {
      initAutocomplete()
    }

    return () => {
      mounted = false
      if (autocompleteRef.current && win.google?.maps?.event) {
        try {
          win.google.maps.event.clearInstanceListeners(autocompleteRef.current)
        } catch (e) {}
      }
    }
  }, [])

  function handlePlaceSelect() {
    const place = autocompleteRef.current?.getPlace()
    if (!place || !place.address_components) return

    let street = ""
    let streetNumber = ""
    let city = ""
    let province = ""
    let postalCode = ""
    let country = ""

    place.address_components.forEach((component: any) => {
      const types = component.types
      if (types.includes("route")) street = component.long_name
      if (types.includes("street_number")) streetNumber = component.long_name
      if (types.includes("locality")) city = component.long_name
      if (types.includes("postal_town") && !city) city = component.long_name
      if (types.includes("administrative_area_level_3") && !city) city = component.long_name
      if (types.includes("administrative_area_level_2")) province = component.short_name
      if (types.includes("administrative_area_level_1") && !province) province = component.short_name
      if (types.includes("postal_code")) postalCode = component.long_name
      if (types.includes("country")) country = component.short_name
    })

    const fullAddress = streetNumber ? `${street} ${streetNumber}` : street

    setCustomer((prev) => ({
      ...prev,
      address1: fullAddress || prev.address1,
      city: city || prev.city,
      postalCode: postalCode || prev.postalCode,
      province: province || prev.province,
      countryCode: country || prev.countryCode,
    }))
  }

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setCustomer((prev) => ({ ...prev, [name]: value }))
  }

  function isFormValid() {
    return (
      customer.fullName.trim().length > 2 &&
      customer.email.trim().includes("@") &&
      customer.email.trim().length > 5 &&
      customer.phone.trim().length > 8 &&
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
        const flatShippingCents = 590
        setCalculatedShippingCents(flatShippingCents)

        const shopifyTotal = typeof cart.totalCents === "number" ? cart.totalCents : subtotalCents
        const currentDiscountCents = subtotalCents - shopifyTotal
        const finalDiscountCents = currentDiscountCents > 0 ? currentDiscountCents : 0
        const newTotalCents = subtotalCents - finalDiscountCents + flatShippingCents

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

        console.log('[Checkout] ✅ ClientSecret ricevuto:', piData.clientSecret.substring(0, 30))
        setClientSecret(piData.clientSecret)
        setIsCalculatingShipping(false)
      } catch (err: any) {
        console.error("Errore creazione payment:", err)
        setShippingError(err.message || "Errore nel calcolo del totale")
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
    cart.totalCents,
  ])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!isFormValid()) {
      setError("Compila tutti i campi obbligatori")
      return
    }

    if (!stripe || !elements) {
      setError("Stripe non pronto")
      return
    }

    if (!clientSecret) {
      setError("Payment Intent non creato")
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
        },
        redirect: "if_required",
      })

      if (stripeError) {
        console.error("Stripe error:", stripeError)
        setError(stripeError.message || "Pagamento non riuscito")
        setLoading(false)
        return
      }

      setSuccess(true)
      setLoading(false)

      setTimeout(() => {
        window.location.href = `/thank-you?sessionId=${sessionId}`
      }, 2000)
    } catch (err: any) {
      console.error("Errore pagamento:", err)
      setError(err.message || "Errore imprevisto")
      setLoading(false)
    }
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
          color: #1a1a1a;
        }

        .shopify-input {
          width: 100%;
          padding: 11px 14px;
          font-size: 14px;
          line-height: 1.5;
          color: #1a1a1a;
          background: #fff;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .shopify-input:focus {
          outline: none;
          border-color: #005bd3;
          box-shadow: 0 0 0 3px rgba(0, 91, 211, 0.1);
        }

        .shopify-label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: #303030;
          margin-bottom: 6px;
        }

        .shopify-btn {
          width: 100%;
          padding: 16px 24px;
          font-size: 15px;
          font-weight: 600;
          color: #fff;
          background: #005bd3;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .shopify-btn:hover:not(:disabled) {
          background: #004db5;
        }

        .shopify-btn:disabled {
          background: #d1d5db;
          cursor: not-allowed;
        }

        .shopify-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 16px;
        }

        .summary-line {
          display: flex;
          justify-content: space-between;
          font-size: 14px;
          margin-bottom: 8px;
        }

        .summary-line.total {
          font-size: 18px;
          font-weight: 600;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #e5e7eb;
        }

        .pac-container {
          background-color: #ffffff !important;
          border: 1px solid #e5e7eb !important;
          border-radius: 12px !important;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12) !important;
          margin-top: 8px !important;
          padding: 8px !important;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
          z-index: 9999 !important;
          overflow: hidden !important;
        }

        .pac-container::after {
          display: none !important;
        }

        .pac-item {
          padding: 12px 14px !important;
          cursor: pointer !important;
          border: none !important;
          border-radius: 8px !important;
          font-size: 14px !important;
          line-height: 1.4 !important;
          color: #1a1a1a !important;
          transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
          margin: 2px 0 !important;
        }

        .pac-item:hover {
          background-color: #f5f5f7 !important;
          transform: translateX(2px) !important;
        }

        .pac-item-selected,
        .pac-item-selected:hover {
          background-color: #e8e8ed !important;
        }

        .pac-item-selected .pac-item-query,
        .pac-item-selected .pac-matched {
          color: #000000 !important;
        }

        .pac-icon {
          display: none !important;
        }

        .pac-item-query {
          font-size: 14px !important;
          font-weight: 500 !important;
          color: #1a1a1a !important;
          letter-spacing: -0.01em !important;
        }

        .pac-matched {
          font-weight: 600 !important;
          color: #000000 !important;
        }

        span.pac-item-query + span {
          font-size: 12px !important;
          color: #86868b !important;
          margin-top: 2px !important;
          font-weight: 400 !important;
        }

        .pac-item:not(:last-child) {
          border-bottom: none !important;
        }

        .pac-logo::after {
          display: none !important;
        }

        .pac-container:empty {
          display: none !important;
        }

        @media (max-width: 999px) {
          .mobile-order-summary {
            display: block;
          }
          .desktop-order-summary {
            display: none;
          }
        }

        @media (min-width: 1000px) {
          .mobile-order-summary {
            display: none;
          }
          .desktop-order-summary {
            display: block;
          }
        }

        @media (max-width: 768px) {
          .shopify-input {
            font-size: 16px !important;
          }

          .pac-container {
            border-radius: 8px !important;
            left: 4px !important;
            right: 4px !important;
            max-width: calc(100% - 8px) !important;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15) !important;
          }
          
          .pac-item {
            padding: 14px 12px !important;
            font-size: 15px !important;
          }

          .pac-item-query {
            font-size: 15px !important;
          }
        }
      `}</style>

      <div className="min-h-screen bg-[#fafafa]">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex justify-center">
              <a href={cartUrl} className="transition-opacity hover:opacity-70">
                <img
                  src="https://cdn.shopify.com/s/files/1/0899/2188/0330/files/logo_checkify_d8a640c7-98fe-4943-85c6-5d1a633416cf.png?v=1761832152"
                  alt="Not For Resale"
                  className="h-16 sm:h-20"
                  style={{ maxWidth: '280px', width: 'auto' }}
                />
              </a>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="lg:grid lg:grid-cols-2 lg:gap-12">
            
            <div className="lg:pr-8">
              <form onSubmit={handleSubmit} className="space-y-6">

                <div className="shopify-card">
                  <h2 className="text-base font-semibold mb-4">Informazioni di contatto</h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="shopify-label">Nome completo *</label>
                      <input
                        type="text"
                        name="fullName"
                        value={customer.fullName}
                        onChange={handleChange}
                        className="shopify-input"
                        required
                      />
                    </div>

                    <div>
                      <label className="shopify-label">Email *</label>
                      <input
                        type="email"
                        name="email"
                        value={customer.email}
                        onChange={handleChange}
                        className="shopify-input"
                        required
                      />
                    </div>

                    <div>
                      <label className="shopify-label">Telefono *</label>
                      <input
                        type="tel"
                        name="phone"
                        value={customer.phone}
                        onChange={handleChange}
                        className="shopify-input"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="shopify-card">
                  <h2 className="text-base font-semibold mb-4">Indirizzo di spedizione</h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="shopify-label">Indirizzo *</label>
                      <input
                        ref={addressInputRef}
                        type="text"
                        name="address1"
                        value={customer.address1}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder="Via, numero civico"
                        required
                      />
                    </div>

                    <div>
                      <label className="shopify-label">Appartamento, scala, ecc.</label>
                      <input
                        type="text"
                        name="address2"
                        value={customer.address2}
                        onChange={handleChange}
                        className="shopify-input"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="shopify-label">Città *</label>
                        <input
                          type="text"
                          name="city"
                          value={customer.city}
                          onChange={handleChange}
                          className="shopify-input"
                          required
                        />
                      </div>

                      <div>
                        <label className="shopify-label">CAP *</label>
                        <input
                          type="text"
                          name="postalCode"
                          value={customer.postalCode}
                          onChange={handleChange}
                          className="shopify-input"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="shopify-label">Provincia *</label>
                        <input
                          type="text"
                          name="province"
                          value={customer.province}
                          onChange={handleChange}
                          className="shopify-input"
                          required
                        />
                      </div>

                      <div>
                        <label className="shopify-label">Paese *</label>
                        <select
                          name="countryCode"
                          value={customer.countryCode}
                          onChange={handleChange}
                          className="shopify-input"
                          required
                        >
                          <option value="IT">Italia</option>
                          <option value="FR">Francia</option>
                          <option value="DE">Germania</option>
                          <option value="ES">Spagna</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="shopify-card">
                  <h2 className="text-base font-semibold mb-4">Metodo di pagamento</h2>
                  
                  {isCalculatingShipping && (
                    <p className="text-sm text-gray-600 mb-4">Calcolo in corso...</p>
                  )}

                  {shippingError && (
                    <p className="text-sm text-red-600 mb-4">{shippingError}</p>
                  )}

                  {clientSecret && !isCalculatingShipping && (
                    <div className="mt-4">
                      <PaymentElement />
                    </div>
                  )}

                  {!clientSecret && !isCalculatingShipping && (
                    <p className="text-sm text-gray-500">
                      Compila tutti i campi per visualizzare i metodi di pagamento
                    </p>
                  )}
                </div>

                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                {success && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-700">✅ Pagamento completato! Reindirizzamento...</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !stripe || !elements || !clientSecret || isCalculatingShipping}
                  className="shopify-btn"
                >
                  {loading ? "Elaborazione..." : `Paga ${formatMoney(totalToPayCents, currency)}`}
                </button>
              </form>
            </div>

            <div className="mt-8 lg:mt-0 desktop-order-summary">
              <div className="shopify-card sticky top-8">
                <h2 className="text-base font-semibold mb-4">Riepilogo ordine</h2>
                
                <div className="space-y-3 mb-4">
                  {cart.items.map((item, idx) => (
                    <div key={idx} className="flex gap-3">
                      {item.image && (
                        <img
                          src={item.image}
                          alt={item.title}
                          className="w-16 h-16 object-cover rounded border"
                        />
                      )}
                      <div className="flex-1">
                        <p className="text-sm font-medium">{item.title}</p>
                        {item.variantTitle && (
                          <p className="text-xs text-gray-500">{item.variantTitle}</p>
                        )}
                        <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                      </div>
                      <p className="text-sm font-medium">
                        {formatMoney(item.linePriceCents || item.priceCents || 0, currency)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-4 space-y-2">
                  <div className="summary-line">
                    <span>Subtotale</span>
                    <span>{formatMoney(subtotalCents, currency)}</span>
                  </div>

                  {discountCents > 0 && (
                    <div className="summary-line text-green-600">
                      <span>Sconto</span>
                      <span>-{formatMoney(discountCents, currency)}</span>
                    </div>
                  )}

                  <div className="summary-line">
                    <span>Spedizione</span>
                    <span>{shippingCents > 0 ? formatMoney(shippingCents, currency) : "€5,90"}</span>
                  </div>

                  <div className="summary-line total">
                    <span>Totale</span>
                    <span>{formatMoney(totalToPayCents, currency)}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}

function CheckoutPageContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId") || ""

  const [cart, setCart] = useState<CartSessionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)

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

        try {
          const pkRes = await fetch('/api/stripe-status')
          
          if (!pkRes.ok) {
            throw new Error('API stripe-status non disponibile')
          }
          
          const pkData = await pkRes.json()

          if (pkData.publishableKey) {
            console.log('[Checkout] ✅ Publishable key dinamica:', pkData.publishableKey.substring(0, 30))
            console.log('[Checkout] ✅ Account:', pkData.accountLabel)
            setStripePromise(loadStripe(pkData.publishableKey))
          } else {
            throw new Error('PublishableKey non ricevuta da API')
          }
        } catch (err) {
          console.error('[Checkout] ❌ Errore caricamento stripe-status:', err)
          setError('Impossibile inizializzare il sistema di pagamento. Riprova.')
          setLoading(false)
          return
        }

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

  if (loading || !stripePromise) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <p className="text-sm text-gray-600">Caricamento del checkout…</p>
      </div>
    )
  }

  if (error || !cart) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-lg font-semibold">Impossibile caricare il checkout</h1>
          <p className="text-sm text-gray-600">{error}</p>
          <p className="text-xs text-gray-500">
            Ritorna al sito e riprova ad aprire il checkout.
          </p>
        </div>
      </div>
    )
  }

  // ✅ Inizializza Elements con mode, amount e currency
  const options = {
    mode: 'payment' as const,
    amount: 1000,
    currency: (cart.currency || 'eur').toLowerCase(),
    appearance: {
      theme: "stripe" as const,
      variables: {
        colorPrimary: "#005bd3",
        colorBackground: "#ffffff",
        colorText: "#1a1a1a",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        borderRadius: "8px",
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
        <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
          <p className="text-sm text-gray-600">Caricamento…</p>
        </div>
      }
    >
      <CheckoutPageContent />
    </Suspense>
  )
}


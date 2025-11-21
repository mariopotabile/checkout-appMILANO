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

  const [expressCheckoutReady, setExpressCheckoutReady] = useState<boolean | null>(null)
  const [expressCheckoutError, setExpressCheckoutError] = useState<string | null>(null)
  const expressCheckoutRef = useRef<any>(null)

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

  // EXPRESS CHECKOUT INIT
  useEffect(() => {
    async function initExpressCheckout() {
      if (!stripe || expressCheckoutRef.current) return

      try {
        const res = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            sessionId,
            cartData: cart 
          })
        })

        if (!res.ok) {
          const errorText = await res.text()
          console.error('[Express] API Error:', errorText)
          setExpressCheckoutReady(false)
          return
        }

        const data = await res.json()

        if (!data.clientSecret) {
          console.error('[Express] Missing clientSecret')
          setExpressCheckoutReady(false)
          return
        }

        const checkout = await stripe.initCheckout({ 
          clientSecret: data.clientSecret 
        })

        const expressElement = checkout.createExpressCheckoutElement()

        expressElement.on('ready', (event: any) => {
          console.log('[Express] Ready event:', event)
          
          if (!event.availablePaymentMethods || event.availablePaymentMethods.length === 0) {
            console.log('[Express] ⚠️ Nessun metodo disponibile, nascondo sezione')
            setExpressCheckoutReady(false)
            
            if (expressCheckoutRef.current) {
              expressCheckoutRef.current.unmount()
              expressCheckoutRef.current = null
            }
          } else {
            console.log('[Express] ✅ Metodi disponibili:', event.availablePaymentMethods)
            setExpressCheckoutReady(true)
          }
        })

        expressElement.mount('#express-checkout-element')
        expressCheckoutRef.current = expressElement

        const loadActionsResult = await checkout.loadActions()
        
        if (loadActionsResult.type === 'success') {
          expressElement.on('confirm', async (event) => {
            const result = await loadActionsResult.actions.confirm({
              expressCheckoutConfirmEvent: event
            })

            if (result.type === 'success') {
              console.log('[Express] ✅ Pagamento completato')
              window.location.href = `/checkout-return?session_id=${data.checkoutSessionId}`
            } else {
              setExpressCheckoutError('Pagamento non riuscito')
            }
          })
        }

        console.log('[Express Checkout] ✅ Inizializzato')
      } catch (err: any) {
        console.error('[Express Checkout Error]:', err)
        setExpressCheckoutReady(false)
      }
    }

    initExpressCheckout()
  }, [stripe, sessionId, cart])

  // GOOGLE MAPS AUTOCOMPLETE
  useEffect(() => {
    let mounted = true
    const win = window as any

    const initAutocomplete = () => {
      if (!mounted || !addressInputRef.current) {
        return
      }

      if (!win.google?.maps?.places) {
        return
      }

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

        console.log("[Autocomplete] ✅ Inizializzato")
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
        } catch (e) {
          // Silent cleanup
        }
      }
    }
  }, [])

  function handlePlaceSelect() {
    const place = autocompleteRef.current?.getPlace()

    if (!place || !place.address_components) {
      return
    }

    let street = ""
    let streetNumber = ""
    let city = ""
    let province = ""
    let postalCode = ""
    let country = ""

    place.address_components.forEach((component: any) => {
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
      if (types.includes("postal_town") && !city) {
        city = component.long_name
      }
      if (types.includes("administrative_area_level_3") && !city) {
        city = component.long_name
      }
      if (types.includes("administrative_area_level_2")) {
        province = component.short_name
      }
      if (types.includes("administrative_area_level_1") && !province) {
        province = component.short_name
      }
      if (types.includes("postal_code")) {
        postalCode = component.long_name
      }
      if (types.includes("country")) {
        country = component.short_name
      }
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
      setError("Compila tutti i campi obbligatori per procedere al pagamento.")
      return
    }

    if (!stripe || !elements) {
      setError("Stripe non è ancora pronto, riprova tra qualche secondo.")
      return
    }

    if (!clientSecret) {
      setError("Payment Intent non ancora creato. Attendi il calcolo del totale.")
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
        setError(stripeError.message || "Pagamento non riuscito.")
        setLoading(false)
        return
      }

      setSuccess(true)
      setLoading(false)

      console.log("[Checkout] ✅ Pagamento completato, redirect...")

      setTimeout(() => {
        window.location.href = `/thank-you?sessionId=${sessionId}`
      }, 2000)
    } catch (err: any) {
      console.error("Errore pagamento:", err)
      setError(err.message || "Errore imprevisto durante il pagamento.")
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

        #express-checkout-element {
          min-height: 50px;
        }

        .express-divider {
          position: relative;
          text-align: center;
          margin: 24px 0;
        }

        .express-divider::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 1px;
          background: #e5e7eb;
        }

        .express-divider span {
          position: relative;
          display: inline-block;
          padding: 0 16px;
          background: #fff;
          color: #6b7280;
          font-size: 14px;
          font-weight: 500;
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
              <a 
                href={cartUrl}
                className="transition-opacity hover:opacity-70 cursor-pointer"
                title="Torna al carrello"
              >
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

        <div className="mobile-order-summary bg-white border-b border-gray-200 lg:hidden">
          <details className="px-4 py-3">
            <summary className="flex justify-between items-center cursor-pointer">
              <span className="text-sm font-medium text-blue-600">
                Mostra riepilogo ordine
              </span>
              <span className="text-lg font-semibold">
                {formatMoney(totalToPayCents, currency)}
              </span>
            </summary>
            <div className="mt-4 space-y-3">
              {cart.items.map((item, idx) => {
                const baseUnit =
                  typeof item.priceCents === "number"
                    ? item.priceCents
                    : item.linePriceCents ?? 0
                const line =
                  typeof item.linePriceCents === "number"
                    ? item.linePriceCents
                    : baseUnit * item.quantity

                return (
                  <div key={`${item.id}-${idx}`} className="flex gap-3">
                    {item.image && (
                      <div className="relative w-16 h-16 rounded-lg border border-gray-200 flex-shrink-0 overflow-hidden">
                        <img
                          src={item.image}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute -top-2 -right-2 bg-gray-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                          {item.quantity}
                        </span>
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.title}</p>
                      {item.variantTitle && (
                        <p className="text-xs text-gray-600">{item.variantTitle}</p>
                      )}
                    </div>
                    <p className="text-sm font-medium">{formatMoney(line, currency)}</p>
                  </div>
                )
              })}

              <div className="border-t border-gray-200 pt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotale</span>
                  <span>{formatMoney(subtotalCents - discountCents, currency)}</span>
                </div>
                {discountCents > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Sconto</span>
                    <span>-{formatMoney(discountCents, currency)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Spedizione</span>
                  <span>€5,90</span>
                </div>
                <div className="flex justify-between text-lg font-semibold pt-2 border-t border-gray-200">
                  <span>Totale</span>
                  <span>{formatMoney(totalToPayCents, currency)}</span>
                </div>
              </div>
            </div>
          </details>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          <div className="lg:grid lg:grid-cols-2 lg:gap-12">
            <div className="order-2 lg:order-1">
              
              {/* EXPRESS CHECKOUT - MOSTRA SOLO SE DISPONIBILE */}
              {expressCheckoutReady === true && (
                <div className="shopify-card mb-6">
                  <h2 className="text-lg font-semibold mb-4">Checkout Rapido</h2>
                  
                  <div id="express-checkout-element"></div>

                  {expressCheckoutError && (
                    <p className="text-sm text-red-600 mt-3 bg-red-50 border border-red-200 rounded-lg p-3">
                      {expressCheckoutError}
                    </p>
                  )}

                  <div className="express-divider">
                    <span>oppure</span>
                  </div>
                </div>
              )}

              {/* FORM TRADIZIONALE */}
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="shopify-card">
                  <h2 className="text-lg font-semibold mb-4">Contatti</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="shopify-label">
                        Email <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="email"
                        name="email"
                        value={customer.email}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder="nome@email.com"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="shopify-card">
                  <h2 className="text-lg font-semibold mb-4">Consegna</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="shopify-label">
                        Nome completo <span className="text-red-600">*</span>
                      </label>
                      <input
                        name="fullName"
                        value={customer.fullName}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder="Nome e cognome"
                        required
                      />
                    </div>

                    <div>
                      <label className="shopify-label">
                        Indirizzo{" "}
                        <span className="text-xs text-gray-500">🔍 Digita per autocompletare</span>
                        <span className="text-red-600"> *</span>
                      </label>
                      <input
                        ref={addressInputRef}
                        name="address1"
                        value={customer.address1}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder="Via, numero civico"
                        required
                        autoComplete="off"
                        type="text"
                      />
                      <p className="text-[10px] text-gray-500 mt-1">
                        Inizia a digitare e seleziona dalla lista
                      </p>
                    </div>

                    <div>
                      <label className="shopify-label">Appartamento, scala, ecc. (opzionale)</label>
                      <input
                        name="address2"
                        value={customer.address2}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder="Es. Interno 5, Scala B"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="shopify-label">
                          Città <span className="text-red-600">*</span>
                        </label>
                        <input
                          name="city"
                          value={customer.city}
                          onChange={handleChange}
                          className="shopify-input"
                          placeholder="Città"
                          required
                        />
                      </div>

                      <div>
                        <label className="shopify-label">
                          CAP <span className="text-red-600">*</span>
                        </label>
                        <input
                          name="postalCode"
                          value={customer.postalCode}
                          onChange={handleChange}
                          className="shopify-input"
                          placeholder="00100"
                          required
                        />
                      </div>

                      <div>
                        <label className="shopify-label">
                          Prov. <span className="text-red-600">*</span>
                        </label>
                        <input
                          name="province"
                          value={customer.province}
                          onChange={handleChange}
                          className="shopify-input"
                          placeholder="RM"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="shopify-label">
                        Telefono <span className="text-red-600">*</span>
                      </label>
                      <input
                        name="phone"
                        type="tel"
                        value={customer.phone}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder="+39 333 1234567"
                        required
                        minLength={9}
                      />
                      <p className="text-[10px] text-gray-500 mt-1">
                        Necessario per la consegna
                      </p>
                    </div>
                  </div>
                </div>

                {calculatedShippingCents > 0 && (
                  <div className="shopify-card">
                    <h2 className="text-lg font-semibold mb-4">Metodo di spedizione</h2>
                    <div className="flex items-center justify-between p-3 border border-gray-300 rounded-lg bg-gray-50">
                      <span className="text-sm font-medium">BRT Express 24h</span>
                      <span className="text-sm font-semibold">€5,90</span>
                    </div>
                  </div>
                )}

                <div className="shopify-card">
                  <h2 className="text-lg font-semibold mb-4">Pagamento</h2>

                  {isCalculatingShipping && (
                    <p className="text-sm text-blue-600 mb-4">Calcolo totale in corso...</p>
                  )}

                  {shippingError && (
                    <p className="text-sm text-red-600 mb-4">{shippingError}</p>
                  )}

                  {!clientSecret && !isCalculatingShipping && !shippingError && (
                    <p className="text-sm text-gray-600 mb-4">
                      Inserisci i dati di spedizione per procedere.
                    </p>
                  )}

                  {clientSecret && (
                    <div className="mb-4">
                      <PaymentElement options={{ layout: "tabs" }} />
                    </div>
                  )}

                  <button
                    type="submit"
                    className="shopify-btn"
                    disabled={
                      loading ||
                      !stripe ||
                      !elements ||
                      !isFormValid() ||
                      !clientSecret ||
                      isCalculatingShipping
                    }
                  >
                    {loading
                      ? "Elaborazione..."
                      : isCalculatingShipping
                      ? "Calcolo totale..."
                      : `Paga ${formatMoney(totalToPayCents, currency)}`}
                  </button>

                  {error && (
                    <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                      {error}
                    </p>
                  )}

                  {success && (
                    <div className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="font-semibold">Pagamento riuscito!</span>
                      </div>
                      <p className="text-xs">Stiamo creando il tuo ordine e ti reindirizziamo...</p>
                    </div>
                  )}
                </div>
              </form>
            </div>

            <div className="desktop-order-summary order-1 lg:order-2 mb-8 lg:mb-0">
              <div className="shopify-card lg:sticky lg:top-6">
                <h2 className="text-lg font-semibold mb-4">Riepilogo ordine</h2>

                <div className="space-y-4 mb-6">
                  {cart.items.map((item, idx) => {
                    const baseUnit =
                      typeof item.priceCents === "number"
                        ? item.priceCents
                        : item.linePriceCents ?? 0
                    const line =
                      typeof item.linePriceCents === "number"
                        ? item.linePriceCents
                        : baseUnit * item.quantity

                    return (
                      <div key={`${item.id}-${idx}`} className="flex gap-4">
                        {item.image && (
                          <div className="relative w-16 h-16 rounded-lg border border-gray-200 flex-shrink-0 overflow-hidden">
                            <img
                              src={item.image}
                              alt={item.title}
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute -top-2 -right-2 bg-gray-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                              {item.quantity}
                            </span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          {item.variantTitle && (
                            <p className="text-xs text-gray-600">{item.variantTitle}</p>
                          )}
                        </div>
                        <p className="text-sm font-medium whitespace-nowrap">
                          {formatMoney(line, currency)}
                        </p>
                      </div>
                    )
                  })}
                </div>

                <div className="space-y-2 text-sm">
                  <div className="summary-line">
                    <span className="text-gray-600">Subtotale</span>
                    <span>{formatMoney(subtotalCents - discountCents, currency)}</span>
                  </div>

                  {discountCents > 0 && (
                    <div className="summary-line text-red-600">
                      <span>Sconto</span>
                      <span>-{formatMoney(discountCents, currency)}</span>
                    </div>
                  )}

                  <div className="summary-line">
                    <span className="text-gray-600">Spedizione</span>
                    <span>€5,90</span>
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

  const options = {
    clientSecret: cart.paymentIntentClientSecret || undefined,
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


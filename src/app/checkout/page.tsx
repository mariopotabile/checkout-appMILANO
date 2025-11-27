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
    return 'https://notforresale.it/cart'
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

  const [useDifferentBilling, setUseDifferentBilling] = useState(false)
  const [billingAddress, setBillingAddress] = useState<CustomerForm>({
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
  const [orderSummaryExpanded, setOrderSummaryExpanded] = useState(false)

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

  const firstName = customer.fullName.split(" ")[0] || ""
  const lastName = customer.fullName.split(" ").slice(1).join(" ") || ""

  const billingFirstName = billingAddress.fullName.split(" ")[0] || ""
  const billingLastName = billingAddress.fullName.split(" ").slice(1).join(" ") || ""

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
    const shippingValid = 
      customer.fullName.trim().length > 2 &&
      customer.email.trim().includes("@") &&
      customer.email.trim().length > 5 &&
      customer.phone.trim().length > 8 &&
      customer.address1.trim().length > 3 &&
      customer.city.trim().length > 1 &&
      customer.postalCode.trim().length > 2 &&
      customer.province.trim().length > 1 &&
      customer.countryCode.trim().length >= 2

    if (!useDifferentBilling) return shippingValid

    const billingValid =
      billingAddress.fullName.trim().length > 2 &&
      billingAddress.address1.trim().length > 3 &&
      billingAddress.city.trim().length > 1 &&
      billingAddress.postalCode.trim().length > 2 &&
      billingAddress.province.trim().length > 1 &&
      billingAddress.countryCode.trim().length >= 2

    return shippingValid && billingValid
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

        console.log('[Checkout] ✅ ClientSecret ricevuto')
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
    billingAddress.fullName,
    billingAddress.address1,
    billingAddress.city,
    billingAddress.postalCode,
    billingAddress.province,
    billingAddress.countryCode,
    useDifferentBilling,
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

      const { error: submitError } = await elements.submit()
      if (submitError) {
        console.error("Errore submit elements:", submitError)
        setError(submitError.message || "Errore nella validazione")
        setLoading(false)
        return
      }

      const finalBillingAddress = useDifferentBilling ? billingAddress : customer

      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        clientSecret: clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/thank-you?sessionId=${sessionId}`,
          payment_method_data: {
            billing_details: {
              name: finalBillingAddress.fullName,
              email: customer.email,
              phone: finalBillingAddress.phone || customer.phone || undefined,
              address: {
                line1: finalBillingAddress.address1,
                line2: finalBillingAddress.address2 || undefined,
                city: finalBillingAddress.city,
                postal_code: finalBillingAddress.postalCode,
                state: finalBillingAddress.province,
                country: finalBillingAddress.countryCode || "IT",
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
          color: #333333;
          -webkit-font-smoothing: antialiased;
        }

        .shopify-input {
          width: 100%;
          padding: 13px 12px;
          font-size: 16px;
          line-height: 1.4;
          color: #333333;
          background: #ffffff;
          border: 1px solid #d9d9d9;
          border-radius: 5px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          -webkit-appearance: none;
          appearance: none;
        }

        .shopify-input:focus {
          outline: none;
          border-color: #2C6ECB;
          box-shadow: 0 0 0 1px #2C6ECB;
        }

        .shopify-input::placeholder {
          color: #999999;
        }

        .shopify-label {
          display: block;
          font-size: 13px;
          font-weight: 400;
          color: #333333;
          margin-bottom: 8px;
        }

        .shopify-btn {
          width: 100%;
          padding: 18px 24px;
          font-size: 16px;
          font-weight: 600;
          color: #ffffff;
          background: #2C6ECB;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.2s ease;
          -webkit-appearance: none;
          appearance: none;
          touch-action: manipulation;
        }

        .shopify-btn:hover:not(:disabled) {
          background: #1f5bb8;
        }

        .shopify-btn:disabled {
          background: #d1d5db;
          cursor: not-allowed;
        }

        .shopify-section {
          background: #ffffff;
          border: 1px solid #e1e1e1;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
        }

        .shopify-section-title {
          font-size: 15px;
          font-weight: 600;
          color: #333333;
          margin-bottom: 16px;
        }

        .summary-toggle {
          background: #ffffff;
          border: 1px solid #e1e1e1;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 20px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          -webkit-tap-highlight-color: transparent;
        }

        .summary-toggle:active {
          background: #fafafa;
        }

        .summary-content {
          background: #ffffff;
          border: 1px solid #e1e1e1;
          border-top: none;
          border-radius: 0 0 8px 8px;
          padding: 16px;
          margin-top: -20px;
          margin-bottom: 20px;
        }

        .pac-container {
          background-color: #ffffff !important;
          border: 1px solid #d9d9d9 !important;
          border-radius: 5px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
          margin-top: 4px !important;
          padding: 4px !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
          z-index: 9999 !important;
        }

        .pac-item {
          padding: 10px 12px !important;
          cursor: pointer !important;
          border: none !important;
          border-radius: 4px !important;
          font-size: 14px !important;
          color: #333333 !important;
        }

        .pac-item:hover {
          background-color: #f5f5f5 !important;
        }

        .pac-icon {
          display: none !important;
        }

        @media (max-width: 768px) {
          .shopify-input {
            font-size: 16px !important;
          }
          
          .shopify-btn {
            min-height: 48px;
          }
        }
      `}</style>

      <div className="min-h-screen bg-[#fafafa]">
        {/* ✅ HEADER STICKY con badge sicurezza */}
        <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 py-3.5">
            <div className="flex justify-between items-center">
              <a href={cartUrl}>
                <img
                  src="https://cdn.shopify.com/s/files/1/0899/2188/0330/files/logo_checkify_d8a640c7-98fe-4943-85c6-5d1a633416cf.png?v=1761832152"
                  alt="Logo"
                  className="h-8"
                  style={{ maxWidth: '140px' }}
                />
              </a>
              <div className="flex items-center gap-1.5 text-xs text-gray-600 bg-green-50 px-2.5 py-1 rounded-full border border-green-200">
                <svg className="w-3.5 h-3.5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                <span className="font-medium hidden sm:inline">Pagamento sicuro</span>
              </div>
            </div>
          </div>
        </header>

        {/* Mobile Summary Toggle */}
        <div className="max-w-2xl mx-auto px-4 py-6 lg:hidden">
          <div
            className="summary-toggle"
            onClick={() => setOrderSummaryExpanded(!orderSummaryExpanded)}
          >
            <div className="flex items-center gap-2">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                style={{
                  transform: orderSummaryExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease'
                }}
              >
                <path d="M4 6L8 10L12 6" stroke="#333" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="text-sm font-medium text-blue-600">
                {orderSummaryExpanded ? 'Nascondi' : 'Mostra'} riepilogo ordine
              </span>
            </div>
            <span className="text-base font-semibold">{formatMoney(totalToPayCents, currency)}</span>
          </div>

          {orderSummaryExpanded && (
            <div className="summary-content">
              <div className="space-y-3 mb-4">
                {cart.items.map((item, idx) => (
                  <div key={idx} className="flex gap-3">
                    {item.image && (
                      <div className="relative flex-shrink-0">
                        <img
                          src={item.image}
                          alt={item.title}
                          className="w-16 h-16 object-cover rounded border border-gray-200"
                        />
                        <span className="absolute -top-2 -right-2 bg-gray-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                          {item.quantity}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                      {item.variantTitle && (
                        <p className="text-xs text-gray-500 mt-1">{item.variantTitle}</p>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 flex-shrink-0">
                      {formatMoney(item.linePriceCents || item.priceCents || 0, currency)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-200 pt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotale</span>
                  <span className="text-gray-900">{formatMoney(subtotalCents, currency)}</span>
                </div>

                {discountCents > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Sconto</span>
                    <span>-{formatMoney(discountCents, currency)}</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className="text-gray-600">Spedizione</span>
                  <span className="text-gray-900">{shippingCents > 0 ? formatMoney(shippingCents, currency) : "€5,90"}</span>
                </div>

                <div className="flex justify-between text-base font-semibold pt-3 border-t border-gray-200">
                  <span>Totale</span>
                  <span className="text-lg">{formatMoney(totalToPayCents, currency)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="max-w-6xl mx-auto px-4 pb-8">
          <div className="lg:grid lg:grid-cols-2 lg:gap-16">
            
            {/* FORM COLUMN */}
            <div>
              {/* ✅ TRUST BADGES */}
              <div className="mb-5 bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-gray-700">
                    <span>🔒</span>
                    <span className="leading-tight">3D Secure</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-700">
                    <span>🚚</span>
                    <span className="leading-tight">24/48h</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-700">
                    <span>🔄</span>
                    <span className="leading-tight">Reso 14gg</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-700">
                    <span>🛡️</span>
                    <span className="leading-tight">Protetto</span>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">

                <div className="shopify-section">
                  <h2 className="shopify-section-title">Contatti</h2>
                  
                  <div>
                    <label className="shopify-label">Email o numero di telefono cellulare</label>
                    <input
                      type="email"
                      name="email"
                      value={customer.email}
                      onChange={handleChange}
                      className="shopify-input"
                      placeholder=""
                      required
                      autoComplete="email"
                    />
                  </div>

                  <div className="flex items-start gap-2 mt-3">
                    <input 
                      type="checkbox" 
                      id="emailUpdates" 
                      className="w-4 h-4 mt-0.5 flex-shrink-0" 
                    />
                    <label htmlFor="emailUpdates" className="text-xs text-gray-600 leading-relaxed">
                      Inviami email con notizie e offerte
                    </label>
                  </div>
                </div>

                <div className="shopify-section">
                  <h2 className="shopify-section-title">Consegna</h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="shopify-label">Paese / Regione</label>
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

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="shopify-label">Nome</label>
                        <input
                          type="text"
                          name="firstName"
                          value={firstName}
                          onChange={(e) => {
                            setCustomer(prev => ({
                              ...prev,
                              fullName: `${e.target.value} ${lastName}`.trim()
                            }))
                          }}
                          className="shopify-input"
                          placeholder=""
                          required
                          autoComplete="given-name"
                        />
                      </div>

                      <div>
                        <label className="shopify-label">Cognome</label>
                        <input
                          type="text"
                          name="lastName"
                          value={lastName}
                          onChange={(e) => {
                            setCustomer(prev => ({
                              ...prev,
                              fullName: `${firstName} ${e.target.value}`.trim()
                            }))
                          }}
                          className="shopify-input"
                          placeholder=""
                          required
                          autoComplete="family-name"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="shopify-label">Azienda (facoltativo)</label>
                      <input
                        type="text"
                        className="shopify-input"
                        placeholder=""
                        autoComplete="organization"
                      />
                    </div>

                    <div>
                      <label className="shopify-label">Indirizzo</label>
                      <input
                        ref={addressInputRef}
                        type="text"
                        name="address1"
                        value={customer.address1}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder=""
                        required
                        autoComplete="address-line1"
                      />
                    </div>

                    <div>
                      <label className="shopify-label">Interno, scala, ecc. (facoltativo)</label>
                      <input
                        type="text"
                        name="address2"
                        value={customer.address2}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder=""
                        autoComplete="address-line2"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="shopify-label">CAP</label>
                        <input
                          type="text"
                          name="postalCode"
                          value={customer.postalCode}
                          onChange={handleChange}
                          className="shopify-input"
                          placeholder=""
                          required
                          autoComplete="postal-code"
                        />
                      </div>

                      <div className="col-span-2">
                        <label className="shopify-label">Città</label>
                        <input
                          type="text"
                          name="city"
                          value={customer.city}
                          onChange={handleChange}
                          className="shopify-input"
                          placeholder=""
                          required
                          autoComplete="address-level2"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="shopify-label">Provincia</label>
                      <input
                        type="text"
                        name="province"
                        value={customer.province}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder=""
                        required
                        autoComplete="address-level1"
                      />
                    </div>

                    <div>
                      <label className="shopify-label">Telefono</label>
                      <input
                        type="tel"
                        name="phone"
                        value={customer.phone}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder=""
                        required
                        autoComplete="tel"
                      />
                    </div>

                    {/* ✅ SPIEGAZIONE DATI */}
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-md">
                      <p className="text-xs text-gray-600 flex items-start gap-2">
                        <svg className="w-3.5 h-3.5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        <span className="leading-relaxed">
                          <strong className="font-medium text-gray-900">Perché questi dati?</strong> Servono per garantire la consegna del tuo ordine. Non condividiamo i tuoi dati.
                        </span>
                      </p>
                    </div>

                    <div className="flex items-start gap-2">
                      <input 
                        type="checkbox" 
                        id="saveInfo" 
                        className="w-4 h-4 mt-0.5 flex-shrink-0" 
                      />
                      <label htmlFor="saveInfo" className="text-xs text-gray-600 leading-relaxed">
                        Salva questi dati per la prossima volta
                      </label>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-4 bg-gray-50 rounded-md border border-gray-200">
                  <input 
                    type="checkbox" 
                    id="differentBilling" 
                    checked={useDifferentBilling}
                    onChange={(e) => setUseDifferentBilling(e.target.checked)}
                    className="w-4 h-4 mt-0.5 flex-shrink-0" 
                  />
                  <label htmlFor="differentBilling" className="text-sm text-gray-700 leading-relaxed cursor-pointer">
                    Usa un indirizzo di fatturazione diverso
                  </label>
                </div>

                {useDifferentBilling && (
                  <div className="shopify-section">
                    <h2 className="shopify-section-title">Fatturazione</h2>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="shopify-label">Paese / Regione</label>
                        <select
                          value={billingAddress.countryCode}
                          onChange={(e) => setBillingAddress(prev => ({ ...prev, countryCode: e.target.value }))}
                          className="shopify-input"
                          required
                        >
                          <option value="IT">Italia</option>
                          <option value="FR">Francia</option>
                          <option value="DE">Germania</option>
                          <option value="ES">Spagna</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="shopify-label">Nome</label>
                          <input
                            type="text"
                            value={billingFirstName}
                            onChange={(e) => {
                              setBillingAddress(prev => ({
                                ...prev,
                                fullName: `${e.target.value} ${billingLastName}`.trim()
                              }))
                            }}
                            className="shopify-input"
                            required
                          />
                        </div>

                        <div>
                          <label className="shopify-label">Cognome</label>
                          <input
                            type="text"
                            value={billingLastName}
                            onChange={(e) => {
                              setBillingAddress(prev => ({
                                ...prev,
                                fullName: `${billingFirstName} ${e.target.value}`.trim()
                              }))
                            }}
                            className="shopify-input"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="shopify-label">Indirizzo</label>
                        <input
                          type="text"
                          value={billingAddress.address1}
                          onChange={(e) => setBillingAddress(prev => ({ ...prev, address1: e.target.value }))}
                          className="shopify-input"
                          required
                        />
                      </div>

                      <div>
                        <label className="shopify-label">Interno, scala, ecc. (facoltativo)</label>
                        <input
                          type="text"
                          value={billingAddress.address2}
                          onChange={(e) => setBillingAddress(prev => ({ ...prev, address2: e.target.value }))}
                          className="shopify-input"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="shopify-label">CAP</label>
                          <input
                            type="text"
                            value={billingAddress.postalCode}
                            onChange={(e) => setBillingAddress(prev => ({ ...prev, postalCode: e.target.value }))}
                            className="shopify-input"
                            required
                          />
                        </div>

                        <div className="col-span-2">
                          <label className="shopify-label">Città</label>
                          <input
                            type="text"
                            value={billingAddress.city}
                            onChange={(e) => setBillingAddress(prev => ({ ...prev, city: e.target.value }))}
                            className="shopify-input"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="shopify-label">Provincia</label>
                        <input
                          type="text"
                          value={billingAddress.province}
                          onChange={(e) => setBillingAddress(prev => ({ ...prev, province: e.target.value }))}
                          className="shopify-input"
                          required
                        />
                      </div>
                    </div>
                  </div>
                )}

                {isFormValid() && (
                  <div className="shopify-section">
                    <h2 className="shopify-section-title">Metodo di spedizione</h2>
                    <div className="border border-gray-300 rounded-md p-4 flex justify-between items-center bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Spedizione BRT Express</p>
                        <p className="text-xs text-gray-500 mt-1">24/48h</p>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">€5,90</span>
                    </div>
                  </div>
                )}

                {/* ✅ SOCIAL PROOF prima pagamento */}
                {isFormValid() && (
                  <div className="bg-green-50 border border-green-200 rounded-md p-3 flex items-center gap-2.5">
                    <div className="flex -space-x-1.5">
                      <div className="w-7 h-7 rounded-full bg-gray-300 border-2 border-white"></div>
                      <div className="w-7 h-7 rounded-full bg-gray-400 border-2 border-white"></div>
                      <div className="w-7 h-7 rounded-full bg-gray-500 border-2 border-white"></div>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-gray-900 font-medium leading-tight">
                        ✓ Oltre 2.000+ clienti soddisfatti questo mese
                      </p>
                    </div>
                  </div>
                )}

                <div className="shopify-section">
                  <h2 className="shopify-section-title">Pagamento</h2>
                  <p className="text-xs text-gray-600 mb-4">
                    Tutte le transazioni sono sicure e crittografate.
                  </p>

                  {/* ✅ LOGHI PAGAMENTI */}
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-200">
                    <span className="text-xs text-gray-600">Accettiamo:</span>
                    <div className="flex items-center gap-1">
                      <div className="h-5 px-1.5 bg-white border border-gray-200 rounded flex items-center">
                        <span className="text-[9px] font-semibold text-gray-700">VISA</span>
                      </div>
                      <div className="h-5 px-1.5 bg-white border border-gray-200 rounded flex items-center">
                        <span className="text-[9px] font-semibold text-gray-700">MC</span>
                      </div>
                      <div className="h-5 px-1.5 bg-white border border-gray-200 rounded flex items-center">
                        <span className="text-[9px] font-semibold text-gray-700">AMEX</span>
                      </div>
                      <div className="h-5 px-1.5 bg-white border border-gray-200 rounded flex items-center">
                        <span className="text-[9px] font-semibold">
                          <span className="text-[#003087]">Pay</span><span className="text-[#009cde]">Pal</span>
                        </span>
                      </div>
                      <div className="h-5 px-1.5 bg-white border border-gray-200 rounded flex items-center">
                        <span className="text-[9px] font-semibold text-gray-700">GPay</span>
                      </div>
                    </div>
                  </div>
                  
                  {isCalculatingShipping && (
                    <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md mb-4">
                      <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <p className="text-sm text-blue-800">Calcolo in corso...</p>
                    </div>
                  )}

                  {shippingError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-md mb-4">
                      <p className="text-sm text-red-700">{shippingError}</p>
                    </div>
                  )}

                  {clientSecret && !isCalculatingShipping && (
                    <div className="border border-gray-300 rounded-md p-4 bg-white">
                      <PaymentElement 
                        options={{
                          fields: {
                            billingDetails: {
                              name: 'auto',
                              email: 'never',
                              phone: 'never',
                              address: 'never'
                            }
                          }
                        }}
                      />
                    </div>
                  )}

                  {!clientSecret && !isCalculatingShipping && (
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
                      <p className="text-sm text-gray-600">
                        Compila tutti i campi per visualizzare i metodi di pagamento
                      </p>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                  </div>
                )}

                {success && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-md">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm text-green-700">Pagamento completato! Reindirizzamento...</p>
                    </div>
                  </div>
                )}

                {/* ✅ BOTTONE EMOZIONALE */}
                <button
                  type="submit"
                  disabled={loading || !stripe || !elements || !clientSecret || isCalculatingShipping}
                  className="shopify-btn flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Elaborazione...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <span>Completa l&apos;ordine in sicurezza</span>
                    </>
                  )}
                </button>

                <p className="text-xs text-center text-gray-500 flex items-center justify-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  Pagamento protetto SSL e 3D Secure
                </p>
              </form>
            </div>

            {/* SUMMARY COLUMN */}
            <div className="hidden lg:block">
              <div className="sticky top-24">
                <div className="shopify-section">
                  <div className="space-y-4 mb-6">
                    {cart.items.map((item, idx) => (
                      <div key={idx} className="flex gap-3">
                        {item.image && (
                          <div className="relative flex-shrink-0">
                            <img
                              src={item.image}
                              alt={item.title}
                              className="w-16 h-16 object-cover rounded border border-gray-200"
                            />
                            <span className="absolute -top-2 -right-2 bg-gray-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                              {item.quantity}
                            </span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{item.title}</p>
                          {item.variantTitle && (
                            <p className="text-xs text-gray-500 mt-1">{item.variantTitle}</p>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-900 flex-shrink-0">
                          {formatMoney(item.linePriceCents || item.priceCents || 0, currency)}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-gray-200 pt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Subtotale</span>
                      <span className="text-gray-900">{formatMoney(subtotalCents, currency)}</span>
                    </div>

                    {discountCents > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Sconto</span>
                        <span>-{formatMoney(discountCents, currency)}</span>
                      </div>
                    )}

                    <div className="flex justify-between">
                      <span className="text-gray-600">Spedizione</span>
                      <span className="text-gray-900">{shippingCents > 0 ? formatMoney(shippingCents, currency) : "€5,90"}</span>
                    </div>

                    <div className="flex justify-between text-lg font-semibold pt-4 border-t border-gray-200">
                      <span>Totale</span>
                      <span className="text-xl">{formatMoney(totalToPayCents, currency)}</span>
                    </div>
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
            console.log('[Checkout] ✅ Publishable key caricata')
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
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
          <p className="text-sm text-gray-600">Caricamento del checkout…</p>
        </div>
      </div>
    )
  }

  if (error || !cart) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-4 p-6 bg-white rounded-lg shadow-sm border border-gray-200">
          <svg className="w-12 h-12 text-red-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h1 className="text-lg font-semibold text-gray-900">Impossibile caricare il checkout</h1>
          <p className="text-sm text-gray-600">{error}</p>
          <p className="text-xs text-gray-500">
            Ritorna al sito e riprova ad aprire il checkout.
          </p>
        </div>
      </div>
    )
  }

  const options = {
    mode: 'payment' as const,
    amount: 1000,
    currency: (cart.currency || 'eur').toLowerCase(),
    paymentMethodTypes: ['card'],
    appearance: {
      theme: "stripe" as const,
      variables: {
        colorPrimary: "#2C6ECB",
        colorBackground: "#ffffff",
        colorText: "#333333",
        colorDanger: "#df1b41",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        spacingUnit: '4px',
        borderRadius: "5px",
        fontSizeBase: '16px',
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
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
            <p className="text-sm text-gray-600">Caricamento…</p>
          </div>
        </div>
      }
    >
      <CheckoutPageContent />
    </Suspense>
  )
}


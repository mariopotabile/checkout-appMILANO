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
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

// Mappa prefissi telefonici per paese
const phonePrefixMap: Record<string, string> = {
  GB: '+44',
  IE: '+353',
  IT: '+39',
  FR: '+33',
  DE: '+49',
  ES: '+34',
  AT: '+43',
  BE: '+32',
  NL: '+31',
  CH: '+41',
  PT: '+351'
}

function CheckoutInner({
  cart,
  sessionId,
  onClientSecretReady,
}: {
  cart: CartSessionResponse
  sessionId: string
  onClientSecretReady?: (secret: string) => void
})
{
  const stripe = useStripe()
  const elements = useElements()

  // 🔗 Link al carrello di milanodistrict.com
  const cartUrl = 'https://milanodistrict.com/cart'

  const [customer, setCustomer] = useState<CustomerForm>({
    fullName: "",
    email: "",
    phone: "",
    address1: "",
    address2: "",
    city: "",
    postalCode: "",
    province: "",
    countryCode: "GB",
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
    countryCode: "GB",
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [calculatedShippingCents, setCalculatedShippingCents] = useState<number>(0)
  const [isCalculatingShipping, setIsCalculatingShipping] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [shippingError, setShippingError] = useState<string | null>(null)
  const [orderSummaryExpanded, setOrderSummaryExpanded] = useState(false)

  const [lastCalculatedHash, setLastCalculatedHash] = useState<string>("")
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

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

  const SHIPPING_COST_CENTS = 0
  const FREE_SHIPPING_THRESHOLD_CENTS = 0
  const shippingToApply = 0
  const totalToPayCents = subtotalCents - discountCents + shippingToApply

  const firstName = customer.fullName.split(" ")[0] || ""
  const lastName = customer.fullName.split(" ").slice(1).join(" ") || ""

  const billingFirstName = billingAddress.fullName.split(" ")[0] || ""
  const billingLastName = billingAddress.fullName.split(" ").slice(1).join(" ") || ""

  // 🌍 Geolocalizzazione automatica paese e prefisso
  useEffect(() => {
    async function detectCountry() {
      try {
        const res = await fetch('https://ipapi.co/json/')
        const data = await res.json()
        
        if (data.country_code) {
          const countryCode = data.country_code.toUpperCase()
          const phonePrefix = phonePrefixMap[countryCode] || data.country_calling_code || ''
          
          console.log('[Geolocation] 🌍 Detected:', countryCode, phonePrefix)
          
          // Imposta paese e prefisso automaticamente
          setCustomer(prev => ({
            ...prev,
            countryCode: countryCode,
            phone: phonePrefix // Pre-compila il prefisso
          }))
          
          setBillingAddress(prev => ({
            ...prev,
            countryCode: countryCode
          }))
        }
      } catch (err) {
        console.error('[Geolocation] ❌ Error:', err)
        // Fallback: UK se non rileva
      }
    }
    
    detectCountry()
  }, [])

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
              country: ["gb", "ie", "it", "fr", "de", "es", "at", "be", "nl", "ch", "pt"],
            },
            fields: ["address_components", "formatted_address", "geometry"],
          }
        )

        autocompleteRef.current.addListener("place_changed", () => {
          if (!mounted) return
          handlePlaceSelect()
        })
      } catch (err) {
        console.error("[Autocomplete] Error:", err)
      }
    }

    if (!win.google?.maps?.places && !scriptLoadedRef.current) {
      scriptLoadedRef.current = true
      const script = document.createElement("script")
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

      if (!apiKey) {
        console.error("[Autocomplete] API Key missing")
        return
      }

      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=en&callback=initGoogleMaps`
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
        console.error("[Autocomplete] Loading error")
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

  // Funzione per gestire il cambio paese con aggiornamento prefisso automatico
  function handleCountryChange(e: ChangeEvent<HTMLSelectElement>) {
    const countryCode = e.target.value
    const prefix = phonePrefixMap[countryCode] || ''
    
    setCustomer(prev => ({
      ...prev,
      countryCode,
      phone: prefix // Aggiorna prefisso automaticamente
    }))
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
      const formHash = JSON.stringify({
        fullName: customer.fullName.trim(),
        email: customer.email.trim(),
        phone: customer.phone.trim(),
        address1: customer.address1.trim(),
        city: customer.city.trim(),
        postalCode: customer.postalCode.trim(),
        province: customer.province.trim(),
        countryCode: customer.countryCode,
        billingFullName: useDifferentBilling ? billingAddress.fullName.trim() : "",
        billingAddress1: useDifferentBilling ? billingAddress.address1.trim() : "",
        subtotal: subtotalCents,
        discount: discountCents,
      })

      if (!isFormValid()) {
        setCalculatedShippingCents(0)
        setClientSecret(null)
        setShippingError(null)
        setLastCalculatedHash("")
        return
      }

      if (formHash === lastCalculatedHash && clientSecret) {
        console.log('[Checkout] 💾 Form unchanged, reusing Payment Intent')
        return
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(async () => {
        setIsCalculatingShipping(true)
        setError(null)
        setShippingError(null)

        try {
          const flatShippingCents = 0
          setCalculatedShippingCents(flatShippingCents)

          const shopifyTotal = typeof cart.totalCents === "number" ? cart.totalCents : subtotalCents
          const currentDiscountCents = subtotalCents - shopifyTotal
          const finalDiscountCents = currentDiscountCents > 0 ? currentDiscountCents : 0
          const newTotalCents = subtotalCents - finalDiscountCents + flatShippingCents

          console.log('[Checkout] 🆕 Creating Payment Intent...')

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
                countryCode: customer.countryCode || "GB",
              },
            }),
          })

          const piData = await piRes.json()

          if (!piRes.ok || !piData.clientSecret) {
            throw new Error(piData.error || "Payment creation error")
          }

          console.log('[Checkout] ✅ ClientSecret received')
          setClientSecret(piData.clientSecret)
onClientSecretReady?.(piData.clientSecret) // ✅ AGGIUNGI QUESTA RIGA
          setLastCalculatedHash(formHash)
          setIsCalculatingShipping(false)
        } catch (err: any) {
          console.error("Payment creation error:", err)
          setShippingError(err.message || "Error calculating total")
          setIsCalculatingShipping(false)
        }
      }, 1000)
    }

    calculateShipping()

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
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
    clientSecret,
    lastCalculatedHash,
    discountCents,
  ])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!isFormValid()) {
      setError("Please fill in all required fields")
      return
    }

    if (!stripe || !elements) {
      setError("Stripe not ready")
      return
    }

    if (!clientSecret) {
      setError("Payment Intent not created")
      return
    }

    try {
      setLoading(true)

      const { error: submitError } = await elements.submit()
      if (submitError) {
        console.error("Elements submit error:", submitError)
        setError(submitError.message || "Validation error")
        setLoading(false)
        return
      }

      const finalBillingAddress = useDifferentBilling ? billingAddress : customer

      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        clientSecret,

        confirmParams: {
          return_url: `${window.location.origin}/thank-you?sessionId=${sessionId}`,

          payment_method_data: {
            billing_details: {
              name: finalBillingAddress.fullName || customer.fullName,
              email: customer.email,
              phone: finalBillingAddress.phone || customer.phone,

              address: {
                line1: finalBillingAddress.address1,
                line2: finalBillingAddress.address2 || undefined,
                city: finalBillingAddress.city,
                postal_code: finalBillingAddress.postalCode,
                state: finalBillingAddress.province,
                country: finalBillingAddress.countryCode || "GB",
              },
            },

            metadata: {
              session_id: sessionId,
              customer_fullName: customer.fullName,
              customer_email: customer.email,
              shipping_city: customer.city,
              shipping_postal: customer.postalCode,
              shipping_country: customer.countryCode,
              checkout_type: "custom",
            },
          },
        },

        redirect: "if_required",
      })

      if (stripeError) {
        console.error("Stripe error:", stripeError)
        setError(stripeError.message || "Payment failed")
        setLoading(false)
        return
      }

      setSuccess(true)
      setLoading(false)

      setTimeout(() => {
        window.location.href = `/thank-you?sessionId=${sessionId}`
      }, 2000)
    } catch (err: any) {
      console.error("Payment error:", err)
      setError(err.message || "Unexpected error")
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
          padding: 14px 16px;
          font-size: 16px;
          line-height: 1.5;
          color: #333333;
          background: #ffffff;
          border: 1px solid #d9d9d9;
          border-radius: 10px;
          transition: all 0.2s ease;
          -webkit-appearance: none;
          appearance: none;
        }

        .shopify-input:focus {
          outline: none;
          border-color: #2C6ECB;
          box-shadow: 0 0 0 3px rgba(44, 110, 203, 0.1);
        }

        .shopify-input::placeholder {
          color: #999999;
        }

        .shopify-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: #333333;
          margin-bottom: 8px;
        }

        .shopify-btn {
          width: 100%;
          padding: 18px 24px;
          font-size: 17px;
          font-weight: 600;
          color: #ffffff;
          background: linear-gradient(135deg, #2C6ECB 0%, #1f5bb8 100%);
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px rgba(44, 110, 203, 0.3);
          -webkit-appearance: none;
          appearance: none;
          touch-action: manipulation;
        }

        .shopify-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #1f5bb8 0%, #164a9e 100%);
          box-shadow: 0 6px 16px rgba(44, 110, 203, 0.4);
          transform: translateY(-2px);
        }

        .shopify-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .shopify-btn:disabled {
          background: #d1d5db;
          cursor: not-allowed;
          box-shadow: none;
        }

        .shopify-section {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 24px;
          margin-bottom: 20px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }

        .shopify-section-title {
          font-size: 18px;
          font-weight: 600;
          color: #111827;
          margin-bottom: 20px;
        }

        .summary-toggle {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 20px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          -webkit-tap-highlight-color: transparent;
          transition: all 0.2s ease;
        }

        .summary-toggle:active {
          background: #f9fafb;
          transform: scale(0.98);
        }

        .summary-content {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-top: none;
          border-radius: 0 0 12px 12px;
          padding: 16px;
          margin-top: -20px;
          margin-bottom: 20px;
        }

        .pac-container {
          background-color: #ffffff !important;
          border: 1px solid #d9d9d9 !important;
          border-radius: 10px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
          margin-top: 4px !important;
          padding: 4px !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
          z-index: 9999 !important;
        }

        .pac-item {
          padding: 12px 16px !important;
          cursor: pointer !important;
          border: none !important;
          border-radius: 8px !important;
          font-size: 14px !important;
          color: #333333 !important;
        }

        .pac-item:hover {
          background-color: #f3f4f6 !important;
        }

        .pac-icon {
          display: none !important;
        }

        @media (max-width: 768px) {
          .shopify-input {
            font-size: 16px !important;
          }
          
          .shopify-btn {
            min-height: 52px;
            font-size: 16px;
          }

          .shopify-section {
            padding: 20px;
            border-radius: 12px;
          }
        }
      `}</style>

      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
        {/* HEADER */}
        <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="flex justify-between items-center">
              <a href={cartUrl} className="flex items-center gap-2">
                <img
                  src="https://cdn.shopify.com/s/files/1/1010/0529/5957/files/logo_md.png?v=1767970912"
                  alt="Milano District Logo"
                  className="h-10"
                  style={{ maxWidth: '160px' }}
                />
              </a>

              {/* Desktop Trust */}
              <div className="hidden md:flex items-center gap-6">
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  <span className="font-medium">Secure SSL</span>
                </div>

                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-200">
                  <svg className="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-xs font-semibold text-emerald-700">Protected Payment</span>
                </div>
              </div>

              {/* Mobile Trust */}
              <div className="md:hidden flex items-center gap-2 px-2.5 py-1 bg-emerald-50 rounded-full border border-emerald-200">
                <svg className="w-3.5 h-3.5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                <span className="text-xs font-semibold text-emerald-700">Secure</span>
              </div>
            </div>
          </div>
        </header>

        {/* Mobile Summary Toggle */}
        <div className="max-w-2xl mx-auto px-4 lg:hidden mt-4">
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
                {orderSummaryExpanded ? 'Hide' : 'Show'} order summary
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
                          className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                        />
                        <span className="absolute -top-2 -right-2 bg-gray-700 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium shadow-sm">
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
                  <span className="text-gray-600">Subtotal</span>
                  <span className="text-gray-900">{formatMoney(subtotalCents, currency)}</span>
                </div>

                {discountCents > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-{formatMoney(discountCents, currency)}</span>
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Shipping</span>
                  <span className="text-green-600 font-medium">FREE</span>
                </div>

                <div className="flex justify-between text-base font-semibold pt-3 border-t border-gray-200">
                  <span>Total</span>
                  <span className="text-lg">{formatMoney(totalToPayCents, currency)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="max-w-6xl mx-auto px-4 pb-8 mt-6">
          <div className="lg:grid lg:grid-cols-2 lg:gap-12">
            
            <div>
              <form onSubmit={handleSubmit} className="space-y-5">

                <div className="shopify-section">
                  <h2 className="shopify-section-title">Contact</h2>
                  
                  <div>
                    <label className="shopify-label">Email</label>
                    <input
                      type="email"
                      name="email"
                      value={customer.email}
                      onChange={handleChange}
                      className="shopify-input"
                      placeholder="john.smith@example.com"
                      required
                      autoComplete="email"
                    />
                  </div>

                  <div className="flex items-start gap-2 mt-4">
                    <input 
                      type="checkbox" 
                      id="emailUpdates" 
                      className="w-4 h-4 mt-0.5 flex-shrink-0 rounded" 
                    />
                    <label htmlFor="emailUpdates" className="text-xs text-gray-600 leading-relaxed">
                      Email me with news and offers
                    </label>
                  </div>
                </div>

                <div className="shopify-section">
                  <h2 className="shopify-section-title">Delivery</h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="shopify-label">Country / Region</label>
                      <select
                        name="countryCode"
                        value={customer.countryCode}
                        onChange={handleCountryChange}
                        className="shopify-input"
                        required
                      >
                        <option value="GB">United Kingdom</option>
                        <option value="IE">Ireland</option>
                        <option value="IT">Italy</option>
                        <option value="FR">France</option>
                        <option value="DE">Germany</option>
                        <option value="ES">Spain</option>
                        <option value="AT">Austria</option>
                        <option value="BE">Belgium</option>
                        <option value="NL">Netherlands</option>
                        <option value="CH">Switzerland</option>
                        <option value="PT">Portugal</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="shopify-label">First name</label>
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
                          placeholder="John"
                          required
                          autoComplete="given-name"
                        />
                      </div>

                      <div>
                        <label className="shopify-label">Last name</label>
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
                          placeholder="Smith"
                          required
                          autoComplete="family-name"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="shopify-label">Company (optional)</label>
                      <input
                        type="text"
                        className="shopify-input"
                        placeholder="Company name"
                        autoComplete="organization"
                      />
                    </div>

                    <div>
                      <label className="shopify-label">Address</label>
                      <input
                        ref={addressInputRef}
                        type="text"
                        name="address1"
                        value={customer.address1}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder="123 High Street"
                        required
                        autoComplete="address-line1"
                      />
                    </div>

                    <div>
                      <label className="shopify-label">Apartment, suite, etc. (optional)</label>
                      <input
                        type="text"
                        name="address2"
                        value={customer.address2}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder="Flat 4B"
                        autoComplete="address-line2"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="shopify-label">Postcode</label>
                        <input
                          type="text"
                          name="postalCode"
                          value={customer.postalCode}
                          onChange={handleChange}
                          className="shopify-input"
                          placeholder="SW1A 1AA"
                          required
                          autoComplete="postal-code"
                        />
                      </div>

                      <div className="col-span-2">
                        <label className="shopify-label">City</label>
                        <input
                          type="text"
                          name="city"
                          value={customer.city}
                          onChange={handleChange}
                          className="shopify-input"
                          placeholder="London"
                          required
                          autoComplete="address-level2"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="shopify-label">County / State</label>
                      <input
                        type="text"
                        name="province"
                        value={customer.province}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder="Greater London"
                        required
                        autoComplete="address-level1"
                      />
                    </div>

                    <div>
                      <label className="shopify-label">Phone</label>
                      <input
                        type="tel"
                        name="phone"
                        value={customer.phone}
                        onChange={handleChange}
                        className="shopify-input"
                        placeholder="+44 20 1234 5678"
                        required
                        autoComplete="tel"
                      />
                    </div>

                    <div className="flex items-start gap-2">
                      <input 
                        type="checkbox" 
                        id="saveInfo" 
                        className="w-4 h-4 mt-0.5 flex-shrink-0 rounded" 
                      />
                      <label htmlFor="saveInfo" className="text-xs text-gray-600 leading-relaxed">
                        Save this information for next time
                      </label>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-4 bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl border border-gray-200">
                  <input 
                    type="checkbox" 
                    id="differentBilling" 
                    checked={useDifferentBilling}
                    onChange={(e) => setUseDifferentBilling(e.target.checked)}
                    className="w-4 h-4 mt-0.5 flex-shrink-0 rounded" 
                  />
                  <label htmlFor="differentBilling" className="text-sm text-gray-700 leading-relaxed cursor-pointer font-medium">
                    Use a different billing address
                  </label>
                </div>

                {useDifferentBilling && (
                  <div className="shopify-section">
                    <h2 className="shopify-section-title">Billing address</h2>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="shopify-label">Country / Region</label>
                        <select
                          value={billingAddress.countryCode}
                          onChange={(e) => setBillingAddress(prev => ({ ...prev, countryCode: e.target.value }))}
                          className="shopify-input"
                          required
                        >
                          <option value="GB">United Kingdom</option>
                          <option value="IE">Ireland</option>
                          <option value="IT">Italy</option>
                          <option value="FR">France</option>
                          <option value="DE">Germany</option>
                          <option value="ES">Spain</option>
                          <option value="AT">Austria</option>
                          <option value="BE">Belgium</option>
                          <option value="NL">Netherlands</option>
                          <option value="CH">Switzerland</option>
                          <option value="PT">Portugal</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="shopify-label">First name</label>
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
                          <label className="shopify-label">Last name</label>
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
                        <label className="shopify-label">Address</label>
                        <input
                          type="text"
                          value={billingAddress.address1}
                          onChange={(e) => setBillingAddress(prev => ({ ...prev, address1: e.target.value }))}
                          className="shopify-input"
                          required
                        />
                      </div>

                      <div>
                        <label className="shopify-label">Apartment, suite, etc. (optional)</label>
                        <input
                          type="text"
                          value={billingAddress.address2}
                          onChange={(e) => setBillingAddress(prev => ({ ...prev, address2: e.target.value }))}
                          className="shopify-input"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="shopify-label">Postcode</label>
                          <input
                            type="text"
                            value={billingAddress.postalCode}
                            onChange={(e) => setBillingAddress(prev => ({ ...prev, postalCode: e.target.value }))}
                            className="shopify-input"
                            required
                          />
                        </div>

                        <div className="col-span-2">
                          <label className="shopify-label">City</label>
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
                        <label className="shopify-label">County / State</label>
                        <input
                          type="text"
                          value={billingAddress.province}
                          onChange={(e) => setBillingAddress(prev => ({ ...prev, province: e.target.value }))}
                          className="shopify-input"
                          required
                        />
                      </div>

                      <div>
                        <label className="shopify-label">Phone (optional)</label>
                        <input
                          type="tel"
                          value={billingAddress.phone}
                          onChange={(e) => setBillingAddress(prev => ({ ...prev, phone: e.target.value }))}
                          className="shopify-input"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="shopify-section">
                  <h2 className="shopify-section-title">Payment</h2>
                  
                  <div className="text-sm text-gray-600 mb-4">
                    All transactions are secure and encrypted.
                  </div>

                  {isCalculatingShipping && (
                    <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                      Calculating total...
                    </div>
                  )}

                  {shippingError && (
                    <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      {shippingError}
                    </div>
                  )}

                  {clientSecret && (
                    <div className="p-4 bg-white border border-gray-200 rounded-xl">
                      <PaymentElement />
                    </div>
                  )}
                </div>

                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                    Payment successful! Redirecting...
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !stripe || !elements || !clientSecret || !isFormValid()}
                  className="shopify-btn"
                >
                  {loading ? "Processing..." : `Pay ${formatMoney(totalToPayCents, currency)}`}
                </button>

                <div className="text-center text-xs text-gray-500 mt-4">
                  <div className="flex items-center justify-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                    <span>Secured by Stripe · Your data is encrypted</span>
                  </div>
                </div>

              </form>
            </div>

            {/* Desktop Order Summary */}
            <div className="hidden lg:block">
              <div className="shopify-section sticky top-24">
                <h2 className="shopify-section-title">Order summary</h2>

                <div className="space-y-4 mb-6">
                  {cart.items.map((item, idx) => (
                    <div key={idx} className="flex gap-4">
                      {item.image && (
                        <div className="relative flex-shrink-0">
                          <img
                            src={item.image}
                            alt={item.title}
                            className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                          />
                          <span className="absolute -top-2 -right-2 bg-gray-700 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-medium shadow-sm">
                            {item.quantity}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">{item.title}</p>
                        {item.variantTitle && (
                          <p className="text-sm text-gray-500 mt-1">{item.variantTitle}</p>
                        )}
                      </div>
                      <p className="font-medium text-gray-900 flex-shrink-0">
                        {formatMoney(item.linePriceCents || item.priceCents || 0, currency)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="border-t border-gray-200 pt-4 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="text-gray-900">{formatMoney(subtotalCents, currency)}</span>
                  </div>

                  {discountCents > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>Discount</span>
                      <span>-{formatMoney(discountCents, currency)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-sm items-center">
                    <span className="text-gray-600">Shipping</span>
                    <span className="text-green-600 font-medium">FREE</span>
                  </div>

                  <div className="flex justify-between text-lg font-semibold pt-4 border-t border-gray-200">
                    <span>Total</span>
                    <span className="text-xl">{formatMoney(totalToPayCents, currency)}</span>
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
  const sessionId = searchParams?.get("sessionId") ?? ""

  const [cart, setCart] = useState<CartSessionResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) { setLoadError("No session ID provided"); return }

    async function loadCart() {
      try {
        const res = await fetch(`/api/cart-session?sessionId=${sessionId}`)
        const data: CartSessionResponse = await res.json()
        if (!res.ok || data.error) throw new Error(data.error || "Session load error")
        setCart(data)

        // ✅ Carica la publishableKey dall'account attivo (non dalla env)
        const pkRes = await fetch("/api/stripe-status")
        const pkData = await pkRes.json()
        if (!pkData.publishableKey) throw new Error("PublishableKey non disponibile")
        setStripePromise(loadStripe(pkData.publishableKey))
      } catch (err: any) {
        console.error("Load cart error", err)
        setLoadError(err.message || "Cart not available")
      }
    }
    loadCart()
  }, [sessionId])

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Unable to load checkout</h1>
          <p className="text-gray-600 mb-6">{loadError}</p>
          <a href="https://milanodistrict.com" className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">Return to shop</a>
        </div>
      </div>
    )
  }

  if (!cart || !stripePromise) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600">Loading checkout...</p>
        </div>
      </div>
    )
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        // ✅ NO mode:"payment" — usa clientSecret quando disponibile
        ...(clientSecret ? { clientSecret } : {
          mode: "payment" as const,
          amount: cart.subtotalCents || 100,
          currency: (cart.currency || "gbp").toLowerCase(),
        }),
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#2C6ECB",
            colorBackground: "#ffffff",
            colorText: "#333333",
            colorDanger: "#df1b41",
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            spacingUnit: "4px",
            borderRadius: "10px",
          },
        },
      }}
    >
      <CheckoutInner
        cart={cart}
        sessionId={sessionId}
        onClientSecretReady={setClientSecret}
      />
    </Elements>
  )
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="inline-block w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      }
    >
      <CheckoutPageContent />
    </Suspense>
  )
}

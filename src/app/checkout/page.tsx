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
import Script from "next/script"
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
  paymentIntentId?: string
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

// ══ AUTO-DETECT COUNTRY FROM BROWSER/IP ══════════════════════════════
async function detectCountry(): Promise<string> {
  const lang = navigator.language || ""
  const langMap: Record<string, string> = {
    "it": "IT", "it-IT": "IT", "it-CH": "IT",
    "fr": "FR", "fr-FR": "FR", "fr-BE": "FR", "fr-CH": "FR",
    "de": "DE", "de-DE": "DE", "de-AT": "AT", "de-CH": "DE",
    "es": "ES", "es-ES": "ES",
    "nl": "NL", "nl-NL": "NL", "nl-BE": "NL",
    "pt": "PT", "pt-PT": "PT",
    "en-GB": "GB",
  }
  if (langMap[lang]) return langMap[lang]
  try {
    const res = await fetch("https://ipapi.co/country/", { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      const country = (await res.text()).trim().toUpperCase()
      const allowed = ["IT","FR","DE","ES","AT","BE","NL","CH","PT"]
      if (allowed.includes(country)) return country
    }
  } catch {}
  return "IT"
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

  const cartUrl = "https://milanodistrict.com/cart"

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
  const [isCalculatingShipping, setIsCalculatingShipping] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [shippingError, setShippingError] = useState<string | null>(null)
  const [orderSummaryExpanded, setOrderSummaryExpanded] = useState(false)
  const [fbPixelSent, setFbPixelSent] = useState(false)

  const [lastCalculatedHash, setLastCalculatedHash] = useState<string>("")
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const addressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const scriptLoadedRef = useRef(false)

  const currency = (cart.currency || "EUR").toUpperCase()

  // ✅ SHIPPING ALWAYS FREE
  const SHIPPING_COST_CENTS = 0

  useEffect(() => {
    detectCountry().then((code) => {
      setCustomer((prev) => ({ ...prev, countryCode: code }))
      setBillingAddress((prev) => ({ ...prev, countryCode: code }))
    })
  }, [])

  const subtotalCents = useMemo(() => {
    if (typeof cart.subtotalCents === "number") return cart.subtotalCents
    return cart.items.reduce((sum, item) => {
      const line = item.linePriceCents ?? item.priceCents ?? 0
      return sum + line
    }, 0)
  }, [cart])

  const discountCents = useMemo(() => {
    const shopifyTotal = typeof cart.totalCents === "number" ? cart.totalCents : subtotalCents
    const raw = subtotalCents - shopifyTotal
    return raw > 0 ? raw : 0
  }, [subtotalCents, cart.totalCents])

  // ✅ Total = subtotal - discount + 0 shipping
  const shippingToApply = SHIPPING_COST_CENTS
  const totalToPayCents = subtotalCents - discountCents + shippingToApply

  const firstName = customer.fullName.split(" ")[0] || ""
  const lastName = customer.fullName.split(" ").slice(1).join(" ") || ""
  const billingFirstName = billingAddress.fullName.split(" ")[0] || ""
  const billingLastName = billingAddress.fullName.split(" ").slice(1).join(" ") || ""

  // ══ FACEBOOK PIXEL — INITIATE CHECKOUT ═══════════════════════════
  useEffect(() => {
    if (fbPixelSent) return
    const sendFBPixel = async () => {
      if (typeof window !== "undefined" && (window as any).fbq && cart.items.length > 0) {
        const attrs = cart.rawCart?.attributes || {}
        const contentIds = cart.items.map((item) => String(item.id)).filter(Boolean)
        const eventId = cart.paymentIntentId || sessionId
        ;(window as any).fbq("track", "InitiateCheckout", {
          value: totalToPayCents / 100,
          currency,
          content_ids: contentIds,
          content_type: "product",
          num_items: cart.items.reduce((sum, item) => sum + item.quantity, 0),
          utm_source: attrs._wt_last_source,
          utm_medium: attrs._wt_last_medium,
          utm_campaign: attrs._wt_last_campaign,
          utm_content: attrs._wt_last_content,
          utm_term: attrs._wt_last_term,
        }, { eventID: eventId })
        setFbPixelSent(true)
      }
    }
    if ((window as any).fbq) { sendFBPixel() }
    else {
      const check = setInterval(() => { if ((window as any).fbq) { clearInterval(check); sendFBPixel() } }, 100)
      setTimeout(() => clearInterval(check), 5000)
    }
  }, [fbPixelSent, cart, totalToPayCents, currency, sessionId])

  // ══ GOOGLE AUTOCOMPLETE ═══════════════════════════════════════════
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
            componentRestrictions: { country: ["it","fr","de","es","at","be","nl","ch","pt"] },
            fields: ["address_components","formatted_address","geometry"],
          }
        )
        autocompleteRef.current.addListener("place_changed", () => { if (mounted) handlePlaceSelect() })
      } catch (err) { console.error("[Autocomplete]", err) }
    }

    if (!win.google?.maps?.places && !scriptLoadedRef.current) {
      scriptLoadedRef.current = true
      const script = document.createElement("script")
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      if (!apiKey) return
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=en&callback=initGoogleMaps`
      script.async = true; script.defer = true
      win.initGoogleMaps = () => { if (mounted) requestAnimationFrame(initAutocomplete) }
      document.head.appendChild(script)
    } else if (win.google?.maps?.places) { initAutocomplete() }

    return () => {
      mounted = false
      if (autocompleteRef.current && win.google?.maps?.event) {
        try { win.google.maps.event.clearInstanceListeners(autocompleteRef.current) } catch {}
      }
    }
  }, [])

  function handlePlaceSelect() {
    const place = autocompleteRef.current?.getPlace()
    if (!place?.address_components) return
    let street = "", streetNumber = "", city = "", province = "", postalCode = "", country = ""
    place.address_components.forEach((c: any) => {
      const t = c.types
      if (t.includes("route")) street = c.long_name
      if (t.includes("street_number")) streetNumber = c.long_name
      if (t.includes("locality")) city = c.long_name
      if (t.includes("postal_town") && !city) city = c.long_name
      if (t.includes("administrative_area_level_3") && !city) city = c.long_name
      if (t.includes("administrative_area_level_2")) province = c.short_name
      if (t.includes("administrative_area_level_1") && !province) province = c.short_name
      if (t.includes("postal_code")) postalCode = c.long_name
      if (t.includes("country")) country = c.short_name
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
    const ok =
      customer.fullName.trim().length > 2 &&
      customer.email.trim().includes("@") &&
      customer.email.trim().length > 5 &&
      customer.phone.trim().length > 8 &&
      customer.address1.trim().length > 3 &&
      customer.city.trim().length > 1 &&
      customer.postalCode.trim().length > 2 &&
      customer.province.trim().length > 1 &&
      customer.countryCode.trim().length >= 2
    if (!useDifferentBilling) return ok
    return ok &&
      billingAddress.fullName.trim().length > 2 &&
      billingAddress.address1.trim().length > 3 &&
      billingAddress.city.trim().length > 1 &&
      billingAddress.postalCode.trim().length > 2 &&
      billingAddress.province.trim().length > 1 &&
      billingAddress.countryCode.trim().length >= 2
  }

  // ══ PAYMENT INTENT ════════════════════════════════════════════════
  useEffect(() => {
    async function calculateShipping() {
      const formHash = JSON.stringify({
        fullName: customer.fullName.trim(), email: customer.email.trim(),
        phone: customer.phone.trim(), address1: customer.address1.trim(),
        city: customer.city.trim(), postalCode: customer.postalCode.trim(),
        province: customer.province.trim(), countryCode: customer.countryCode,
        billingFullName: useDifferentBilling ? billingAddress.fullName.trim() : "",
        billingAddress1: useDifferentBilling ? billingAddress.address1.trim() : "",
        subtotal: subtotalCents, discount: discountCents,
      })
      if (!isFormValid()) {
        setClientSecret(null); setShippingError(null); setLastCalculatedHash(""); return
      }
      if (formHash === lastCalculatedHash && clientSecret) return
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(async () => {
        setIsCalculatingShipping(true); setError(null); setShippingError(null)
        try {
          // ✅ shipping = 0, total = subtotal - discount
          const shopifyTotal = typeof cart.totalCents === "number" ? cart.totalCents : subtotalCents
          const currentDiscount = subtotalCents - shopifyTotal
          const finalDiscount = currentDiscount > 0 ? currentDiscount : 0
          const newTotal = subtotalCents - finalDiscount  // ✅ no shipping added
          const piRes = await fetch("/api/payment-intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId, amountCents: newTotal,
              customer: {
                fullName: customer.fullName, email: customer.email, phone: customer.phone,
                address1: customer.address1, address2: customer.address2,
                city: customer.city, postalCode: customer.postalCode,
                province: customer.province, countryCode: customer.countryCode || "IT",
              },
            }),
          })
          const piData = await piRes.json()
          if (!piRes.ok || !piData.clientSecret) throw new Error(piData.error || "Payment creation error")
          setClientSecret(piData.clientSecret); setLastCalculatedHash(formHash); setIsCalculatingShipping(false)
        } catch (err: any) {
          setShippingError(err.message || "Error calculating total"); setIsCalculatingShipping(false)
        }
      }, 1000)
    }
    calculateShipping()
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [
    customer.fullName, customer.email, customer.phone, customer.address1,
    customer.address2, customer.city, customer.postalCode, customer.province,
    customer.countryCode, billingAddress.fullName, billingAddress.address1,
    billingAddress.city, billingAddress.postalCode, billingAddress.province,
    billingAddress.countryCode, useDifferentBilling, sessionId,
    subtotalCents, cart.totalCents, clientSecret, lastCalculatedHash, discountCents,
  ])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null); setSuccess(false)
    if (!isFormValid()) { setError("Please fill in all required fields"); return }
    if (!stripe || !elements) { setError("Payment not ready"); return }
    if (!clientSecret) { setError("Payment Intent not created"); return }
    try {
      setLoading(true)
      const { error: submitError } = await elements.submit()
      if (submitError) { setError(submitError.message || "Validation error"); setLoading(false); return }
      const finalBilling = useDifferentBilling ? billingAddress : customer
      const { error: stripeError } = await stripe.confirmPayment({
        elements, clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/thank-you?sessionId=${sessionId}`,
          payment_method_data: {
            billing_details: {
              name: finalBilling.fullName || customer.fullName,
              email: customer.email,
              phone: finalBilling.phone || customer.phone,
              address: {
                line1: finalBilling.address1,
                line2: finalBilling.address2 || undefined,
                city: finalBilling.city,
                postal_code: finalBilling.postalCode,
                state: finalBilling.province,
                country: finalBilling.countryCode || "IT",
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
      if (stripeError) { setError(stripeError.message || "Payment failed"); setLoading(false); return }
      setSuccess(true); setLoading(false)
      setTimeout(() => { window.location.href = `/thank-you?sessionId=${sessionId}` }, 2000)
    } catch (err: any) {
      setError(err.message || "Unexpected error"); setLoading(false)
    }
  }

  const COUNTRIES = [
    { code: "IT", label: "Italy" },
    { code: "FR", label: "France" },
    { code: "DE", label: "Germany" },
    { code: "ES", label: "Spain" },
    { code: "AT", label: "Austria" },
    { code: "BE", label: "Belgium" },
    { code: "NL", label: "Netherlands" },
    { code: "CH", label: "Switzerland" },
    { code: "PT", label: "Portugal" },
    { code: "GB", label: "United Kingdom" },
  ]

  return (
    <>
      {/* ✅ FACEBOOK PIXEL */}
      <Script id="facebook-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${process.env.NEXT_PUBLIC_FB_PIXEL_ID}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        <img height="1" width="1" style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${process.env.NEXT_PUBLIC_FB_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          background: #fafafa; color: #333; -webkit-font-smoothing: antialiased;
        }
        .md-input {
          width: 100%; padding: 14px 16px; font-size: 16px; line-height: 1.5;
          color: #333; background: #fff; border: 1px solid #d9d9d9;
          border-radius: 10px; transition: all .2s; -webkit-appearance: none; appearance: none;
        }
        .md-input:focus { outline: none; border-color: #0f0f0f; box-shadow: 0 0 0 3px rgba(15,15,15,.08); }
        .md-input::placeholder { color: #999; }
        .md-label { display: block; font-size: 13px; font-weight: 600; color: #333; margin-bottom: 7px; letter-spacing: .02em; }
        .md-btn {
          width: 100%; padding: 18px 24px; font-size: 17px; font-weight: 700;
          color: #fff; background: #0f0f0f; border: none; border-radius: 12px;
          cursor: pointer; transition: all .2s; letter-spacing: .04em;
        }
        .md-btn:hover:not(:disabled) { background: #333; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,.25); }
        .md-btn:disabled { background: #ccc; cursor: not-allowed; }
        .md-section {
          background: #fff; border: 1px solid #e5e7eb; border-radius: 16px;
          padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.05);
        }
        .md-section-title { font-size: 17px; font-weight: 700; color: #0f0f0f; margin-bottom: 20px; letter-spacing: .03em; }
        .pac-container {
          background: #fff !important; border: 1px solid #d9d9d9 !important;
          border-radius: 10px !important; box-shadow: 0 4px 12px rgba(0,0,0,.15) !important;
          font-family: inherit !important; z-index: 9999 !important;
        }
        .pac-item { padding: 12px 16px !important; border: none !important; border-radius: 8px !important; font-size: 14px !important; }
        .pac-item:hover { background: #f5f4f0 !important; }
        .pac-icon { display: none !important; }

        /* ✅ FREE SHIPPING BANNER ANIMATION */
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .free-shipping-badge {
          background: linear-gradient(90deg, #166534, #16a34a, #166534);
          background-size: 200% auto;
          animation: shimmer 3s linear infinite;
        }

        @media (max-width: 768px) { .md-input { font-size: 16px !important; } .md-btn { min-height: 52px; } }
      `}</style>

      <div className="min-h-screen" style={{ background: "#fafafa" }}>

        {/* ✅ FREE SHIPPING TOP BANNER */}
        <div className="free-shipping-badge" style={{
          color: "#fff",
          textAlign: "center",
          padding: "11px 24px",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: ".05em",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>🚀</span>
          FREE EXPRESS DELIVERY ON YOUR ORDER — NO MINIMUM
          <span style={{ fontSize: 18 }}>🚀</span>
        </div>

        {/* ══ HEADER ══════════════════════════════════════════════════ */}
        <header style={{
          position: "sticky", top: 0, zIndex: 50,
          background: "rgba(255,255,255,.97)", backdropFilter: "blur(8px)",
          borderBottom: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,.06)"
        }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <a href="https://milanodistrict.com">
              <img
                src="https://cdn.shopify.com/s/files/1/1010/0529/5957/files/logo_milano.png"
                alt="Milano District"
                style={{ height: 44, width: "auto" }}
                onError={(e: any) => { e.target.src = "https://cdn.shopify.com/s/files/1/1010/0529/5957/files/logo_md.png?v=1767970912" }}
              />
            </a>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555", fontWeight: 600 }}>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="#2a8a4a">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                SSL Secured
              </div>
              <div style={{
                display: "flex", alignItems: "center", gap: 6, fontSize: 12,
                fontWeight: 700, color: "#1a5c2a", background: "#edfaf2",
                border: "1px solid #a7f0c0", borderRadius: 30, padding: "6px 14px"
              }}>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="#2a8a4a">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Secure Payment
              </div>
            </div>
          </div>
        </header>

        {/* ══ TRUST STRIP ═════════════════════════════════════════════ */}
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10,
            background: "#f5f4f0", borderRadius: 16, padding: "16px 20px",
            border: "1px solid #e0ddd7"
          }}>
            {[
              { icon: "🔒", title: "Secure Payment", sub: "100% protected" },
              { icon: "🚀", title: "FREE Delivery", sub: "Express 24 / 48h" },   // ✅ updated
              { icon: "↩", title: "Easy Returns", sub: "Within 30 days" },
              { icon: "💬", title: "Support", sub: "7 days a week" },
            ].map((t, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                background: i === 1 ? "#f0fdf4" : "#fff",       // ✅ green highlight on shipping
                border: i === 1 ? "1px solid #86efac" : "none",
                borderRadius: 12, padding: "12px 14px",
                boxShadow: "0 1px 3px rgba(0,0,0,.06)"
              }}>
                <span style={{ fontSize: 22 }}>{t.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: i === 1 ? "#166534" : "#0f0f0f" }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: i === 1 ? "#16a34a" : "#888" }}>{t.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ══ MOBILE ORDER SUMMARY TOGGLE ═════════════════════════════ */}
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 24px" }} className="lg:hidden">
          <div
            onClick={() => setOrderSummaryExpanded(!orderSummaryExpanded)}
            style={{
              background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
              padding: "14px 18px", marginBottom: 20, cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: "#0f0f0f" }}>
              <span style={{ transform: orderSummaryExpanded ? "rotate(180deg)" : "none", transition: ".2s", display: "inline-block" }}>▾</span>
              {orderSummaryExpanded ? "Hide" : "Show"} order summary
            </div>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{formatMoney(totalToPayCents, currency)}</span>
          </div>
          {orderSummaryExpanded && <OrderSummaryCard cart={cart} subtotalCents={subtotalCents} discountCents={discountCents} shippingToApply={shippingToApply} totalToPayCents={totalToPayCents} currency={currency} />}
        </div>

        {/* ══ MAIN GRID ════════════════════════════════════════════════ */}
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 60px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 40, alignItems: "start" }}>

            {/* LEFT — FORM ════════════════════════════════════════════ */}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Contact */}
              <div className="md-section">
                <h2 className="md-section-title">Contact</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label className="md-label">Email</label>
                    <input type="email" name="email" value={customer.email} onChange={handleChange}
                      className="md-input" placeholder="mario.rossi@example.com" required autoComplete="email" />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" id="emailUpdates" style={{ width: 16, height: 16 }} />
                    <label htmlFor="emailUpdates" style={{ fontSize: 12, color: "#666" }}>Send me news and offers by email</label>
                  </div>
                </div>
              </div>

              {/* Delivery */}
              <div className="md-section">
                <h2 className="md-section-title">Delivery</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label className="md-label">Country / Region</label>
                    <select name="countryCode" value={customer.countryCode} onChange={handleChange}
                      className="md-input" required>
                      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                    <p style={{ fontSize: 11, color: "#888", marginTop: 5 }}>
                      🌍 Auto-detected from your location
                    </p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label className="md-label">First name</label>
                      <input type="text" value={firstName}
                        onChange={(e) => setCustomer(p => ({ ...p, fullName: `${e.target.value} ${lastName}`.trim() }))}
                        className="md-input" placeholder="Mario" required autoComplete="given-name" />
                    </div>
                    <div>
                      <label className="md-label">Last name</label>
                      <input type="text" value={lastName}
                        onChange={(e) => setCustomer(p => ({ ...p, fullName: `${firstName} ${e.target.value}`.trim() }))}
                        className="md-input" placeholder="Rossi" required autoComplete="family-name" />
                    </div>
                  </div>

                  <div>
                    <label className="md-label">Company (optional)</label>
                    <input type="text" className="md-input" placeholder="Company name" autoComplete="organization" />
                  </div>

                  <div>
                    <label className="md-label">Address</label>
                    <input ref={addressInputRef} type="text" name="address1" value={customer.address1}
                      onChange={handleChange} className="md-input" placeholder="Via Roma 123" required autoComplete="address-line1" />
                  </div>

                  <div>
                    <label className="md-label">Apartment, floor, etc. (optional)</label>
                    <input type="text" name="address2" value={customer.address2} onChange={handleChange}
                      className="md-input" placeholder="Floor 3, Apt B" autoComplete="address-line2" />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 100px", gap: 12 }}>
                    <div>
                      <label className="md-label">Postal code</label>
                      <input type="text" name="postalCode" value={customer.postalCode} onChange={handleChange}
                        className="md-input" placeholder="00100" required autoComplete="postal-code" />
                    </div>
                    <div>
                      <label className="md-label">City</label>
                      <input type="text" name="city" value={customer.city} onChange={handleChange}
                        className="md-input" placeholder="Rome" required autoComplete="address-level2" />
                    </div>
                    <div>
                      <label className="md-label">Province</label>
                      <input type="text" name="province" value={customer.province} onChange={handleChange}
                        className="md-input" placeholder="RM" required autoComplete="address-level1" />
                    </div>
                  </div>

                  <div>
                    <label className="md-label">Phone</label>
                    <input type="tel" name="phone" value={customer.phone} onChange={handleChange}
                      className="md-input" placeholder="+39 123 456 7890" required autoComplete="tel" />
                  </div>
                </div>
              </div>

              {/* Different billing */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10, padding: "14px 18px",
                background: "#f5f4f0", borderRadius: 12, border: "1px solid #e0ddd7"
              }}>
                <input type="checkbox" id="diffBilling" checked={useDifferentBilling}
                  onChange={(e) => setUseDifferentBilling(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: "pointer" }} />
                <label htmlFor="diffBilling" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  Use a different billing address
                </label>
              </div>

              {useDifferentBilling && (
                <div className="md-section">
                  <h2 className="md-section-title">Billing address</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label className="md-label">Country</label>
                      <select value={billingAddress.countryCode}
                        onChange={(e) => setBillingAddress(p => ({ ...p, countryCode: e.target.value }))}
                        className="md-input">
                        {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label className="md-label">First name</label>
                        <input type="text" value={billingFirstName}
                          onChange={(e) => setBillingAddress(p => ({ ...p, fullName: `${e.target.value} ${billingLastName}`.trim() }))}
                          className="md-input" placeholder="Mario" />
                      </div>
                      <div>
                        <label className="md-label">Last name</label>
                        <input type="text" value={billingLastName}
                          onChange={(e) => setBillingAddress(p => ({ ...p, fullName: `${billingFirstName} ${e.target.value}`.trim() }))}
                          className="md-input" placeholder="Rossi" />
                      </div>
                    </div>
                    <div>
                      <label className="md-label">Address</label>
                      <input type="text" value={billingAddress.address1}
                        onChange={(e) => setBillingAddress(p => ({ ...p, address1: e.target.value }))}
                        className="md-input" placeholder="Via Roma 123" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 100px", gap: 12 }}>
                      <div>
                        <label className="md-label">Postal code</label>
                        <input type="text" value={billingAddress.postalCode}
                          onChange={(e) => setBillingAddress(p => ({ ...p, postalCode: e.target.value }))}
                          className="md-input" placeholder="00100" />
                      </div>
                      <div>
                        <label className="md-label">City</label>
                        <input type="text" value={billingAddress.city}
                          onChange={(e) => setBillingAddress(p => ({ ...p, city: e.target.value }))}
                          className="md-input" placeholder="Rome" />
                      </div>
                      <div>
                        <label className="md-label">Province</label>
                        <input type="text" value={billingAddress.province}
                          onChange={(e) => setBillingAddress(p => ({ ...p, province: e.target.value }))}
                          className="md-input" placeholder="RM" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ✅ SHIPPING METHOD — FREE */}
              {isFormValid() && (
                <div className="md-section">
                  <h2 className="md-section-title">Shipping method</h2>
                  <div style={{
                    border: "2px solid #16a34a",
                    borderRadius: 12, padding: "16px 18px",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: "#f0fdf4",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {/* green check */}
                      <div style={{
                        width: 22, height: 22, borderRadius: "50%",
                        background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                      }}>
                        <svg width="12" height="12" viewBox="0 0 20 20" fill="#fff">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#166534" }}>🚀 BRT Express — FREE</div>
                        <div style={{ fontSize: 12, color: "#16a34a", marginTop: 3 }}>Delivery in 24–48 hours · Tracked · Included</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 13, color: "#aaa", textDecoration: "line-through", display: "block" }}>€5.90</span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: "#16a34a" }}>FREE</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Payment */}
              <div className="md-section">
                <h2 className="md-section-title">Payment</h2>

                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  {["VISA","MC","AMEX","PayPal"].map(c => (
                    <div key={c} style={{
                      height: 30, padding: "0 10px", background: "#fff", border: "1px solid #ddd",
                      borderRadius: 6, display: "flex", alignItems: "center", fontSize: 11, fontWeight: 700, color: "#333"
                    }}>{c}</div>
                  ))}
                </div>

                <div style={{
                  display: "flex", gap: 12, alignItems: "center", justifyContent: "center",
                  background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10,
                  padding: "10px 16px", marginBottom: 16, fontSize: 11, fontWeight: 600, color: "#166534"
                }}>
                  <span>🔒 SSL 256-bit</span>
                  <span>·</span>
                  <span>✓ 3D Secure</span>
                  <span>·</span>
                  <span>✓ PCI DSS</span>
                </div>

                <p style={{ fontSize: 11, color: "#888", marginBottom: 16, textAlign: "center" }}>
                  Your card details are never stored. Transaction fully protected.
                </p>

                {isCalculatingShipping && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, marginBottom: 14 }}>
                    <svg style={{ animation: "spin 1s linear infinite", width: 18, height: 18 }} fill="none" viewBox="0 0 24 24">
                      <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="#0f0f0f" strokeWidth="4" />
                      <path style={{ opacity: .75 }} fill="#0f0f0f" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Preparing payment...</span>
                  </div>
                )}

                {shippingError && (
                  <div style={{ padding: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, marginBottom: 14 }}>
                    <p style={{ fontSize: 13, color: "#991b1b" }}>{shippingError}</p>
                  </div>
                )}

                {clientSecret && !isCalculatingShipping && (
                  <div style={{ border: "1px solid #e0ddd7", borderRadius: 12, padding: 16, background: "#fff", marginBottom: 14 }}>
                    <PaymentElement options={{
                      fields: { billingDetails: { name: "auto", email: "never", phone: "never", address: "never" } },
                      defaultValues: { billingDetails: { name: useDifferentBilling ? billingAddress.fullName : customer.fullName } }
                    }} />
                  </div>
                )}

                {!clientSecret && !isCalculatingShipping && (
                  <div style={{ padding: 16, background: "#f5f4f0", border: "1px solid #e0ddd7", borderRadius: 12, textAlign: "center" }}>
                    <p style={{ fontSize: 13, color: "#666" }}>Fill in all fields to show payment methods</p>
                  </div>
                )}
              </div>

              {error && (
                <div style={{ padding: 16, background: "#fef2f2", border: "2px solid #fca5a5", borderRadius: 12 }}>
                  <p style={{ fontSize: 13, color: "#b91c1c", fontWeight: 600 }}>⚠ {error}</p>
                </div>
              )}

              {success && (
                <div style={{ padding: 16, background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 12 }}>
                  <p style={{ fontSize: 13, color: "#166534", fontWeight: 600 }}>✓ Payment successful! Redirecting...</p>
                </div>
              )}

              <button type="submit" className="md-btn"
                disabled={loading || !stripe || !elements || !clientSecret || isCalculatingShipping}>
                {loading ? (
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <svg style={{ animation: "spin 1s linear infinite", width: 20, height: 20 }} fill="none" viewBox="0 0 24 24">
                      <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="#fff" strokeWidth="4" />
                      <path style={{ opacity: .75 }} fill="#fff" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </span>
                ) : "🔒 Pay Securely"}
              </button>

              {/* Trust footer */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                {[
                  { icon: "✓", color: "#f0fdf4", border: "#86efac", text: "30-day money-back guarantee — no questions asked" },
                  { icon: "🚀", color: "#f0fdf4", border: "#86efac", text: "FREE BRT Express tracked delivery in 24–48 hours" }, // ✅ updated
                  { icon: "💬", color: "#faf5ff", border: "#d8b4fe", text: "Customer support available 7 days a week" },
                ].map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: t.color, border: `1px solid ${t.border}`, borderRadius: 12 }}>
                    <span style={{ fontSize: 18 }}>{t.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "#333" }}>{t.text}</span>
                  </div>
                ))}
              </div>

              <p style={{ textAlign: "center", fontSize: 11, color: "#aaa", marginTop: 8 }}>
                🔒 256-bit SSL encryption · Powered by Stripe · PCI DSS Level 1
              </p>

              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </form>

            {/* RIGHT — ORDER SUMMARY (desktop) ════════════════════════ */}
            <div style={{ display: "none" }} className="lg-show">
              <div style={{ position: "sticky", top: 100 }}>
                <OrderSummaryCard
                  cart={cart}
                  subtotalCents={subtotalCents}
                  discountCents={discountCents}
                  shippingToApply={shippingToApply}
                  totalToPayCents={totalToPayCents}
                  currency={currency}
                />
              </div>
            </div>

          </div>
        </div>

        {/* ══ FOOTER ══════════════════════════════════════════════════ */}
        <footer style={{ borderTop: "1px solid #e5e7eb", padding: "20px 24px", textAlign: "center", fontSize: 11, color: "#aaa" }}>
          © 2026 <a href="https://milanodistrict.com" style={{ color: "#888" }}>Milano District</a>
          &nbsp;·&nbsp; <a href="https://milanodistrict.com/policies/privacy-policy" style={{ color: "#888" }}>Privacy</a>
          &nbsp;·&nbsp; <a href="https://milanodistrict.com/policies/refund-policy" style={{ color: "#888" }}>Refunds</a>
          &nbsp;·&nbsp; <a href="https://milanodistrict.com/policies/shipping-policy" style={{ color: "#888" }}>Shipping</a>
        </footer>
      </div>

      <style>{`
        @media (min-width: 1024px) { .lg-show { display: block !important; } }
        @media (max-width: 1023px) { .lg\\:hidden { display: none !important; } }
      `}</style>
    </>
  )
}

// ══ ORDER SUMMARY COMPONENT ══════════════════════════════════════════
function OrderSummaryCard({ cart, subtotalCents, discountCents, shippingToApply, totalToPayCents, currency }: {
  cart: CartSessionResponse, subtotalCents: number, discountCents: number,
  shippingToApply: number, totalToPayCents: number, currency: string
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
      <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20, color: "#0f0f0f" }}>Order Summary</h3>

      {/* ✅ FREE SHIPPING BADGE in summary */}
      <div style={{
        marginBottom: 16, padding: "12px 16px",
        background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 12,
        display: "flex", alignItems: "center", gap: 10
      }}>
        <span style={{ fontSize: 20 }}>🚀</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>Free Express Delivery</div>
          <div style={{ fontSize: 11, color: "#16a34a" }}>BRT 24–48h · Tracked · Included</div>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, color: "#16a34a" }}>FREE</span>
      </div>

      {discountCents > 0 && (
        <div style={{ marginBottom: 20, padding: 16, background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 8 }}>🎉 You're saving!</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, color: "#166534" }}>
            <span>Total discount</span>
            <span>-{formatMoney(discountCents, currency)}</span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
        {cart.items.map((item, idx) => {
          const original = (item.priceCents || 0) * item.quantity
          const current = item.linePriceCents || 0
          const isDisc = original > current && current > 0
          const isFree = current === 0 && (item.priceCents || 0) > 0
          return (
            <div key={idx} style={{ display: "flex", gap: 14, position: "relative" }}>
              {item.image && (
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <img src={item.image} alt={item.title} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, border: "1px solid #e5e7eb" }} />
                  <span style={{
                    position: "absolute", top: -8, right: -8, background: "#0f0f0f", color: "#fff",
                    width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: 11, fontWeight: 700
                  }}>{item.quantity}</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#0f0f0f" }}>{item.title}</p>
                {item.variantTitle && <p style={{ fontSize: 11, color: "#888", marginTop: 3 }}>{item.variantTitle}</p>}
                {isDisc && <p style={{ fontSize: 11, color: "#d93025", marginTop: 4 }}>-{formatMoney(original - current, currency)}</p>}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {isFree ? (
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#166534" }}>FREE</span>
                ) : isDisc ? (
                  <>
                    <p style={{ fontSize: 11, color: "#aaa", textDecoration: "line-through" }}>{formatMoney(original, currency)}</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "#166534" }}>{formatMoney(current, currency)}</p>
                  </>
                ) : (
                  <p style={{ fontSize: 14, fontWeight: 600 }}>{formatMoney(current, currency)}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#666" }}>Subtotal</span>
          <span style={{ fontWeight: 600 }}>{formatMoney(subtotalCents, currency)}</span>
        </div>
        {discountCents > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#166534", fontWeight: 600 }}>✨ Discount</span>
            <span style={{ color: "#166534", fontWeight: 700 }}>-{formatMoney(discountCents, currency)}</span>
          </div>
        )}
        {/* ✅ Shipping row — FREE with strikethrough */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#666" }}>🚀 Shipping (BRT Express)</span>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 11, color: "#bbb", textDecoration: "line-through", display: "block" }}>€5.90</span>
            <span style={{ fontWeight: 800, color: "#16a34a", fontSize: 14 }}>FREE</span>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e5e7eb", paddingTop: 14, fontSize: 17, fontWeight: 800 }}>
          <span>Total</span>
          <span>{formatMoney(totalToPayCents, currency)}</span>
        </div>
      </div>

      {/* Social proof */}
      <div style={{
        marginTop: 20, padding: "14px 16px", background: "#f5f4f0",
        border: "1px solid #e0ddd7", borderRadius: 12
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ color: "#f5a623", fontSize: 14 }}>★★★★★</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>4.9/5</span>
          <span style={{ fontSize: 11, color: "#888" }}>(2,847 reviews)</span>
        </div>
        <p style={{ fontSize: 11, color: "#666" }}>✓ Last purchase: <strong>3 minutes ago</strong></p>
      </div>
    </div>
  )
}

// ══ PAGE WRAPPER ═════════════════════════════════════════════════════
function CheckoutPageContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId") || ""
  const [cart, setCart] = useState<CartSessionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)

  useEffect(() => {
    async function load() {
      if (!sessionId) { setError("Invalid session: missing sessionId."); setLoading(false); return }
      try {
        setLoading(true); setError(null)
        const res = await fetch(`/api/cart-session?sessionId=${encodeURIComponent(sessionId)}`)
        const data: CartSessionResponse & { error?: string } = await res.json()
        if (!res.ok || (data as any).error) { setError(data.error || "Error loading cart. Please retry."); setLoading(false); return }
        setCart(data)
        try {
          const pkRes = await fetch("/api/stripe-status")
          if (!pkRes.ok) throw new Error("stripe-status unavailable")
          const pkData = await pkRes.json()
          if (pkData.publishableKey) { setStripePromise(loadStripe(pkData.publishableKey)) }
          else throw new Error("PublishableKey missing")
        } catch (err) { setError("Cannot initialize payment system. Please retry."); setLoading(false); return }
        setLoading(false)
      } catch (err: any) { setError(err?.message || "Unexpected error."); setLoading(false) }
    }
    load()
  }, [sessionId])

  if (loading || !stripePromise) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, background: "#fafafa" }}>
        <div style={{ width: 48, height: 48, border: "4px solid #e0ddd7", borderTopColor: "#0f0f0f", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <p style={{ fontSize: 14, color: "#666", fontWeight: 500 }}>Loading checkout...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (error || !cart) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#fafafa" }}>
        <div style={{ maxWidth: 420, textAlign: "center", background: "#fff", borderRadius: 20, padding: 40, boxShadow: "0 4px 20px rgba(0,0,0,.08)", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Cannot load checkout</h1>
          <p style={{ fontSize: 14, color: "#666", marginBottom: 24 }}>{error}</p>
          <a href="https://milanodistrict.com/cart" style={{
            display: "inline-block", padding: "14px 28px", background: "#0f0f0f",
            color: "#fff", borderRadius: 10, fontWeight: 700, fontSize: 14
          }}>← Back to cart</a>
        </div>
      </div>
    )
  }

  const options = {
    mode: "payment" as const,
    amount: 1000,
    currency: (cart.currency || "eur").toLowerCase(),
    paymentMethodTypes: ["card"],
    setupFutureUsage: "off_session" as const,
    appearance: {
      theme: "stripe" as const,
      variables: {
        colorPrimary: "#0f0f0f",
        colorBackground: "#ffffff",
        colorText: "#333333",
        colorDanger: "#d93025",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        spacingUnit: "4px",
        borderRadius: "10px",
        fontSizeBase: "16px",
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
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa" }}>
        <div style={{ width: 48, height: 48, border: "4px solid #e0ddd7", borderTopColor: "#0f0f0f", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <CheckoutPageContent />
    </Suspense>
  )
}

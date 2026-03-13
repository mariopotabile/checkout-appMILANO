// src/app/thank-you/page.tsx
"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Script from "next/script"
import { loadStripe } from "@stripe/stripe-js"

type OrderData = {
  shopifyOrderNumber?: string
  shopifyOrderId?: string
  email?: string
  subtotalCents?: number
  shippingCents?: number
  discountCents?: number
  totalCents?: number
  currency?: string
  shopDomain?: string
  paymentIntentId?: string
  rawCart?: {
    id?: string
    token?: string
    attributes?: Record<string, any>
  }
  items?: Array<{
    id?: string
    variant_id?: string
    title: string
    quantity: number
    image?: string
    variantTitle?: string
    priceCents?: number
    linePriceCents?: number
  }>
  customer?: {
    email?: string
    phone?: string
    fullName?: string
    city?: string
    postalCode?: string
    countryCode?: string
  }
}

// ─── STATUS TYPES ─────────────────────────────────────────────────────────────
type PageStatus = "loading" | "success" | "failed" | "canceled" | "error"

function ThankYouContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId")

  // Klarna (e altri redirect) passano questi params nella return_url
  const paymentIntentClientSecret = searchParams.get("payment_intent_client_secret")
  const redirectStatus = searchParams.get("redirect_status") // "succeeded" | "failed" | "canceled"

  const [orderData, setOrderData] = useState<OrderData | null>(null)
  const [pageStatus, setPageStatus] = useState<PageStatus>("loading")
  const [cartCleared, setCartCleared] = useState(false)

  const shopUrl = "https://myriphoneshop.com"

  const formatMoney = (cents: number | undefined) => {
    const value = (cents ?? 0) / 100
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: orderData?.currency || "EUR",
      minimumFractionDigits: 2,
    }).format(value)
  }

  useEffect(() => {
    async function init() {
      if (!sessionId) {
        setPageStatus("error")
        return
      }

      // ─── STEP 1: Verifica redirect_status da Klarna / altri redirect ─────────
      // Stripe aggiunge ?redirect_status=succeeded|failed|canceled nella return_url
      if (redirectStatus && redirectStatus !== "succeeded") {
        // Pagamento annullato o fallito — NON mostrare conferma
        setPageStatus(redirectStatus === "canceled" ? "canceled" : "failed")
        setPageStatus("loading") // mostra loading mentre verifichiamo via API
      }

      // ─── STEP 2: Se c'è payment_intent_client_secret, verifica via Stripe ───
      // Questo è il metodo più sicuro per Klarna redirect
      if (paymentIntentClientSecret) {
        try {
          const pkRes = await fetch("/api/stripe-status")
          if (pkRes.ok) {
            const pkData = await pkRes.json()
            if (pkData.publishableKey) {
              const stripe = await loadStripe(pkData.publishableKey)
              if (stripe) {
                const { paymentIntent } = await stripe.retrievePaymentIntent(paymentIntentClientSecret)
                if (paymentIntent?.status !== "succeeded") {
                  // Klarna annullato o fallito → rimanda al checkout
                  const status = paymentIntent?.status === "canceled" ? "canceled" : "failed"
                  setPageStatus(status)
                  setTimeout(() => {
                    window.location.href = `/checkout?sessionId=${sessionId}&payment_failed=1`
                  }, 3000)
                  return
                }
              }
            }
          }
        } catch (err) {
          console.error("[ThankYou] Errore verifica PaymentIntent:", err)
          // In caso di errore, carichiamo comunque i dati ordine
        }
      } else if (redirectStatus && redirectStatus !== "succeeded") {
        // redirect_status esplicito non succeeded, senza client_secret
        setPageStatus(redirectStatus === "canceled" ? "canceled" : "failed")
        setTimeout(() => {
          window.location.href = `/checkout?sessionId=${sessionId}&payment_failed=1`
        }, 3000)
        return
      }

      // ─── STEP 3: Carica dati ordine da Firestore ──────────────────────────
      try {
        const res = await fetch(`/api/cart-session?sessionId=${sessionId}`)
        const data = await res.json()

        if (!res.ok) throw new Error(data.error || "Errore caricamento ordine")

        const subtotal = data.subtotalCents || 0
        const total = data.totalCents || 0
        const shipping = 0
        const discount = subtotal > 0 && total > 0 ? subtotal - total : 0

        const processedOrderData: OrderData = {
          shopifyOrderNumber: data.shopifyOrderNumber,
          shopifyOrderId: data.shopifyOrderId,
          email: data.customer?.email,
          subtotalCents: subtotal,
          shippingCents: shipping,
          discountCents: discount > 0 ? discount : 0,
          totalCents: total,
          currency: data.currency || "EUR",
          shopDomain: data.shopDomain,
          paymentIntentId: data.paymentIntentId,
          rawCart: data.rawCart,
          items: data.items || [],
          customer: data.customer,
        }

        setOrderData(processedOrderData)
        setPageStatus("success")

        // ─── Analytics ──────────────────────────────────────────────────────
        if (typeof window !== "undefined") {
          if ((window as any).fbq) {
            try { (window as any).fbq("track", "PageView") } catch {}
          }
        }

        const sendGoogleConversion = () => {
          if (typeof window !== "undefined" && (window as any).gtag) {
            const cartAttrs = data.rawCart?.attributes || {}
            ;(window as any).gtag("event", "conversion", {
              send_to: "AW-17391033186/G-u0CLKyxbsbEOK22ORA",
              value: total / 100,
              currency: data.currency || "EUR",
              transaction_id: data.shopifyOrderNumber || data.shopifyOrderId || sessionId,
              utm_source: cartAttrs._wt_last_source || "",
              utm_medium: cartAttrs._wt_last_medium || "",
              utm_campaign: cartAttrs._wt_last_campaign || "",
              utm_content: cartAttrs._wt_last_content || "",
              utm_term: cartAttrs._wt_last_term || "",
            })
          }
        }

        if ((window as any).gtag) {
          sendGoogleConversion()
        } else {
          const checkGtag = setInterval(() => {
            if ((window as any).gtag) { clearInterval(checkGtag); sendGoogleConversion() }
          }, 100)
          setTimeout(() => clearInterval(checkGtag), 5000)
        }

        // ─── Save analytics ──────────────────────────────────────────────────
        try {
          const cartAttrs = data.rawCart?.attributes || {}
          await fetch("/api/analytics/purchase", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId: processedOrderData.shopifyOrderId || sessionId,
              orderNumber: processedOrderData.shopifyOrderNumber || null,
              sessionId,
              timestamp: new Date().toISOString(),
              value: total / 100,
              valueCents: total,
              subtotalCents: subtotal,
              shippingCents: shipping,
              discountCents: discount,
              currency: data.currency || "EUR",
              itemCount: (data.items || []).length,
              utm: {
                source: cartAttrs._wt_last_source || null,
                medium: cartAttrs._wt_last_medium || null,
                campaign: cartAttrs._wt_last_campaign || null,
                content: cartAttrs._wt_last_content || null,
                term: cartAttrs._wt_last_term || null,
                fbclid: cartAttrs._wt_last_fbclid || null,
                gclid: cartAttrs._wt_last_gclid || null,
              },
              utm_first: {
                source: cartAttrs._wt_first_source || null,
                medium: cartAttrs._wt_first_medium || null,
                campaign: cartAttrs._wt_first_campaign || null,
                referrer: cartAttrs._wt_first_referrer || null,
                landing: cartAttrs._wt_first_landing || null,
              },
              customer: {
                email: processedOrderData.email || null,
                fullName: data.customer?.fullName || null,
                city: data.customer?.city || null,
                postalCode: data.customer?.postalCode || null,
                countryCode: data.customer?.countryCode || null,
              },
              items: (data.items || []).map((item: any) => ({
                id: item.id || item.variant_id,
                title: item.title,
                quantity: item.quantity,
                priceCents: item.priceCents || 0,
                linePriceCents: item.linePriceCents || 0,
                variantTitle: item.variantTitle || null,
              })),
              shopDomain: data.shopDomain || "myriphoneshop.com",
            }),
          })
        } catch (err) {
          console.error("[ThankYou] Errore analytics:", err)
        }

        // ─── Clear cart ──────────────────────────────────────────────────────
        if (data.rawCart?.id || data.rawCart?.token) {
          const cartId = data.rawCart.id || `gid://shopify/Cart/${data.rawCart.token}`
          try {
            const clearRes = await fetch("/api/clear-cart", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cartId, sessionId }),
            })
            if (clearRes.ok) setCartCleared(true)
          } catch {}
        }
      } catch (err: any) {
        console.error("[ThankYou] Errore:", err)
        setPageStatus("error")
      }
    }

    init()
  }, [sessionId, paymentIntentClientSecret, redirectStatus])

  // ─── LOADING ──────────────────────────────────────────────────────────────
  if (pageStatus === "loading") {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", flexDirection: "column", gap: 16,
        background: "#f5f5f7",
      }}>
        <img
          src="https://cdn.shopify.com/s/files/1/1001/4248/1751/files/Progetto_senza_titolo.png?v=1773397241"
          alt="RiPhone" style={{ height: 40, marginBottom: 8 }}
        />
        <div style={{
          width: 40, height: 40, border: "3px solid #e5e5ea",
          borderTopColor: "#0071e3", borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }} />
        <p style={{ fontSize: 14, color: "#6e6e73", fontWeight: 500 }}>
          Verifica pagamento in corso...
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // ─── CANCELED / FAILED ────────────────────────────────────────────────────
  if (pageStatus === "canceled" || pageStatus === "failed") {
    return (
      <div style={{
        minHeight: "100vh", background: "#f5f5f7", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24,
      }}>
        <div style={{
          maxWidth: 420, width: "100%", background: "#fff", borderRadius: 20,
          padding: 40, boxShadow: "0 4px 24px rgba(0,0,0,.08)",
          border: "1px solid #e5e5ea", textAlign: "center",
        }}>
          <img
            src="https://cdn.shopify.com/s/files/1/1001/4248/1751/files/Progetto_senza_titolo.png?v=1773397241"
            alt="RiPhone" style={{ height: 36, marginBottom: 24 }}
          />
          <div style={{ fontSize: 48, marginBottom: 16 }}>
            {pageStatus === "canceled" ? "❌" : "⚠️"}
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1d1d1f", marginBottom: 12 }}>
            {pageStatus === "canceled" ? "Pagamento annullato" : "Pagamento non riuscito"}
          </h1>
          <p style={{ fontSize: 14, color: "#6e6e73", marginBottom: 28, lineHeight: 1.6 }}>
            {pageStatus === "canceled"
              ? "Hai annullato il pagamento. Il tuo carrello è ancora disponibile."
              : "Si è verificato un problema con il pagamento. Riprova."}
          </p>
          <p style={{ fontSize: 12, color: "#aeaeb2", marginBottom: 24 }}>
            Reindirizzamento al checkout in corso...
          </p>
          <a
            href={`/checkout?sessionId=${sessionId}&payment_failed=1`}
            style={{
              display: "block", padding: "14px 28px", background: "#0071e3",
              color: "#fff", borderRadius: 12, fontWeight: 700, fontSize: 15,
              textDecoration: "none",
            }}
          >
            Torna al checkout →
          </a>
        </div>
      </div>
    )
  }

  // ─── ERROR ────────────────────────────────────────────────────────────────
  if (pageStatus === "error" || !orderData) {
    return (
      <div style={{
        minHeight: "100vh", background: "#f5f5f7", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24,
      }}>
        <div style={{
          maxWidth: 420, width: "100%", background: "#fff", borderRadius: 20,
          padding: 40, boxShadow: "0 4px 24px rgba(0,0,0,.08)",
          border: "1px solid #e5e5ea", textAlign: "center",
        }}>
          <img
            src="https://cdn.shopify.com/s/files/1/1001/4248/1751/files/Progetto_senza_titolo.png?v=1773397241"
            alt="RiPhone" style={{ height: 36, marginBottom: 24 }}
          />
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1d1d1f", marginBottom: 12 }}>
            Ordine non trovato
          </h1>
          <p style={{ fontSize: 14, color: "#6e6e73", marginBottom: 28 }}>
            Non riusciamo a trovare i dettagli del tuo ordine. Controlla la tua email di conferma.
          </p>
          <a
            href={shopUrl}
            style={{
              display: "block", padding: "14px 28px", background: "#0071e3",
              color: "#fff", borderRadius: 12, fontWeight: 700, fontSize: 15,
              textDecoration: "none",
            }}
          >
            Torna al sito
          </a>
        </div>
      </div>
    )
  }

  // ─── SUCCESS ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* FACEBOOK PIXEL */}
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
        `}
      </Script>
      <Script src="https://www.googletagmanager.com/gtag/js?id=AW-17391033186" strategy="afterInteractive" />
      <Script id="google-ads-init" strategy="afterInteractive" dangerouslySetInnerHTML={{
        __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'AW-17391033186');
        `,
      }} />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes popIn {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .fadeup { animation: fadeUp 0.5s ease forwards; }
        .fadeup-1 { animation-delay: 0.1s; opacity: 0; }
        .fadeup-2 { animation-delay: 0.2s; opacity: 0; }
        .fadeup-3 { animation-delay: 0.3s; opacity: 0; }
        .fadeup-4 { animation-delay: 0.4s; opacity: 0; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#f5f5f7", fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif' }}>

        {/* HEADER */}
        <header style={{ background: "#fff", borderBottom: "1px solid #e5e5ea", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ maxWidth: 680, margin: "0 auto", padding: "14px 20px", display: "flex", justifyContent: "center" }}>
            <a href={shopUrl}>
              <img
                src="https://cdn.shopify.com/s/files/1/1001/4248/1751/files/Progetto_senza_titolo.png?v=1773397241"
                alt="RiPhone" style={{ height: 36 }}
              />
            </a>
          </div>
        </header>

        <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 16px 64px" }}>

          {/* SUCCESS HERO */}
          <div className="fadeup fadeup-1" style={{
            background: "#fff", borderRadius: 20, padding: "40px 32px 32px",
            boxShadow: "0 2px 20px rgba(0,0,0,.06)", border: "1px solid #e5e5ea",
            marginBottom: 16, textAlign: "center",
          }}>
            {/* Check icon */}
            <div style={{
              width: 72, height: 72, borderRadius: "50%",
              background: "linear-gradient(135deg, #34c759, #1a7f3c)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px",
              animation: "popIn 0.6s cubic-bezier(.175,.885,.32,1.275) forwards",
              boxShadow: "0 8px 24px rgba(52,199,89,.35)",
            }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <h1 style={{ fontSize: 26, fontWeight: 800, color: "#1d1d1f", marginBottom: 8, letterSpacing: "-0.5px" }}>
              Ordine Confermato! 🎉
            </h1>
            <p style={{ fontSize: 15, color: "#6e6e73", marginBottom: 24 }}>
              Grazie per il tuo acquisto su RiPhone
            </p>

            {/* Order number */}
            {orderData.shopifyOrderNumber && (
              <div style={{
                background: "#f5f5f7", borderRadius: 12, padding: "14px 20px",
                display: "inline-block", marginBottom: 20,
              }}>
                <p style={{ fontSize: 11, color: "#aeaeb2", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                  Numero Ordine
                </p>
                <p style={{ fontSize: 18, fontWeight: 800, color: "#0071e3", fontVariantNumeric: "tabular-nums" }}>
                  #{orderData.shopifyOrderNumber}
                </p>
              </div>
            )}

            {/* Email confirmation */}
            {orderData.email && (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "#f0f9f0", borderRadius: 10, padding: "12px 16px",
                border: "1px solid #d4edda",
              }}>
                <span style={{ fontSize: 18 }}>📧</span>
                <p style={{ fontSize: 13, color: "#1d1d1f", textAlign: "left" }}>
                  Conferma inviata a <strong>{orderData.email}</strong>
                </p>
              </div>
            )}
          </div>

          {/* ITEMS */}
          {orderData.items && orderData.items.length > 0 && (
            <div className="fadeup fadeup-2" style={{
              background: "#fff", borderRadius: 20, padding: "24px",
              boxShadow: "0 2px 20px rgba(0,0,0,.06)", border: "1px solid #e5e5ea",
              marginBottom: 16,
            }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1d1d1f", marginBottom: 16 }}>
                Prodotti acquistati
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {orderData.items.map((item, idx) => {
                  const original = (item.priceCents || 0) * item.quantity
                  const current = item.linePriceCents || 0
                  const isDisc = original > current && current > 0
                  return (
                    <div key={idx} style={{ display: "flex", gap: 14, alignItems: "center" }}>
                      {item.image && (
                        <div style={{ position: "relative", flexShrink: 0 }}>
                          <img src={item.image} alt={item.title} style={{
                            width: 64, height: 64, objectFit: "contain", borderRadius: 10,
                            border: "1px solid #e5e5ea", background: "#f5f5f7",
                          }} />
                          <span style={{
                            position: "absolute", top: -7, right: -7,
                            background: "#1d1d1f", color: "#fff",
                            width: 20, height: 20, borderRadius: "50%",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, fontWeight: 700,
                          }}>{item.quantity}</span>
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#1d1d1f" }}>{item.title}</p>
                        {item.variantTitle && (
                          <p style={{ fontSize: 11, color: "#6e6e73", marginTop: 2 }}>{item.variantTitle}</p>
                        )}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        {isDisc ? (
                          <>
                            <p style={{ fontSize: 11, color: "#aeaeb2", textDecoration: "line-through" }}>
                              {formatMoney(original)}
                            </p>
                            <p style={{ fontSize: 14, fontWeight: 700, color: "#1a7f3c" }}>
                              {formatMoney(current)}
                            </p>
                          </>
                        ) : (
                          <p style={{ fontSize: 14, fontWeight: 600, color: "#1d1d1f" }}>
                            {formatMoney(current)}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Totals */}
              <div style={{ borderTop: "1px solid #e5e5ea", paddingTop: 16, marginTop: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#6e6e73" }}>Subtotale</span>
                    <span style={{ fontWeight: 600 }}>{formatMoney(orderData.subtotalCents)}</span>
                  </div>
                  {orderData.discountCents && orderData.discountCents > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#1a7f3c", fontWeight: 600 }}>✨ Sconto</span>
                      <span style={{ color: "#1a7f3c", fontWeight: 700 }}>-{formatMoney(orderData.discountCents)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#6e6e73" }}>🚀 Spedizione</span>
                    <span style={{ fontWeight: 800, color: "#1a7f3c" }}>GRATIS</span>
                  </div>
                  <div style={{
                    display: "flex", justifyContent: "space-between",
                    borderTop: "1px solid #e5e5ea", paddingTop: 12, marginTop: 4,
                    fontSize: 17, fontWeight: 800,
                  }}>
                    <span>Totale</span>
                    <span style={{ color: "#0071e3" }}>{formatMoney(orderData.totalCents)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* COSA SUCCEDE ORA */}
          <div className="fadeup fadeup-3" style={{
            background: "linear-gradient(135deg, #0071e3 0%, #0077ed 100%)",
            borderRadius: 20, padding: "24px",
            boxShadow: "0 8px 24px rgba(0,113,227,.25)",
            marginBottom: 16,
          }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span>ℹ️</span> Cosa succede ora?
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { n: "1", text: "Riceverai una email di conferma con tutti i dettagli" },
                { n: "2", text: "Il tuo ordine sarà preparato entro 1-2 giorni lavorativi" },
                { n: "3", text: "Riceverai il codice di tracciamento via email" },
              ].map((step) => (
                <div key={step.n} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{
                    background: "rgba(255,255,255,.2)", color: "#fff",
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700,
                  }}>{step.n}</span>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,.9)", lineHeight: 1.5 }}>{step.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* GARANZIE */}
          <div className="fadeup fadeup-3" style={{
            background: "#fff", borderRadius: 20, padding: "20px 24px",
            boxShadow: "0 2px 20px rgba(0,0,0,.06)", border: "1px solid #e5e5ea",
            marginBottom: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
              {[
                { icon: "✅", label: "Ricondizionato Certificato" },
                { icon: "🏆", label: "Apple Certificato" },
                { icon: "🔋", label: "Garanzia 12 Mesi" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 24 }}>{item.icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#6e6e73", maxWidth: 70, lineHeight: 1.3 }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* BUTTONS */}
          <div className="fadeup fadeup-4" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <a href={shopUrl} style={{
              display: "block", padding: "16px", background: "#1d1d1f",
              color: "#fff", borderRadius: 14, fontWeight: 700, fontSize: 15,
              textDecoration: "none", textAlign: "center",
              boxShadow: "0 4px 14px rgba(0,0,0,.2)",
            }}>
              Torna alla home
            </a>
            <a href={`${shopUrl}/collections/all`} style={{
              display: "block", padding: "16px", background: "#fff",
              color: "#1d1d1f", borderRadius: 14, fontWeight: 600, fontSize: 15,
              textDecoration: "none", textAlign: "center",
              border: "1px solid #e5e5ea",
            }}>
              Continua lo shopping
            </a>
          </div>

          {/* SUPPORT */}
          <div style={{ textAlign: "center", marginTop: 32, paddingTop: 24, borderTop: "1px solid #e5e5ea" }}>
            <p style={{ fontSize: 13, color: "#6e6e73", marginBottom: 8 }}>Hai bisogno di aiuto?</p>
            <a href={`${shopUrl}/pages/contact`} style={{ fontSize: 14, color: "#0071e3", fontWeight: 600, textDecoration: "none" }}>
              Contatta il supporto →
            </a>
          </div>

        </div>

        {/* FOOTER */}
        <footer style={{ borderTop: "1px solid #e5e5ea", padding: "24px 20px", textAlign: "center" }}>
          <p style={{ fontSize: 12, color: "#aeaeb2" }}>© 2026 RiPhone. Tutti i diritti riservati.</p>
        </footer>
      </div>
    </>
  )
}

export default function ThankYouPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: "100vh", background: "#f5f5f7",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 16,
      }}>
        <div style={{
          width: 40, height: 40, border: "3px solid #e5e5ea",
          borderTopColor: "#0071e3", borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <ThankYouContent />
    </Suspense>
  )
}

// src/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { db } from "@/lib/firebaseAdmin"
import { getConfig } from "@/lib/config"

const COLLECTION = "cartSessions"

export async function POST(req: NextRequest) {
  try {
    console.log("[stripe-webhook] ════════════════════════════════════")
    console.log("[stripe-webhook] Webhook ricevuto")

    const config = await getConfig()
    const stripeAccounts = config.stripeAccounts.filter(
      (a) => a.secretKey && a.webhookSecret
    )

    if (stripeAccounts.length === 0) {
      console.error("[stripe-webhook] ❌ Nessun account Stripe configurato")
      return NextResponse.json({ error: "Config mancante" }, { status: 500 })
    }

    const body = await req.text()
    const signature = req.headers.get("stripe-signature")

    if (!signature) {
      console.error("[stripe-webhook] ❌ Signature mancante")
      return NextResponse.json({ error: "No signature" }, { status: 400 })
    }

    // Verifica signature con ogni account configurato
    let event: Stripe.Event | null = null
    let matchedAccount: any = null

    for (const account of stripeAccounts) {
      try {
        const stripe = new Stripe(account.secretKey)
        event = stripe.webhooks.constructEvent(
          body,
          signature,
          account.webhookSecret
        )
        matchedAccount = account
        console.log(`[stripe-webhook] ✅ Signature valida: ${account.label}`)
        break
      } catch (err) {
        // Prova il prossimo account
        continue
      }
    }

    if (!event || !matchedAccount) {
      console.error("[stripe-webhook] ❌ Signature non valida per nessun account")
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
    }

    console.log(`[stripe-webhook] 📨 Evento: ${event.type}`)
    console.log(`[stripe-webhook] 🏦 Account: ${matchedAccount.label}`)

    // ═══════════════════════════════════════════════════════
    // PAYMENT INTENT SUCCEEDED
    // ═══════════════════════════════════════════════════════
    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent

      console.log(`[stripe-webhook] 💳 Payment Intent ID: ${paymentIntent.id}`)
      console.log(`[stripe-webhook] 💰 Importo: €${(paymentIntent.amount / 100).toFixed(2)}`)
      console.log(`[stripe-webhook] 📋 Metadata:`, paymentIntent.metadata)

      const sessionId = paymentIntent.metadata?.session_id

      if (!sessionId) {
        console.error("[stripe-webhook] ⚠️ Nessun session_id nei metadata")
        console.error("[stripe-webhook] Metadata ricevuti:", JSON.stringify(paymentIntent.metadata))
        return NextResponse.json({ received: true, warning: "no_session_id" }, { status: 200 })
      }

      console.log(`[stripe-webhook] 🔑 Session ID: ${sessionId}`)

      // Carica dati sessione da Firebase
      const snap = await db.collection(COLLECTION).doc(sessionId).get()
      
      if (!snap.exists) {
        console.error(`[stripe-webhook] ❌ Session ${sessionId} non trovata in Firebase`)
        return NextResponse.json({ received: true, error: "session_not_found" }, { status: 200 })
      }

      const sessionData: any = snap.data() || {}

      // Verifica se ordine già creato (evita duplicati)
      if (sessionData.shopifyOrderId) {
        console.log(`[stripe-webhook] ℹ️ Ordine già creato: #${sessionData.shopifyOrderNumber} (${sessionData.shopifyOrderId})`)
        return NextResponse.json(
          { received: true, alreadyProcessed: true },
          { status: 200 }
        )
      }

      console.log("[stripe-webhook] 🚀 Creazione ordine Shopify in corso...")

      // ═══════════════════════════════════════════════════════
      // CREA ORDINE SHOPIFY
      // ═══════════════════════════════════════════════════════
      const result = await createShopifyOrder({
        sessionId,
        sessionData,
        paymentIntent,
        config,
        stripeAccountLabel: matchedAccount.label,
      })

      if (result.orderId) {
        console.log(`[stripe-webhook] ✅ Ordine Shopify creato: #${result.orderNumber} (ID: ${result.orderId})`)

        // Salva dati ordine in Firebase
        await db.collection(COLLECTION).doc(sessionId).update({
          shopifyOrderId: result.orderId,
          shopifyOrderNumber: result.orderNumber,
          orderCreatedAt: new Date().toISOString(),
          paymentStatus: "paid",
        })

        console.log("[stripe-webhook] ✅ Dati ordine salvati in Firebase")

        // ═══════════════════════════════════════════════════════
        // SVUOTA CARRELLO SHOPIFY
        // ═══════════════════════════════════════════════════════
        if (sessionData.rawCart?.id) {
          console.log(`[stripe-webhook] 🧹 Svuotamento carrello: ${sessionData.rawCart.id}`)
          await clearShopifyCart(sessionData.rawCart.id, config)
        } else {
          console.log("[stripe-webhook] ⚠️ Nessun cart ID disponibile per svuotamento")
        }

        console.log("[stripe-webhook] ════════════════════════════════════")
        console.log("[stripe-webhook] ✅ PROCESSO COMPLETATO CON SUCCESSO")
        console.log("[stripe-webhook] ════════════════════════════════════")
      } else {
        console.error("[stripe-webhook] ❌ Errore creazione ordine Shopify")
        console.log("[stripe-webhook] ════════════════════════════════════")
      }
    }

    return NextResponse.json({ received: true }, { status: 200 })
  } catch (error: any) {
    console.error("[stripe-webhook] ❌ ERRORE CRITICO:", error)
    console.error("[stripe-webhook] Stack:", error.stack)
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════
// CREA ORDINE SHOPIFY
// ═══════════════════════════════════════════════════════════════
async function createShopifyOrder({
  sessionId,
  sessionData,
  paymentIntent,
  config,
  stripeAccountLabel,
}: any) {
  try {
    const shopifyDomain = config.shopify?.shopDomain
    const adminToken = config.shopify?.adminToken

    if (!shopifyDomain || !adminToken) {
      console.error("[createShopifyOrder] ❌ Config Shopify mancante")
      console.error("[createShopifyOrder] Domain:", shopifyDomain)
      console.error("[createShopifyOrder] Token:", adminToken ? "presente" : "mancante")
      return { orderId: null, orderNumber: null }
    }

    const customer = sessionData.customer || {}
    const items = sessionData.items || []

    console.log("[createShopifyOrder] 👤 Dati cliente:")
    console.log("[createShopifyOrder]   - Email:", customer.email)
    console.log("[createShopifyOrder]   - Nome:", customer.fullName)
    console.log("[createShopifyOrder]   - Telefono:", customer.phone || "NON FORNITO")
    console.log("[createShopifyOrder]   - Indirizzo:", customer.address1)
    console.log("[createShopifyOrder]   - Città:", customer.city)

    if (items.length === 0) {
      console.error("[createShopifyOrder] ❌ Nessun item nel carrello")
      return { orderId: null, orderNumber: null }
    }

    console.log(`[createShopifyOrder] 📦 Prodotti: ${items.length}`)

    // ✅ GESTIONE TELEFONO: Obbligatorio per Shopify
    let phoneNumber = customer.phone?.trim() || ""
    
    if (!phoneNumber || phoneNumber.length < 5) {
      phoneNumber = "+39 000 0000000"  // Fallback se mancante
      console.log("[createShopifyOrder] ⚠️ Telefono mancante, uso fallback:", phoneNumber)
    } else {
      console.log("[createShopifyOrder] ✅ Telefono valido:", phoneNumber)
    }

    // Costruisci line items per Shopify
    const lineItems = items.map((item: any, index: number) => {
      // Estrai variant ID pulito
      let variantId = item.variant_id || item.id
      
      if (typeof variantId === "string") {
        if (variantId.includes("gid://")) {
          variantId = variantId.split("/").pop()
        }
      }

      const quantity = item.quantity || 1
      const pricePerUnit = (item.priceCents || 0) / 100
      const lineTotal = (item.linePriceCents || item.priceCents * quantity) / 100
      const price = lineTotal.toFixed(2)

      console.log(`[createShopifyOrder]   ${index + 1}. ${item.title}`)
      console.log(`[createShopifyOrder]      - Variant ID: ${variantId}`)
      console.log(`[createShopifyOrder]      - Quantità: ${quantity}`)
      console.log(`[createShopifyOrder]      - Prezzo: €${price}`)

      return {
        variant_id: parseInt(variantId),
        quantity: quantity,
        price: price,
      }
    })

    const totalCents = paymentIntent.amount
    const totalAmount = (totalCents / 100).toFixed(2)

    console.log(`[createShopifyOrder] 💰 Totale ordine: €${totalAmount}`)

    // Separa nome e cognome
    const nameParts = (customer.fullName || "Cliente Checkout").split(" ")
    const firstName = nameParts[0] || "Cliente"
    const lastName = nameParts.slice(1).join(" ") || "Checkout"

    // ═══════════════════════════════════════════════════════
    // PAYLOAD ORDINE SHOPIFY
    // ═══════════════════════════════════════════════════════
    const orderPayload = {
      order: {
        email: customer.email || "noreply@checkout.com",
        fulfillment_status: "unfulfilled",
        financial_status: "paid",
        send_receipt: true,
        send_fulfillment_receipt: true,

        line_items: lineItems,

        customer: {
          email: customer.email || "noreply@checkout.com",
          first_name: firstName,
          last_name: lastName,
          phone: phoneNumber,  // ✅ Sempre presente
        },

        shipping_address: {
          first_name: firstName,
          last_name: lastName,
          address1: customer.address1 || "",
          address2: customer.address2 || "",
          city: customer.city || "",
          province: customer.province || "",
          zip: customer.postalCode || "",
          country_code: customer.countryCode || "IT",
          phone: phoneNumber,  // ✅ Sempre presente
        },

        billing_address: {
          first_name: firstName,
          last_name: lastName,
          address1: customer.address1 || "",
          address2: customer.address2 || "",
          city: customer.city || "",
          province: customer.province || "",
          zip: customer.postalCode || "",
          country_code: customer.countryCode || "IT",
          phone: phoneNumber,  // ✅ Sempre presente
        },

        shipping_lines: [
          {
            title: "Spedizione Standard",
            price: "5.90",
            code: "STANDARD",
          },
        ],

        transactions: [
          {
            kind: "sale",
            status: "success",
            amount: totalAmount,
            currency: paymentIntent.currency.toUpperCase(),
            gateway: `Stripe (${stripeAccountLabel})`,
            authorization: paymentIntent.id,
          },
        ],

        note: `Checkout custom - Session: ${sessionId} - Stripe Account: ${stripeAccountLabel} - Payment Intent: ${paymentIntent.id}`,
        tags: `checkout-custom, stripe-paid, ${stripeAccountLabel}, automated`,
      },
    }

    console.log("[createShopifyOrder] 📤 Invio ordine a Shopify...")

    // ═══════════════════════════════════════════════════════
    // CHIAMATA API SHOPIFY
    // ═══════════════════════════════════════════════════════
    const response = await fetch(
      `https://${shopifyDomain}/admin/api/2024-10/orders.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
        body: JSON.stringify(orderPayload),
      }
    )

    const responseText = await response.text()

    if (!response.ok) {
      console.error("[createShopifyOrder] ❌ Errore Shopify API")
      console.error("[createShopifyOrder] Status:", response.status)
      console.error("[createShopifyOrder] Risposta:", responseText)
      
      try {
        const errorData = JSON.parse(responseText)
        console.error("[createShopifyOrder] Errori dettagliati:", JSON.stringify(errorData.errors, null, 2))
      } catch (e) {
        // Ignore JSON parse error
      }
      
      return { orderId: null, orderNumber: null }
    }

    const result = JSON.parse(responseText)

    if (result.order?.id) {
      console.log("[createShopifyOrder] ✅ ORDINE CREATO CON SUCCESSO!")
      console.log(`[createShopifyOrder]    - Numero: #${result.order.order_number}`)
      console.log(`[createShopifyOrder]    - ID: ${result.order.id}`)
      console.log(`[createShopifyOrder]    - Totale: €${result.order.total_price}`)
      
      return {
        orderId: result.order.id,
        orderNumber: result.order.order_number,
      }
    }

    console.error("[createShopifyOrder] ❌ Risposta Shopify senza order.id")
    console.error("[createShopifyOrder] Risposta completa:", JSON.stringify(result, null, 2))
    return { orderId: null, orderNumber: null }
  } catch (error: any) {
    console.error("[createShopifyOrder] ❌ ERRORE:", error.message)
    console.error("[createShopifyOrder] Stack:", error.stack)
    return { orderId: null, orderNumber: null }
  }
}

// ═══════════════════════════════════════════════════════════════
// SVUOTA CARRELLO SHOPIFY
// ═══════════════════════════════════════════════════════════════
async function clearShopifyCart(cartId: string, config: any) {
  try {
    const shopifyDomain = config.shopify?.shopDomain
    const storefrontToken = config.shopify?.storefrontToken

    if (!shopifyDomain || !storefrontToken) {
      console.log("[clearShopifyCart] ⚠️ Config mancante, skip svuotamento")
      console.log("[clearShopifyCart]   - Domain:", shopifyDomain || "mancante")
      console.log("[clearShopifyCart]   - Token:", storefrontToken ? "presente" : "mancante")
      return
    }

    console.log(`[clearShopifyCart] 🔍 Recupero linee carrello: ${cartId}`)

    // ═══════════════════════════════════════════════════════
    // STEP 1: Ottieni IDs delle linee del carrello
    // ═══════════════════════════════════════════════════════
    const queryCart = `
      query getCart($cartId: ID!) {
        cart(id: $cartId) {
          lines(first: 100) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `

    const cartResponse = await fetch(
      `https://${shopifyDomain}/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": storefrontToken,
        },
        body: JSON.stringify({
          query: queryCart,
          variables: { cartId },
        }),
      }
    )

    const cartData = await cartResponse.json()

    if (cartData.errors) {
      console.error("[clearShopifyCart] ❌ Errore GraphQL query:", cartData.errors)
      return
    }

    const lineIds =
      cartData.data?.cart?.lines?.edges?.map((edge: any) => edge.node.id) || []

    if (lineIds.length === 0) {
      console.log("[clearShopifyCart] ℹ️ Carrello già vuoto")
      return
    }

    console.log(`[clearShopifyCart] 📋 Trovate ${lineIds.length} linee da rimuovere`)

    // ═══════════════════════════════════════════════════════
    // STEP 2: Rimuovi tutte le linee
    // ═══════════════════════════════════════════════════════
    const mutation = `
      mutation cartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
        cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
          cart {
            id
            totalQuantity
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const removeResponse = await fetch(
      `https://${shopifyDomain}/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": storefrontToken,
        },
        body: JSON.stringify({
          query: mutation,
          variables: { cartId, lineIds },
        }),
      }
    )

    const removeData = await removeResponse.json()

    if (removeData.data?.cartLinesRemove?.userErrors?.length > 0) {
      console.error("[clearShopifyCart] ❌ Errori rimozione linee:")
      removeData.data.cartLinesRemove.userErrors.forEach((err: any) => {
        console.error(`[clearShopifyCart]   - ${err.field}: ${err.message}`)
      })
    } else {
      const finalQuantity = removeData.data?.cartLinesRemove?.cart?.totalQuantity || 0
      console.log(`[clearShopifyCart] ✅ Carrello svuotato (quantità finale: ${finalQuantity})`)
    }
  } catch (error: any) {
    console.error("[clearShopifyCart] ❌ ERRORE:", error.message)
    console.error("[clearShopifyCart] Stack:", error.stack)
  }
}

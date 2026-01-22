// src/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { db } from "@/lib/firebaseAdmin"
import { getConfig } from "@/lib/config"
import crypto from "crypto"

const COLLECTION = "cartSessions"

export async function POST(req: NextRequest) {
  try {
    console.log("[stripe-webhook] ════════════════════════════════════")
    console.log("[stripe-webhook] 🔔 Webhook ricevuto:", new Date().toISOString())

    const config = await getConfig()

    const stripeAccounts = config.stripeAccounts.filter(
      (a: any) => a.secretKey && a.webhookSecret && a.active
    )

    if (stripeAccounts.length === 0) {
      console.error("[stripe-webhook] ❌ Nessun account Stripe attivo configurato")
      return NextResponse.json({ error: "Config mancante" }, { status: 500 })
    }

    console.log(`[stripe-webhook] 📋 Account attivi: ${stripeAccounts.length}`)

    const body = await req.text()
    const signature = req.headers.get("stripe-signature")

    if (!signature) {
      console.error("[stripe-webhook] ❌ Signature mancante")
      return NextResponse.json({ error: "No signature" }, { status: 400 })
    }

    let event: Stripe.Event | null = null
    let matchedAccount: any = null

    console.log(`[stripe-webhook] 🔍 Verifica signature con ${stripeAccounts.length} account...`)

    for (const account of stripeAccounts) {
      try {
        const stripe = new Stripe(account.secretKey)
        event = stripe.webhooks.constructEvent(
          body,
          signature,
          account.webhookSecret
        )
        matchedAccount = account
        console.log(`[stripe-webhook] ✅ Signature VALIDA per: ${account.label}`)
        console.log(`[stripe-webhook] 🔑 Webhook Secret: ${account.webhookSecret.substring(0, 20)}...`)
        break
      } catch (err: any) {
        console.log(`[stripe-webhook] ❌ Signature NON valida per ${account.label}: ${err.message}`)
        continue
      }
    }

    if (!event || !matchedAccount) {
      console.error("[stripe-webhook] 💥 NESSUN ACCOUNT HA VALIDATO LA SIGNATURE!")
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
    }

    console.log(`[stripe-webhook] 📨 Evento: ${event.type}`)
    console.log(`[stripe-webhook] 🏦 Account: ${matchedAccount.label}`)

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent

      console.log(`[stripe-webhook] 💳 Payment Intent ID: ${paymentIntent.id}`)
      console.log(`[stripe-webhook] 💰 Importo: €${(paymentIntent.amount / 100).toFixed(2)}`)
      console.log(`[stripe-webhook] 📋 Metadata:`, JSON.stringify(paymentIntent.metadata, null, 2))

      // 🔥 FIX: Supporta ENTRAMBI i formati (camelCase E snake_case)
      const sessionId = paymentIntent.metadata?.sessionId || paymentIntent.metadata?.session_id

      if (!sessionId) {
        console.error("[stripe-webhook] ❌ NESSUN sessionId nei metadata!")
        console.error("[stripe-webhook] Metadata disponibili:", Object.keys(paymentIntent.metadata || {}))
        return NextResponse.json({ received: true, warning: "no_session_id" }, { status: 200 })
      }

      console.log(`[stripe-webhook] 🔑 Session ID: ${sessionId}`)

      const snap = await db.collection(COLLECTION).doc(sessionId).get()

      if (!snap.exists) {
        console.error(`[stripe-webhook] ❌ Sessione ${sessionId} NON TROVATA in Firebase`)
        return NextResponse.json({ received: true, error: "session_not_found" }, { status: 200 })
      }

      const sessionData: any = snap.data() || {}
      console.log(`[stripe-webhook] ✅ Sessione trovata`)
      console.log(`[stripe-webhook] 📦 Items: ${sessionData.items?.length || 0}`)

      // 🔥 FIX: Log migliorato con TUTTI i dati cliente
      console.log(`[stripe-webhook] 👤 Cliente completo:`, JSON.stringify(sessionData.customer, null, 2))
      console.log(`[stripe-webhook] 📧 Email: ${sessionData.customer?.email || 'N/A'}`)
      console.log(`[stripe-webhook] 👤 Nome: ${sessionData.customer?.fullName || 'N/A'}`)
      console.log(`[stripe-webhook] 📞 Phone: ${sessionData.customer?.phone || 'N/A'}`)
      console.log(`[stripe-webhook] 🏠 Address: ${sessionData.customer?.address1 || 'N/A'}`)
      console.log(`[stripe-webhook] 🏙️ City: ${sessionData.customer?.city || 'N/A'}`)

      if (sessionData.shopifyOrderId) {
        console.log(`[stripe-webhook] ℹ️ Ordine già esistente: #${sessionData.shopifyOrderNumber}`)
        return NextResponse.json({ received: true, alreadyProcessed: true }, { status: 200 })
      }

      console.log("[stripe-webhook] 🚀 CREAZIONE ORDINE SHOPIFY...")

      const result = await createShopifyOrder({
        sessionId,
        sessionData,
        paymentIntent,
        config,
        stripeAccountLabel: matchedAccount.label,
      })

      if (result.orderId) {
        console.log(`[stripe-webhook] 🎉 Ordine creato: #${result.orderNumber} (ID: ${result.orderId})`)

        await db.collection(COLLECTION).doc(sessionId).update({
          shopifyOrderId: result.orderId,
          shopifyOrderNumber: result.orderNumber,
          orderCreatedAt: new Date().toISOString(),
          paymentStatus: "paid",
          webhookProcessedAt: new Date().toISOString(),
          stripeAccountUsed: matchedAccount.label,
        })

        console.log("[stripe-webhook] ✅ Dati salvati in Firebase")

        // ✅ SALVA STATISTICHE GIORNALIERE
        const today = new Date().toISOString().split('T')[0]
        const statsRef = db.collection('dailyStats').doc(today)

        await db.runTransaction(async (transaction) => {
          const statsDoc = await transaction.get(statsRef)

          if (!statsDoc.exists) {
            transaction.set(statsRef, {
              date: today,
              accounts: {
                [matchedAccount.label]: {
                  totalCents: paymentIntent.amount,
                  transactionCount: 1,
                }
              },
              totalCents: paymentIntent.amount,
              totalTransactions: 1,
            })
          } else {
            const data = statsDoc.data()!
            const accountStats = data.accounts?.[matchedAccount.label] || { totalCents: 0, transactionCount: 0 }

            transaction.update(statsRef, {
              [\`accounts.\${matchedAccount.label}.totalCents\`]: accountStats.totalCents + paymentIntent.amount,
              [\`accounts.\${matchedAccount.label}.transactionCount\`]: accountStats.transactionCount + 1,
              totalCents: (data.totalCents || 0) + paymentIntent.amount,
              totalTransactions: (data.totalTransactions || 0) + 1,
            })
          }
        })

        console.log("[stripe-webhook] 💾 Statistiche giornaliere aggiornate")

        // ✅ INVIO META CONVERSIONS API (SERVER-SIDE TRACKING)
        await sendMetaPurchaseEvent({
          paymentIntent,
          sessionData,
          sessionId,
          req,
        })

        // Svuota carrello
        if (sessionData.rawCart?.id) {
          console.log(`[stripe-webhook] 🧹 Svuotamento carrello...`)
          await clearShopifyCart(sessionData.rawCart.id, config)
        }

        console.log("[stripe-webhook] ════════════════════════════════════")
        console.log("[stripe-webhook] ✅ COMPLETATO CON SUCCESSO")
        console.log("[stripe-webhook] ════════════════════════════════════")

        return NextResponse.json({ 
          received: true, 
          orderId: result.orderId,
          orderNumber: result.orderNumber 
        }, { status: 200 })
      } else {
        console.error("[stripe-webhook] ❌ Creazione ordine FALLITA")
        return NextResponse.json({ received: true, error: "order_creation_failed" }, { status: 200 })
      }
    }

    console.log(`[stripe-webhook] ℹ️ Evento ${event.type} ignorato`)
    return NextResponse.json({ received: true }, { status: 200 })

  } catch (error: any) {
    console.error("[stripe-webhook] 💥 ERRORE CRITICO:")
    console.error("[stripe-webhook] Messaggio:", error.message)
    console.error("[stripe-webhook] Stack:", error.stack)
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════
// META CONVERSIONS API - SERVER-SIDE TRACKING
// ═══════════════════════════════════════════════════════════════
async function sendMetaPurchaseEvent({
  paymentIntent,
  sessionData,
  sessionId,
  req,
}: {
  paymentIntent: any
  sessionData: any
  sessionId: string
  req: NextRequest
}) {
  const pixelId = process.env.NEXT_PUBLIC_FB_PIXEL_ID
  const accessToken = process.env.FB_CAPI_ACCESS_TOKEN

  if (!pixelId || !accessToken) {
    console.log('[stripe-webhook] ⚠️ Meta Pixel non configurato (skip CAPI)')
    return
  }

  try {
    console.log('[stripe-webhook] 📊 Invio Meta Conversions API...')

    const customer = sessionData.customer || {}

    // ✅ HASH dati sensibili (requirement Meta)
    const hashData = (data: string) => {
      return data ? crypto.createHash('sha256').update(data.toLowerCase().trim()).digest('hex') : undefined
    }

    const eventId = paymentIntent.id
    const eventTime = Math.floor(Date.now() / 1000)

    const userData: any = {
      client_ip_address: req.headers.get('x-forwarded-for')?.split(',')[0] || 
                         req.headers.get('x-real-ip') || 
                         '0.0.0.0',
      client_user_agent: req.headers.get('user-agent') || '',
    }

    if (customer.email) {
      userData.em = hashData(customer.email)
    }
    if (customer.phone) {
      const cleanPhone = customer.phone.replace(/\D/g, '')
      userData.ph = hashData(cleanPhone)
    }
    if (customer.fullName) {
      const nameParts = customer.fullName.split(' ')
      if (nameParts[0]) userData.fn = hashData(nameParts[0])
      if (nameParts[1]) userData.ln = hashData(nameParts.slice(1).join(' '))
    }
    if (customer.city) {
      userData.ct = hashData(customer.city)
    }
    if (customer.postalCode) {
      userData.zp = customer.postalCode.replace(/\s/g, '').toLowerCase()
    }
    if (customer.countryCode) {
      userData.country = customer.countryCode.toLowerCase()
    }

    if (paymentIntent.metadata?.fbp) {
      userData.fbp = paymentIntent.metadata.fbp
    }
    if (paymentIntent.metadata?.fbc) {
      userData.fbc = paymentIntent.metadata.fbc
    }

    const customData: any = {
      value: paymentIntent.amount / 100,
      currency: (paymentIntent.currency || 'EUR').toUpperCase(),
      content_type: 'product',
    }

    if (sessionData.items && sessionData.items.length > 0) {
      customData.content_ids = sessionData.items.map((item: any) => String(item.id || item.variant_id))
      customData.num_items = sessionData.items.length
      customData.contents = sessionData.items.map((item: any) => ({
        id: String(item.id || item.variant_id),
        quantity: item.quantity || 1,
        item_price: (item.priceCents || 0) / 100,
      }))
    }

    const payload = {
      data: [{
        event_name: 'Purchase',
        event_time: eventTime,
        event_id: eventId,
        event_source_url: \`https://oltreboutique.com/thank-you?sessionId=\${sessionId}\`,
        action_source: 'website',
        user_data: userData,
        custom_data: customData,
      }],
      access_token: accessToken,
    }

    console.log('[stripe-webhook] 📤 Payload Meta CAPI:', JSON.stringify(payload, null, 2))

    const response = await fetch(
      \`https://graph.facebook.com/v18.0/\${pixelId}/events\`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    const result = await response.json()

    if (response.ok && result.events_received > 0) {
      console.log('[stripe-webhook] ✅ Meta CAPI Purchase inviato con successo')
      console.log('[stripe-webhook] Event ID:', eventId)
      console.log('[stripe-webhook] Events received:', result.events_received)
    } else {
      console.error('[stripe-webhook] ❌ Errore Meta CAPI:', result)
    }

  } catch (error: any) {
    console.error('[stripe-webhook] ⚠️ Errore invio Meta CAPI:', error.message)
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

    console.log("[createShopifyOrder] 🔍 Config Shopify:")
    console.log("[createShopifyOrder]    Domain:", shopifyDomain || "❌ MANCANTE")
    console.log("[createShopifyOrder]    Token:", adminToken ? "✅ Presente" : "❌ MANCANTE")

    if (!shopifyDomain || !adminToken) {
      console.error("[createShopifyOrder] ❌ Config Shopify mancante")
      return { orderId: null, orderNumber: null }
    }

    const customer = sessionData.customer || {}
    const items = sessionData.items || []

    if (items.length === 0) {
      console.error("[createShopifyOrder] ❌ Nessun prodotto nel carrello")
      return { orderId: null, orderNumber: null }
    }

    // 🔥 FIX: Log migliorato con TUTTI i dati cliente
    console.log(\`[createShopifyOrder] 📦 Prodotti: \${items.length}\`)
    console.log(\`[createShopifyOrder] 👤 Cliente completo:\`, JSON.stringify(customer, null, 2))
    console.log(\`[createShopifyOrder] 📧 Email: \${customer.email || 'N/A'}\`)
    console.log(\`[createShopifyOrder] 👤 Nome: \${customer.fullName || 'N/A'}\`)
    console.log(\`[createShopifyOrder] 📞 Telefono: \${customer.phone || 'N/A'}\`)
    console.log(\`[createShopifyOrder] 🏠 Indirizzo: \${customer.address1 || 'N/A'}\`)
    console.log(\`[createShopifyOrder] 🏙️ Città: \${customer.city || 'N/A'}\`)

    // 🔥 FIX: Validazione telefono CORRETTA
    let phoneNumber = (customer.phone || "").trim()
    const hasValidPhone = phoneNumber && phoneNumber.length >= 10 && !phoneNumber.includes("000")

    if (!hasValidPhone) {
      phoneNumber = ""
      console.log("[createShopifyOrder] ⚠️ Telefono mancante o invalido, NON lo invio a Shopify")
    } else {
      console.log(\`[createShopifyOrder] ✅ Telefono valido: \${phoneNumber}\`)
    }

    const lineItems = items.map((item: any, index: number) => {
      let variantId = item.variant_id || item.id

      if (typeof variantId === "string") {
        if (variantId.includes("gid://")) {
          variantId = variantId.split("/").pop()
        }
        variantId = variantId.replace(/\D/g, '')
      }

      const variantIdNum = parseInt(variantId)

      if (isNaN(variantIdNum) || variantIdNum <= 0) {
        console.error(\`[createShopifyOrder] ❌ Variant ID invalido per item \${index + 1}\`)
        return null
      }

      const quantity = item.quantity || 1
      const lineTotal = (item.linePriceCents || item.priceCents * quantity || 0) / 100
      const price = lineTotal.toFixed(2)

      console.log(\`[createShopifyOrder]    \${index + 1}. \${item.title} - €\${price}\`)

      return {
        variant_id: variantIdNum,
        quantity: quantity,
        price: price,
      }
    }).filter((item: any) => item !== null)

    if (lineItems.length === 0) {
      console.error("[createShopifyOrder] ❌ Nessun line item valido")
      return { orderId: null, orderNumber: null }
    }

    const totalAmount = (paymentIntent.amount / 100).toFixed(2)
    console.log(\`[createShopifyOrder] 💰 Totale: €\${totalAmount}\`)

    const nameParts = (customer.fullName || "Cliente Checkout").trim().split(/\s+/)
    const firstName = nameParts[0] || "Cliente"
    const lastName = nameParts.slice(1).join(" ") || "Checkout"

    // 🔥 FIX: Costruisci customer/address SOLO con campi validi
    const customerData: any = {
      email: customer.email || "noreply@oltreboutique.com",
      first_name: firstName,
      last_name: lastName,
    }

    // Aggiungi phone SOLO se valido
    if (hasValidPhone) {
      customerData.phone = phoneNumber
    }

    const addressData: any = {
      first_name: firstName,
      last_name: lastName,
      address1: customer.address1 || "N/A",
      address2: customer.address2 || "",
      city: customer.city || "N/A",
      province: customer.province || "",
      zip: customer.postalCode || "00000",
      country_code: (customer.countryCode || "IT").toUpperCase(),
    }

    // Aggiungi phone SOLO se valido
    if (hasValidPhone) {
      addressData.phone = phoneNumber
    }

    console.log("[createShopifyOrder] 📋 Customer data:", JSON.stringify(customerData, null, 2))
    console.log("[createShopifyOrder] 📋 Address data:", JSON.stringify(addressData, null, 2))

    const orderPayload = {
      order: {
        email: customer.email || "noreply@oltreboutique.com",
        fulfillment_status: "unfulfilled",
        financial_status: "paid",
        send_receipt: true,
        send_fulfillment_receipt: false,

        line_items: lineItems,

        customer: customerData,
        shipping_address: addressData,
        billing_address: addressData,

        shipping_lines: [
          {
            title: "Spedizione Gratuita",
            price: "0.00",
            code: "FREE",
          },
        ],

        transactions: [
          {
            kind: "sale",
            status: "success",
            amount: totalAmount,
            currency: (paymentIntent.currency || "EUR").toUpperCase(),
            gateway: \`Stripe (\${stripeAccountLabel})\`,
            authorization: paymentIntent.id,
          },
        ],

        note: \`Checkout custom - Session: \${sessionId} - Stripe Account: \${stripeAccountLabel} - Payment Intent: \${paymentIntent.id}\`,
        tags: \`checkout-custom,stripe-paid,\${stripeAccountLabel},automated\`,
      },
    }

    console.log("[createShopifyOrder] 📤 Invio a Shopify API...")

    const response = await fetch(
      \`https://\${shopifyDomain}/admin/api/2024-10/orders.json\`,
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
      console.error("[createShopifyOrder] ❌ ERRORE API Shopify")
      console.error("[createShopifyOrder] Status:", response.status)
      console.error("[createShopifyOrder] Risposta:", responseText)

      try {
        const errorData = JSON.parse(responseText)
        console.error("[createShopifyOrder] Errori:", JSON.stringify(errorData, null, 2))
      } catch (e) {}

      return { orderId: null, orderNumber: null }
    }

    const result = JSON.parse(responseText)

    if (result.order?.id) {
      console.log("[createShopifyOrder] 🎉 ORDINE CREATO!")
      console.log(\`[createShopifyOrder]    #\${result.order.order_number} (ID: \${result.order.id})\`)

      return {
        orderId: result.order.id,
        orderNumber: result.order.order_number,
      }
    }

    console.error("[createShopifyOrder] ❌ Risposta senza order.id")
    return { orderId: null, orderNumber: null }

  } catch (error: any) {
    console.error("[createShopifyOrder] 💥 ERRORE:", error.message)
    return { orderId: null, orderNumber: null }
  }
}

// ═══════════════════════════════════════════════════════════════
// SVUOTA CARRELLO
// ═══════════════════════════════════════════════════════════════
async function clearShopifyCart(cartId: string, config: any) {
  try {
    const shopifyDomain = config.shopify?.shopDomain
    const storefrontToken = config.shopify?.storefrontToken

    if (!shopifyDomain || !storefrontToken) {
      console.log("[clearShopifyCart] ⚠️ Config mancante, skip")
      return
    }

    const queryCart = \`
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
    \`

    const cartResponse = await fetch(
      \`https://\${shopifyDomain}/api/2024-10/graphql.json\`,
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
      console.error("[clearShopifyCart] ❌ Errore query:", cartData.errors)
      return
    }

    const lineIds = cartData.data?.cart?.lines?.edges?.map((edge: any) => edge.node.id) || []

    if (lineIds.length === 0) {
      console.log("[clearShopifyCart] ℹ️ Carrello già vuoto")
      return
    }

    const mutation = \`
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
    \`

    const removeResponse = await fetch(
      \`https://\${shopifyDomain}/api/2024-10/graphql.json\`,
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
      console.error("[clearShopifyCart] ❌ Errori:", removeData.data.cartLinesRemove.userErrors)
    } else {
      console.log("[clearShopifyCart] ✅ Carrello svuotato")
    }
  } catch (error: any) {
    console.error("[clearShopifyCart] ❌ Errore:", error.message)
  }
}

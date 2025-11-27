// src/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { db } from "@/lib/firebaseAdmin"
import { getConfig } from "@/lib/config"

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
        break
      } catch (err: any) {
        console.log(`[stripe-webhook] ❌ Signature NON valida per ${account.label}`)
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

      const sessionId = paymentIntent.metadata?.session_id

      if (!sessionId) {
        console.error("[stripe-webhook] ❌ NESSUN session_id nei metadata!")
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
      console.log(`[stripe-webhook] 👤 Cliente: ${sessionData.customer?.email || 'N/A'}`)

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

        // ✅ SALVA DATI ORDINE IN cartSessions
        await db.collection(COLLECTION).doc(sessionId).update({
          shopifyOrderId: result.orderId,
          shopifyOrderNumber: result.orderNumber,
          orderCreatedAt: new Date().toISOString(),
          paymentStatus: "paid",
          webhookProcessedAt: new Date().toISOString(),
          stripeAccountUsed: matchedAccount.label,
        })

        // ✅ SALVA TRANSAZIONE IN COLLECTION SEPARATA (per dashboard)
        const today = new Date().toISOString().split('T')[0] // "2025-11-27"
        
        await db.collection('transactions').add({
          paymentIntentId: paymentIntent.id,
          stripeAccount: matchedAccount.label,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          status: 'succeeded',
          email: sessionData.customer?.email || paymentIntent.receipt_email || 'N/A',
          customerName: sessionData.customer?.fullName || '',
          orderNumber: result.orderNumber,
          shopifyOrderId: result.orderId,
          sessionId: sessionId,
          createdAt: new Date(paymentIntent.created * 1000),
          createdTimestamp: paymentIntent.created,
          date: today,
        })

        console.log("[stripe-webhook] 💾 Transazione salvata in Firebase")

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

    console.log(`[createShopifyOrder] 📦 Prodotti: ${items.length}`)
    console.log(`[createShopifyOrder] 👤 Cliente: ${customer.email || 'N/A'}`)

    let phoneNumber = (customer.phone || "").trim()
    if (!phoneNumber || phoneNumber.length < 5) {
      phoneNumber = "+39 000 0000000"
      console.log("[createShopifyOrder] ⚠️ Telefono mancante, uso fallback")
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
        console.error(`[createShopifyOrder] ❌ Variant ID invalido per item ${index + 1}`)
        return null
      }

      const quantity = item.quantity || 1
      const lineTotal = (item.linePriceCents || item.priceCents * quantity || 0) / 100
      const price = lineTotal.toFixed(2)

      console.log(`[createShopifyOrder]    ${index + 1}. ${item.title} - €${price}`)

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
    console.log(`[createShopifyOrder] 💰 Totale: €${totalAmount}`)

    const nameParts = (customer.fullName || "Cliente Checkout").trim().split(/\s+/)
    const firstName = nameParts[0] || "Cliente"
    const lastName = nameParts.slice(1).join(" ") || "Checkout"

    const orderPayload = {
      order: {
        email: customer.email || "noreply@notforresale.it",
        fulfillment_status: "unfulfilled",
        financial_status: "paid",
        send_receipt: true,
        send_fulfillment_receipt: false,

        line_items: lineItems,

        customer: {
          email: customer.email || "noreply@notforresale.it",
          first_name: firstName,
          last_name: lastName,
          phone: phoneNumber,
        },

        shipping_address: {
          first_name: firstName,
          last_name: lastName,
          address1: customer.address1 || "N/A",
          address2: customer.address2 || "",
          city: customer.city || "N/A",
          province: customer.province || "",
          zip: customer.postalCode || "00000",
          country_code: (customer.countryCode || "IT").toUpperCase(),
          phone: phoneNumber,
        },

        billing_address: {
          first_name: firstName,
          last_name: lastName,
          address1: customer.address1 || "N/A",
          address2: customer.address2 || "",
          city: customer.city || "N/A",
          province: customer.province || "",
          zip: customer.postalCode || "00000",
          country_code: (customer.countryCode || "IT").toUpperCase(),
          phone: phoneNumber,
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
            currency: (paymentIntent.currency || "EUR").toUpperCase(),
            gateway: `Stripe (${stripeAccountLabel})`,
            authorization: paymentIntent.id,
          },
        ],

        note: `Checkout custom - Session: ${sessionId} - Stripe Account: ${stripeAccountLabel} - Payment Intent: ${paymentIntent.id}`,
        tags: `checkout-custom,stripe-paid,${stripeAccountLabel},automated`,
      },
    }

    console.log("[createShopifyOrder] 📤 Invio a Shopify API...")

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
      console.log(`[createShopifyOrder]    #${result.order.order_number} (ID: ${result.order.id})`)
      
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

async function clearShopifyCart(cartId: string, config: any) {
  try {
    const shopifyDomain = config.shopify?.shopDomain
    const storefrontToken = config.shopify?.storefrontToken

    if (!shopifyDomain || !storefrontToken) {
      console.log("[clearShopifyCart] ⚠️ Config mancante, skip")
      return
    }

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
      console.error("[clearShopifyCart] ❌ Errore query:", cartData.errors)
      return
    }

    const lineIds = cartData.data?.cart?.lines?.edges?.map((edge: any) => edge.node.id) || []

    if (lineIds.length === 0) {
      console.log("[clearShopifyCart] ℹ️ Carrello già vuoto")
      return
    }

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
      console.error("[clearShopifyCart] ❌ Errori:", removeData.data.cartLinesRemove.userErrors)
    } else {
      console.log("[clearShopifyCart] ✅ Carrello svuotato")
    }
  } catch (error: any) {
    console.error("[clearShopifyCart] ❌ Errore:", error.message)
  }
}

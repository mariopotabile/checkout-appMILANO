// src/app/api/payment-intent/route.ts
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { db } from "@/lib/firebaseAdmin"
import { getActiveStripeAccount } from "@/lib/stripeRotation"

const COLLECTION = "cartSessions"

type CustomerPayload = {
  fullName?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  address1?: string
  address2?: string
  city?: string
  postalCode?: string
  province?: string
  countryCode?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)

    const sessionId = body?.sessionId as string | undefined
    const amountCents = body?.amountCents as number | undefined
    const customerBody = (body?.customer || {}) as CustomerPayload

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId mancante" }, { status: 400 })
    }

    if (typeof amountCents !== "number" || amountCents < 50) {
      return NextResponse.json(
        { error: "Importo non valido (minimo 50 centesimi)" },
        { status: 400 }
      )
    }

    const snap = await db.collection(COLLECTION).doc(sessionId).get()

    if (!snap.exists) {
      return NextResponse.json(
        { error: "Nessun carrello trovato per questa sessione" },
        { status: 404 }
      )
    }

    const data: any = snap.data() || {}
    const currency = (data.currency || "EUR").toString().toLowerCase()

    const fullNameRaw =
      customerBody.fullName ||
      `${customerBody.firstName || ""} ${customerBody.lastName || ""}`.trim()

    const fullName = fullNameRaw || ""
    const email = (customerBody.email || "").trim()
    const phone = (customerBody.phone || "").trim()
    const address1 = customerBody.address1 || ""
    const address2 = customerBody.address2 || ""
    const city = customerBody.city || ""
    const postalCode = customerBody.postalCode || ""
    const province = customerBody.province || ""
    const countryCode = (customerBody.countryCode || "IT").toUpperCase()

    // ✅ USA SEMPRE L'ACCOUNT ATTIVO CORRENTE
    const activeAccount = await getActiveStripeAccount()

    const secretKey = activeAccount.secretKey
    const publishableKey = activeAccount.publishableKey
    const merchantSite = activeAccount.merchantSite || 'https://nfrcheckout.com'

    const descriptorRaw = activeAccount.label || "NFR"
    // ✅ STATEMENT DESCRIPTOR MIGLIORATO (riduce dispute)
    const statementDescriptorSuffix =
      `${descriptorRaw.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 18)} ORDER`.slice(0, 22)

    // Product title random
    const productTitles: string[] = []
    for (let i = 1; i <= 10; i++) {
      const key = `productTitle${i}` as keyof typeof activeAccount
      const title = activeAccount[key]
      if (title && typeof title === 'string' && title.trim()) {
        productTitles.push(title.trim())
      }
    }
    const randomProductTitle = productTitles.length
      ? productTitles[Math.floor(Math.random() * productTitles.length)]
      : 'NFR Product'

    console.log(`[payment-intent] 🔄 Account attivo: ${activeAccount.label}`)
    console.log(`[payment-intent] 🔑 Publishable Key: ${publishableKey.substring(0, 30)}...`)
    console.log(`[payment-intent] 🎲 Product title: ${randomProductTitle}`)
    console.log(`[payment-intent] 💰 Amount: €${(amountCents / 100).toFixed(2)}`)

    // Inizializza Stripe con secret key dell'account attivo
    const stripe = new Stripe(secretKey, {
      apiVersion: "2025-10-29.clover",
    })

    // ✅ CREA O OTTIENI CUSTOMER
    let stripeCustomerId = data.stripeCustomerId as string | undefined

    if (!stripeCustomerId && email) {
      try {
        const existingCustomers = await stripe.customers.list({
          email: email,
          limit: 1,
        })

        if (existingCustomers.data.length > 0) {
          stripeCustomerId = existingCustomers.data[0].id
          console.log(`[payment-intent] ✓ Customer esistente: ${stripeCustomerId}`)
        } else {
          const customer = await stripe.customers.create({
            email: email,
            name: fullName || undefined,
            phone: phone || undefined,
            address: address1 ? {
              line1: address1,
              line2: address2 || undefined,
              city: city || undefined,
              postal_code: postalCode || undefined,
              state: province || undefined,
              country: countryCode || undefined,
            } : undefined,
            metadata: {
              merchant_site: merchantSite,
              session_id: sessionId,
              stripe_account: activeAccount.label,
            },
          })

          stripeCustomerId = customer.id
          console.log(`[payment-intent] ✓ Nuovo customer: ${stripeCustomerId}`)

          await db.collection(COLLECTION).doc(sessionId).update({
            stripeCustomerId,
          })
        }
      } catch (customerError: any) {
        console.error("[payment-intent] Errore customer:", customerError)
      }
    }

    const orderNumber = data.orderNumber || sessionId
    const description = `${orderNumber} | ${fullName || "Guest"}`

    let shipping: Stripe.PaymentIntentCreateParams.Shipping | undefined

    if (fullName && address1 && city && postalCode) {
      shipping = {
        name: fullName,
        phone: phone || undefined,
        address: {
          line1: address1,
          line2: address2 || undefined,
          city: city,
          postal_code: postalCode,
          state: province,
          country: countryCode,
        },
      }
    }

    // ✅ CREA NUOVO PI sull'account corrente
    console.log(`[payment-intent] 🆕 Creazione nuovo PI su account corrente`)

    const params: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency,
      capture_method: 'automatic', // ✅ Cattura immediata dopo autorizzazione
      customer: stripeCustomerId || undefined,
      description: description,
      receipt_email: email || undefined,
      statement_descriptor_suffix: statementDescriptorSuffix,
      
      payment_method_types: ['card'],

      shipping: shipping,

      // ✅ METADATA COMPLETI PER ANTIFRODE STRIPE RADAR
      metadata: {
        session_id: sessionId,
        merchant_site: merchantSite,
        customer_email: email || "",
        customer_name: fullName || "",
        customer_phone: phone || "",           // ✅ Verifica telefono
        shipping_address: address1 || "",      // ✅ Verifica indirizzo
        shipping_city: city || "",             // ✅ Geo-matching
        shipping_postal_code: postalCode || "", // ✅ Verifica CAP
        shipping_country: countryCode,         // ✅ Match paese carta/spedizione
        order_id: orderNumber,
        first_item_title: randomProductTitle,
        stripe_account: activeAccount.label,
        stripe_account_order: String(activeAccount.order || 0),
        checkout_type: "custom",               // ✅ Tracking tipo checkout
        created_at: new Date().toISOString(),
      },
    }

    const paymentIntent = await stripe.paymentIntents.create(params)

    console.log(`[payment-intent] ✅ PI creato: ${paymentIntent.id} su ${activeAccount.label}`)

    // ✅ SALVA TUTTI I DATI IN FIREBASE
    await db.collection(COLLECTION).doc(sessionId).update({
      customer: {
        fullName,
        email,
        phone,
        address1,
        address2,
        city,
        postalCode,
        province,
        countryCode,
      },
      // ✅ DATI PER WEBHOOK SHOPIFY (evita che ordini non si creino):
      paymentIntentId: paymentIntent.id,
      items: data.items || [],
      subtotalCents: data.subtotalCents,
      shippingCents: 590,
      totalCents: amountCents,
      currency: currency.toUpperCase(),
      shopifyOrderNumber: orderNumber,
      stripeAccountUsed: activeAccount.label,
      stripeCustomerId: stripeCustomerId,
      updatedAt: new Date().toISOString(),
    })

    console.log(`[payment-intent] 💾 Tutti i dati salvati in Firebase`)

    // ✅ RITORNA PUBLISHABLE KEY DINAMICA
    return NextResponse.json(
      { 
        clientSecret: paymentIntent.client_secret,
        publishableKey: publishableKey,
        accountUsed: activeAccount.label,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error("[payment-intent] errore:", error)
    return NextResponse.json(
      { error: error?.message || "Errore interno" },
      { status: 500 }
    )
  }
}

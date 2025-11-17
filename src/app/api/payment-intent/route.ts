// src/app/api/payment-intent/route.ts
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { db } from "@/lib/firebaseAdmin"
import { getConfig } from "@/lib/config"

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

    const existingPaymentIntentId = data.paymentIntentId as string | undefined

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

    const cfg = await getConfig()

    const stripeAccounts = Array.isArray(cfg.stripeAccounts)
      ? cfg.stripeAccounts.filter((a: any) => a.secretKey)
      : []

    const firstStripe = stripeAccounts[0] || null
    const secretKey = firstStripe?.secretKey || process.env.STRIPE_SECRET_KEY || ""

    if (!secretKey) {
      console.error("[payment-intent] Nessuna Stripe secret key configurata")
      return NextResponse.json({ error: "Configurazione Stripe mancante" }, { status: 500 })
    }

    const merchantSite: string =
      firstStripe?.merchantSite ||
      cfg.checkoutDomain ||
      "https://notforresale.it"

    const descriptorRaw = firstStripe?.label || "NFR"
    const statementDescriptorSuffix =
      descriptorRaw.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 22) || "NFR"

    // ✅ FIX: Rimuovi apiVersion o usa versione corretta
    const stripe = new Stripe(secretKey)

    // ✅ CREA O OTTIENI CUSTOMER STRIPE
    let stripeCustomerId = data.stripeCustomerId as string | undefined

    if (!stripeCustomerId && email) {
      try {
        // Cerca se esiste già un customer con questa email
        const existingCustomers = await stripe.customers.list({
          email: email,
          limit: 1,
        })

        if (existingCustomers.data.length > 0) {
          stripeCustomerId = existingCustomers.data[0].id
          console.log(`[payment-intent] ✓ Customer esistente trovato: ${stripeCustomerId}`)
        } else {
          // Crea nuovo customer
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
            },
          })

          stripeCustomerId = customer.id
          console.log(`[payment-intent] ✓ Nuovo customer creato: ${stripeCustomerId}`)

          // Salva customer ID in Firestore
          await db.collection(COLLECTION).doc(sessionId).update({
            stripeCustomerId,
          })
        }
      } catch (customerError: any) {
        console.error("[payment-intent] Errore creazione customer:", customerError)
        // Continua senza customer ID
      }
    }

    const firstItemTitle =
      Array.isArray(data.items) && data.items[0]?.title
        ? String(data.items[0].title)
        : ""

    // ✅ DESCRIPTION COME CARTSHIELD: "orderNumber | customer name"
    const orderNumber = data.orderNumber || sessionId
    const description = `${orderNumber} | ${fullName || "Guest"}`

    // ✅ SHIPPING OBJECT COMPLETO
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

    let paymentIntent: Stripe.PaymentIntent

    if (existingPaymentIntentId) {
      // ✅ AGGIORNA PaymentIntent esistente
      console.log(
        `[payment-intent] Aggiornamento PI ${existingPaymentIntentId} con amount ${amountCents} (€${(amountCents / 100).toFixed(2)})`
      )

      const updateParams: Stripe.PaymentIntentUpdateParams = {
        amount: amountCents,
        customer: stripeCustomerId || undefined,
        description: description,
        receipt_email: email || undefined,
        shipping: shipping,
        metadata: {
          session_id: sessionId,
          merchant_site: merchantSite,
          customer_email: email || "",
          customer_name: fullName || "",
          order_id: orderNumber,
          first_item_title: firstItemTitle,
        },
      }

      paymentIntent = await stripe.paymentIntents.update(
        existingPaymentIntentId,
        updateParams
      )

      console.log(
        `[payment-intent] ✅ PaymentIntent aggiornato: ${paymentIntent.id} = €${(paymentIntent.amount / 100).toFixed(2)}`
      )
    } else {
      // ✅ CREA nuovo PaymentIntent
      console.log(
        `[payment-intent] Creazione nuovo PI con amount ${amountCents} (€${(amountCents / 100).toFixed(2)})`
      )

      const params: Stripe.PaymentIntentCreateParams = {
        amount: amountCents,
        currency,
        customer: stripeCustomerId || undefined,
        description: description,
        receipt_email: email || undefined,
        statement_descriptor_suffix: statementDescriptorSuffix,
        
        // ✅ AUTOMATIC PAYMENT METHODS (come CartShield)
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "always",
        },

        // ✅ SHIPPING
        shipping: shipping,

        // ✅ METADATA COMPLETO (come CartShield)
        metadata: {
          session_id: sessionId,
          merchant_site: merchantSite,
          customer_email: email || "",
          customer_name: fullName || "",
          order_id: orderNumber,
          first_item_title: firstItemTitle,
        },
      }

      paymentIntent = await stripe.paymentIntents.create(params)

      console.log(
        `[payment-intent] ✅ PaymentIntent creato: ${paymentIntent.id} = €${(paymentIntent.amount / 100).toFixed(2)}`
      )

      // Salva PaymentIntent ID in Firestore
      await db.collection(COLLECTION).doc(sessionId).update({
        paymentIntentId: paymentIntent.id,
        paymentIntentClientSecret: paymentIntent.client_secret,
        stripeAccountLabel: firstStripe?.label || null,
      })
    }

    // Salva dati cliente aggiornati
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
    })

    return NextResponse.json(
      { clientSecret: paymentIntent.client_secret },
      { status: 200 }
    )
  } catch (error: any) {
    console.error("[payment-intent] errore:", error)
    return NextResponse.json(
      { error: error?.message || "Errore interno nella creazione del pagamento" },
      { status: 500 }
    )
  }
}


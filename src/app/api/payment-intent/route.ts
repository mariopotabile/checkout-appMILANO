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

    // 🟦 Recupera account Stripe attivo
    const activeAccount = await getActiveStripeAccount()
    const secretKey = activeAccount.secretKey
    const publishableKey = activeAccount.publishableKey
    const merchantSite = activeAccount.merchantSite || "https://nfrcheckout.com"

    const descriptorRaw = activeAccount.label || "NFR"
    const statementDescriptorSuffix =
      `${descriptorRaw.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 18)} ORDER`.slice(
        0,
        22
      )

    // 🟦 Product title random (anti pattern frodi)
    const productTitles: string[] = []
    for (let i = 1; i <= 10; i++) {
      const key = `productTitle${i}` as keyof typeof activeAccount
      const title = activeAccount[key]
      if (title && typeof title === "string" && title.trim()) {
        productTitles.push(title.trim())
      }
    }
    const randomProductTitle =
      productTitles.length > 0
        ? productTitles[Math.floor(Math.random() * productTitles.length)]
        : "NFR Product"

    console.log(`[payment-intent] 🔄 Account attivo: ${activeAccount.label}`)

    // 🟦 Inizializza Stripe
    const stripe = new Stripe(secretKey, {
      apiVersion: "2025-10-29.clover",
    })

    // 🟦 CREA O OTTIENI CUSTOMER
    let stripeCustomerId = data.stripeCustomerId as string | undefined

    if (!stripeCustomerId && email) {
      try {
        const existingCustomers = await stripe.customers.list({
          email,
          limit: 1,
        })

        if (existingCustomers.data.length > 0) {
          stripeCustomerId = existingCustomers.data[0].id
        } else {
          const customer = await stripe.customers.create({
            email,
            name: fullName || undefined,
            phone: phone || undefined,
            address: address1
              ? {
                  line1: address1,
                  line2: address2 || undefined,
                  city: city || undefined,
                  postal_code: postalCode || undefined,
                  state: province || undefined,
                  country: countryCode || undefined,
                }
              : undefined,
            metadata: {
              merchant_site: merchantSite,
              session_id: sessionId,
              stripe_account: activeAccount.label,
            },
          })

          stripeCustomerId = customer.id

          await db.collection(COLLECTION).doc(sessionId).update({
            stripeCustomerId,
          })
        }
      } catch (customerError: any) {
        console.error("Customer error:", customerError)
      }
    }

    const orderNumber = data.orderNumber || sessionId
    const description = `${orderNumber} | ${fullName || "Guest"}`

    // 🟦 Shipping
    let shipping: Stripe.PaymentIntentCreateParams.Shipping | undefined
    if (fullName && address1 && city && postalCode) {
      shipping = {
        name: fullName,
        phone: phone || undefined,
        address: {
          line1: address1,
          line2: address2 || undefined,
          city,
          postal_code: postalCode,
          state: province,
          country: countryCode,
        },
      }
    }

    // 💥 ECCO LA PATCH 3D SECURE + ANTIFRODE (PUNTO 1)
    const params: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency,
      capture_method: "automatic",
      customer: stripeCustomerId || undefined,
      description,
      receipt_email: email || undefined,
      statement_descriptor_suffix: statementDescriptorSuffix,

      // 🔥 3️⃣ 3D SECURE FORZATO SEMPRE
      payment_method_types: ["card"],
      payment_method_options: {
        card: {
          request_three_d_secure: "any", // <----- FORZA 3DS SEMPRE
        },
      },

      // 📦 Shipping (usato da Radar)
      shipping,

      // 🔒 ANTIFRODE METADATA MASSIMI
      metadata: {
        session_id: sessionId,
        merchant_site: merchantSite,
        order_id: orderNumber,
        first_item_title: randomProductTitle,

        // 🧠 Dati cliente
        customer_email: email || "",
        customer_name: fullName || "",
        customer_phone: phone || "",

        // 📦 Address matching (importante per Radar)
        shipping_address: address1 || "",
        shipping_city: city || "",
        shipping_postal_code: postalCode || "",
        shipping_country: countryCode,

        // 🕵️‍♂️ Identificazione transazione
        stripe_account: activeAccount.label,
        stripe_account_order: String(activeAccount.order || 0),
        checkout_type: "custom",

        // 📅 Timestamp
        created_at: new Date().toISOString(),

        // 🔥 Dati antifrode aggiuntivi
        customer_ip:
          req.headers.get("x-forwarded-for") ||
          req.headers.get("x-real-ip") ||
          "",
        user_agent: req.headers.get("user-agent") || "",
      },
    }

    // 🟦 CREA PAYMENT INTENT
    const paymentIntent = await stripe.paymentIntents.create(params)

    // 🟦 SALVA IN FIREBASE
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

    return NextResponse.json(
      {
        clientSecret: paymentIntent.client_secret,
        publishableKey: publishableKey,
        accountUsed: activeAccount.label,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error("Errore:", error)
    return NextResponse.json(
      { error: error?.message || "Errore interno" },
      { status: 500 }
    )
  }
}

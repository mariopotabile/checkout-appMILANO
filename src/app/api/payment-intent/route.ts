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

    const activeAccount = await getActiveStripeAccount()
    const secretKey = activeAccount.secretKey
    const publishableKey = activeAccount.publishableKey
    const merchantSite = activeAccount.merchantSite || "https://nfrcheckout.com"

    const descriptorRaw = activeAccount.label || "NFR"
    const statementDescriptorSuffix =
      `${descriptorRaw.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 18)} ORDER`.slice(0, 22)

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

    const stripe = new Stripe(secretKey, {
      apiVersion: "2025-10-29.clover",
    })

    // ─── HELPER: crea o recupera Stripe Customer ─────────────────────────────
    async function getOrCreateCustomer(
      existingCustomerId: string | undefined
    ): Promise<string | undefined> {
      if (existingCustomerId) return existingCustomerId
      if (!email) return undefined

      try {
        const existingCustomers = await stripe.customers.list({ email, limit: 1 })
        if (existingCustomers.data.length > 0) {
          return existingCustomers.data[0].id
        }

        const createParams: Stripe.CustomerCreateParams = {
          email,
          ...(fullName    && { name: fullName }),
          ...(phone       && { phone }),
          ...(address1    && {
            address: {
              line1: address1,
              ...(address2    && { line2: address2 }),
              ...(city        && { city }),
              ...(postalCode  && { postal_code: postalCode }),
              ...(province    && { state: province }),
              ...(countryCode && { country: countryCode }),
            },
          }),
          metadata: {
            merchant_site: merchantSite,
            session_id: sessionId as string,
            stripe_account: activeAccount.label,
          },
        }

        const newCustomer = await stripe.customers.create(createParams)
        return newCustomer.id
      } catch (customerError: any) {
        console.error("[payment-intent] Customer error:", customerError)
        return undefined
      }
    }

    // ─── PATH 1: cancella PI esistente se non ancora pagato ──────────────────
    const existingPaymentIntentId = data.paymentIntentId as string | undefined

    if (existingPaymentIntentId) {
      try {
        const existingIntent = await stripe.paymentIntents.retrieve(existingPaymentIntentId)

        if (
          existingIntent.status === "succeeded" ||
          existingIntent.status === "processing"
        ) {
          return NextResponse.json(
            { error: "Pagamento già completato per questa sessione" },
            { status: 400 }
          )
        }

        if (
          existingIntent.status === "requires_payment_method" ||
          existingIntent.status === "requires_confirmation" ||
          existingIntent.status === "requires_action"
        ) {
          await stripe.paymentIntents.cancel(existingPaymentIntentId)
          console.log(`[payment-intent] 🗑️ PI vecchio cancellato: ${existingPaymentIntentId}`)
        }
      } catch (err: any) {
        console.log(`[payment-intent] ⚠️ PI vecchio non trovato, procedo`)
      }
    }

    // ─── PATH 2: Crea sempre un nuovo PaymentIntent ───────────────────────────
    const stripeCustomerId = await getOrCreateCustomer(
      data.stripeCustomerId as string | undefined
    )

    const orderNumber = data.orderNumber || sessionId
    const description = `${orderNumber} | ${fullName || "Guest"}`

    let shipping: Stripe.PaymentIntentCreateParams.Shipping | undefined
    if (fullName && address1 && city && postalCode) {
      shipping = {
        name: fullName,
        ...(phone && { phone }),
        address: {
          line1: address1,
          ...(address2    && { line2: address2 }),
          city,
          postal_code: postalCode,
          state: province,
          country: countryCode,
        },
      }
    }

    const params: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency,
      capture_method: "automatic",
      ...(stripeCustomerId && { customer: stripeCustomerId }),
      description,
      ...(email && { receipt_email: email }),
      statement_descriptor_suffix: statementDescriptorSuffix,
      payment_method_types: ["card"],
      payment_method_options: {
        card: {
          request_three_d_secure: "automatic",
        },
      },
      setup_future_usage: "off_session",
      ...(shipping && { shipping }),
      metadata: {
        session_id: sessionId,
        merchant_site: merchantSite,
        order_id: orderNumber,
        first_item_title: randomProductTitle,
        customer_email: email || "",
        customer_name: fullName || "",
        customer_phone: phone || "",
        shipping_address: address1 || "",
        shipping_city: city || "",
        shipping_postal_code: postalCode || "",
        shipping_country: countryCode,
        stripe_account: activeAccount.label,
        stripe_account_order: String(activeAccount.order || 0),
        checkout_type: "custom",
        created_at: new Date().toISOString(),
        customer_ip:
          req.headers.get("x-forwarded-for") ||
          req.headers.get("x-real-ip") ||
          "",
        user_agent: req.headers.get("user-agent") || "",
      },
    }

    const paymentIntent = await stripe.paymentIntents.create(params)
    console.log(`[payment-intent] ✅ PI creato: ${paymentIntent.id}`)

    // ─── SetupIntent per mandate MIT (upsell off-session) ────────────────────
    // Creato in parallelo, non blocca il flusso se fallisce
    

    // ─── Salva su Firestore ───────────────────────────────────────────────────
    const updateData: Record<string, any> = {
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
      shippingCents: 0,
      totalCents: amountCents,
      currency: currency.toUpperCase(),
      shopifyOrderNumber: orderNumber,
      stripeAccountUsed: activeAccount.label,
      updatedAt: new Date().toISOString(),
    }

    if (stripeCustomerId) {
      updateData.stripeCustomerId = stripeCustomerId
    }

    await db.collection(COLLECTION).doc(sessionId).update(updateData)
    console.log(
      `[payment-intent] ✅ Dati salvati: ${fullName} (${email}) | customer: ${stripeCustomerId || "n/a"}`
    )

    return NextResponse.json(
      {
        clientSecret: paymentIntent.client_secret,
        publishableKey,
        accountUsed: activeAccount.label,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error("[payment-intent] Errore:", error)
    return NextResponse.json(
      { error: error?.message || "Errore interno" },
      { status: 500 }
    )
  }
}
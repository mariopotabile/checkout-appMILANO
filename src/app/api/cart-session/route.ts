// src/app/api/cart-session/route.ts
import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import Stripe from "stripe"
import { db } from "@/lib/firebaseAdmin"
import { getConfig } from "@/lib/config"

const COLLECTION = "cartSessions"

type ShopifyCartItem = {
  id: number | string
  title: string
  quantity: number
  price: number
  line_price?: number
  image?: string
  variant_title?: string
  token?: string
}

type ShopifyCart = {
  items?: ShopifyCartItem[]
  items_subtotal_price?: number
  total_price?: number
  currency?: string
  token?: string
  attributes?: Record<string, any>
}


type UtmData = {
  first_source?: string
  first_medium?: string
  first_campaign?: string
  first_content?: string
  first_term?: string
  first_referrer?: string
  first_landing?: string
  first_fbclid?: string
  first_gclid?: string
  first_ttclid?: string
  first_msclkid?: string
  first_campaign_id?: string
  first_adset_id?: string
  first_adset_name?: string
  first_ad_id?: string
  first_ad_name?: string
  last_source?: string
  last_medium?: string
  last_campaign?: string
  last_content?: string
  last_term?: string
  last_referrer?: string
  last_landing?: string
  last_fbclid?: string
  last_gclid?: string
  last_ttclid?: string
  last_msclkid?: string
  last_campaign_id?: string
  last_adset_id?: string
  last_adset_name?: string
  last_ad_id?: string
  last_ad_name?: string
  fbp?: string
  fbc?: string
  ttp?: string
  obj_campaign?: Record<string, string>
}

type CheckoutItem = {
  id: string | number
  title: string
  quantity: number
  priceCents: number
  linePriceCents: number
  image?: string
  variantTitle?: string
}

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin")
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  })
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin")
    const body = await req.json().catch(() => null)

    if (!body || !body.cart) {
      return new NextResponse(
        JSON.stringify({ error: "Body non valido o cart mancante" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      )
    }

    const cart: ShopifyCart = body.cart

    const items: CheckoutItem[] = Array.isArray(cart.items)
      ? cart.items.map(item => {
          const quantity = Number(item.quantity ?? 0)
          const priceCents = Number(item.price ?? 0)
          const linePriceCents =
            typeof item.line_price === "number"
              ? item.line_price
              : priceCents * quantity

          return {
            id: item.id,
            title: item.title,
            quantity,
            priceCents,
            linePriceCents,
            image: item.image,
            variantTitle: item.variant_title,
          }
        })
      : []

    const subtotalFromCart =
      typeof cart.items_subtotal_price === "number"
        ? cart.items_subtotal_price
        : 0

    const subtotalFromItems = items.reduce((sum, item) => {
      return sum + (item.linePriceCents || 0)
    }, 0)

    const subtotalCents =
      subtotalFromCart && subtotalFromCart > 0
        ? subtotalFromCart
        : subtotalFromItems

    const shippingCents = 0

    const totalCents =
      typeof cart.total_price === "number" && cart.total_price > 0
        ? cart.total_price
        : subtotalCents + shippingCents

    const currency = (cart.currency || "EUR").toString().toUpperCase()
    const sessionId = randomUUID()

    const cfg = await getConfig()
    const firstStripe =
      (cfg.stripeAccounts || []).find((a: any) => a.secretKey) || null
    const secretKey =
      firstStripe?.secretKey || process.env.STRIPE_SECRET_KEY || ""

    if (!secretKey) {
      console.error("[cart-session POST] Nessuna Stripe secret key configurata")
      return new NextResponse(
        JSON.stringify({ error: "Configurazione Stripe mancante" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      )
    }

    const stripe = new Stripe(secretKey)

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: currency.toLowerCase(),
      payment_method_types: ["card"],
      metadata: {
        sessionId,
      },
    })

    // ✅ Costruisci cartId da token
    const cartId = cart.token ? `gid://shopify/Cart/${cart.token}` : undefined

    // ✅ UTM: priorità a body.utm (da localStorage, sempre aggiornato)
    // fallback a cart.attributes (scritti dal tracker con delay)
    const utmFromFrontend = (body.utm || null) as UtmData | null
    const cartAttributes  = cart.attributes || {}

    // Mappa gli UTM dal frontend nel formato _wt_* per compatibilità
    // con il tracker v3.2 e la thank-you page
    const utmAttributes: Record<string, string> = {}
    if (utmFromFrontend) {
      const set = (key: string, val?: string) => { if (val) utmAttributes[key] = val }
      set("_wt_first_source",      utmFromFrontend.first_source)
      set("_wt_first_medium",      utmFromFrontend.first_medium)
      set("_wt_first_campaign",    utmFromFrontend.first_campaign)
      set("_wt_first_content",     utmFromFrontend.first_content)
      set("_wt_first_term",        utmFromFrontend.first_term)
      set("_wt_first_referrer",    utmFromFrontend.first_referrer)
      set("_wt_first_landing",     utmFromFrontend.first_landing)
      set("_wt_first_fbclid",      utmFromFrontend.first_fbclid)
      set("_wt_first_gclid",       utmFromFrontend.first_gclid)
      set("_wt_first_ttclid",      utmFromFrontend.first_ttclid)
      set("_wt_first_msclkid",     utmFromFrontend.first_msclkid)
      set("_wt_first_campaign_id", utmFromFrontend.first_campaign_id)
      set("_wt_first_adset_id",    utmFromFrontend.first_adset_id)
      set("_wt_first_adset_name",  utmFromFrontend.first_adset_name)
      set("_wt_first_ad_id",       utmFromFrontend.first_ad_id)
      set("_wt_first_ad_name",     utmFromFrontend.first_ad_name)
      set("_wt_last_source",       utmFromFrontend.last_source)
      set("_wt_last_medium",       utmFromFrontend.last_medium)
      set("_wt_last_campaign",     utmFromFrontend.last_campaign)
      set("_wt_last_content",      utmFromFrontend.last_content)
      set("_wt_last_term",         utmFromFrontend.last_term)
      set("_wt_last_referrer",     utmFromFrontend.last_referrer)
      set("_wt_last_landing",      utmFromFrontend.last_landing)
      set("_wt_last_fbclid",       utmFromFrontend.last_fbclid)
      set("_wt_last_gclid",        utmFromFrontend.last_gclid)
      set("_wt_last_ttclid",       utmFromFrontend.last_ttclid)
      set("_wt_last_msclkid",      utmFromFrontend.last_msclkid)
      set("_wt_last_campaign_id",  utmFromFrontend.last_campaign_id)
      set("_wt_last_adset_id",     utmFromFrontend.last_adset_id)
      set("_wt_last_adset_name",   utmFromFrontend.last_adset_name)
      set("_wt_last_ad_id",        utmFromFrontend.last_ad_id)
      set("_wt_last_ad_name",      utmFromFrontend.last_ad_name)
      set("_wt_fbp",               utmFromFrontend.fbp)
      set("_wt_fbc",               utmFromFrontend.fbc)
      set("_wt_ttp",               utmFromFrontend.ttp)
      if (utmFromFrontend.obj_campaign) {
        utmAttributes["obj_campaign"] = JSON.stringify(utmFromFrontend.obj_campaign)
        utmAttributes["logs"]         = JSON.stringify([utmFromFrontend.obj_campaign])
      }
    }

    // Merge: cart.attributes (base) + utmAttributes (sovrascrive con dati freschi)
    const mergedAttributes = {
      ...cartAttributes,
      ...utmAttributes,
    }

    const docData = {
      sessionId,
      createdAt: new Date().toISOString(),
      currency,
      items,
      subtotalCents,
      shippingCents,
      totalCents,
      paymentIntentId: paymentIntent.id,
      paymentIntentClientSecret: paymentIntent.client_secret,
      rawCart: {
        ...cart,
        id: cartId,
        attributes: mergedAttributes,  // ✅ UTM frontend + cart attributes merged
      },
      utm: utmFromFrontend,            // ✅ Salva anche oggetto utm strutturato
      customer: body.customer || null,
      shopDomain: body.shop_domain || null,
      discountCode: body.discount_code || null,
    }

    await db.collection(COLLECTION).doc(sessionId).set(docData)

    return new NextResponse(
      JSON.stringify({
        sessionId,
        currency,
        items,
        subtotalCents,
        shippingCents,
        totalCents,
        paymentIntentClientSecret: paymentIntent.client_secret,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      },
    )
  } catch (err) {
    console.error("[cart-session POST] errore:", err)
    return new NextResponse(
      JSON.stringify({
        error: "Errore interno creazione sessione carrello",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(null),
        },
      },
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const origin = req.headers.get("origin")
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get("sessionId")

    if (!sessionId) {
      return new NextResponse(
        JSON.stringify({ error: "sessionId mancante" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      )
    }

    const snap = await db.collection(COLLECTION).doc(sessionId).get()

    if (!snap.exists) {
      return new NextResponse(
        JSON.stringify({ error: "Nessun carrello trovato" }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        },
      )
    }

    const data = snap.data() || {}

    const currency = (data.currency || "EUR").toString().toUpperCase()
    const items = Array.isArray(data.items) ? data.items : []

    const subtotalCents =
      typeof data.subtotalCents === "number"
        ? data.subtotalCents
        : typeof data.totals?.subtotal === "number"
        ? data.totals.subtotal
        : 0

    const shippingCents =
      typeof data.shippingCents === "number" ? data.shippingCents : 0

    const totalCents =
      typeof data.totalCents === "number"
        ? data.totalCents
        : subtotalCents + shippingCents

    return new NextResponse(
      JSON.stringify({
        sessionId,
        currency,
        items,
        subtotalCents,
        shippingCents,
        totalCents,
        paymentIntentClientSecret: data.paymentIntentClientSecret || null,
        rawCart: data.rawCart || null,
        shopifyOrderNumber: data.shopifyOrderNumber,
        shopifyOrderId: data.shopifyOrderId,
        customer: data.customer,
        shopDomain: data.shopDomain,
        attributes: data.rawCart?.attributes || {},
        utm: data.utm || null, // ✅ Oggetto UTM strutturato
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      },
    )
  } catch (err) {
    console.error("[cart-session GET] errore:", err)
    return new NextResponse(
      JSON.stringify({
        error: "Errore interno lettura sessione carrello",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(null),
        },
      },
    )
  }
}

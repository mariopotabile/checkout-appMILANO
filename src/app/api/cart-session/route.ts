// src/app/api/cart-session/route.ts
import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { db } from "@/lib/firebaseAdmin"

const ALLOWED_ORIGIN = process.env.SHOPIFY_STORE_ORIGIN || "*"

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.headers.set("Access-Control-Allow-Headers", "Content-Type")
  res.headers.set("Access-Control-Allow-Credentials", "true")
  return res
}

// Preflight CORS (per la chiamata da Shopify al POST)
export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 200 }))
}

// 🔹 POST: chiamato dal tema Shopify con il carrello (/cart.js)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const cart = body.cart

    if (!cart || !Array.isArray(cart.items)) {
      console.error("[cart-session] Cart non valido o items mancanti:", body)
      return withCors(
        NextResponse.json(
          { error: "Cart non valido ricevuto da Shopify" },
          { status: 400 }
        )
      )
    }

    const items = cart.items.map((item: any) => ({
      id: item.id,
      product_id: item.product_id,
      variant_id: item.variant_id,
      title: item.product_title || item.title,
      variant_title: item.variant_title,
      quantity: item.quantity,
      price: item.price, // centesimi
      line_price: item.line_price,
      image: item.image,
      sku: item.sku,
    }))

    const currency =
      cart.currency || cart.currency_code || cart.currencyCode || "EUR"

    const subtotal =
      typeof cart.items_subtotal_price === "number"
        ? cart.items_subtotal_price
        : items.reduce(
            (sum: number, it: any) => sum + (it.line_price || 0),
            0
          )

    const sessionId = randomUUID()

    await db.collection("checkoutSessions").doc(sessionId).set({
      items,
      currency,
      subtotal,
      createdAt: new Date().toISOString(),
      rawCart: cart,
    })

    console.log("[cart-session] Sessione creata:", sessionId, {
      itemsCount: items.length,
      subtotal,
      currency,
    })

    return withCors(
      NextResponse.json(
        {
          sessionId,
        },
        { status: 200 }
      )
    )
  } catch (err) {
    console.error("[cart-session] Errore interno POST:", err)
    return withCors(
      NextResponse.json(
        { error: "Errore interno nel checkout" },
        { status: 500 }
      )
    )
  }
}

// 🔹 GET: chiamato dalla pagina /checkout per recuperare i dati del carrello
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get("sessionId")

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId mancante" },
        { status: 400 }
      )
    }

    const snap = await db.collection("checkoutSessions").doc(sessionId).get()

    if (!snap.exists) {
      return NextResponse.json(
        { error: "Sessione checkout non trovata" },
        { status: 404 }
      )
    }

    const data = snap.data() || {}

    return NextResponse.json(
      {
        sessionId,
        items: data.items || [],
        currency: data.currency || "EUR",
        subtotal: data.subtotal || 0,
      },
      { status: 200 }
    )
  } catch (err) {
    console.error("[cart-session] Errore interno GET:", err)
    return NextResponse.json(
      { error: "Errore nel recupero della sessione checkout" },
      { status: 500 }
    )
  }
}
// src/app/api/calculate-shipping/route.ts
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/firebaseAdmin"
import { getConfig } from "@/lib/config"
import { getShopifyAccessToken } from "@/lib/shopifyAuth"

const COLLECTION = "cartSessions"

type Destination = {
  city: string
  province: string
  postalCode: string
  countryCode: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const sessionId = body?.sessionId as string | undefined
    const destination = body?.destination as Destination | undefined

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId mancante" }, { status: 400 })
    }

    if (!destination || !destination.countryCode) {
      return NextResponse.json({ error: "Dati destinazione mancanti" }, { status: 400 })
    }

    const snap = await db.collection(COLLECTION).doc(sessionId).get()

    if (!snap.exists) {
      return NextResponse.json({ error: "Sessione carrello non trovata" }, { status: 404 })
    }

    const data: any = snap.data() || {}

    console.log("[calculate-shipping] Sessione:", {
      sessionId,
      hasRawCart: !!data.rawCart,
      hasItems: !!data.items,
      itemsCount: data.rawCart?.items?.length || data.items?.length,
    })

    let cartItems: any[] = []

    if (Array.isArray(data.rawCart?.items) && data.rawCart.items.length > 0) {
      cartItems = data.rawCart.items
      console.log("[calculate-shipping] ✓ Usando rawCart.items")
    } else if (Array.isArray(data.items) && data.items.length > 0) {
      cartItems = data.items
      console.log("[calculate-shipping] ✓ Usando items array")
    }

    if (cartItems.length === 0) {
      console.error("[calculate-shipping] ✗ Carrello vuoto")
      return NextResponse.json({ error: "Carrello vuoto" }, { status: 400 })
    }

    const cfg = await getConfig()
    const shopifyDomain = cfg.shopify.shopDomain
    
    // ✅ USA IL NUOVO SISTEMA OAUTH CON PARAMETRI
    const adminToken = await getShopifyAccessToken(
      cfg.shopify.clientId,
      cfg.shopify.clientSecret,
      cfg.shopify.shopDomain
    )

    if (!shopifyDomain || !adminToken) {
      console.error("[calculate-shipping] ✗ Config mancante")
      return NextResponse.json({ error: "Configurazione Shopify mancante" }, { status: 500 })
    }

    console.log(`[calculate-shipping] → Calcolo spedizione per ${destination.city}, ${destination.countryCode}`)

    const shippingRates = await calculateShippingWithAdmin({
      shopifyDomain,
      adminToken,
      cartItems,
      destination,
    })

    if (!shippingRates || shippingRates.length === 0) {
      console.warn("[calculate-shipping] ⚠ Nessuna tariffa da Shopify, uso fallback")
      
      const fallbackShippingCents = getFallbackShipping(destination.countryCode)
      
      await db.collection(COLLECTION).doc(sessionId).update({
        shippingCents: fallbackShippingCents,
        shippingDestination: destination,
        shippingCalculatedAt: new Date().toISOString(),
        shippingMethod: "Spedizione Standard",
      })

      return NextResponse.json({
        shippingCents: fallbackShippingCents,
        destination,
        method: "Spedizione Standard",
        currency: "EUR",
      })
    }

    shippingRates.sort((a: any, b: any) => parseFloat(a.price) - parseFloat(b.price))

    const selectedRate = shippingRates[0]
    const shippingCents = Math.round(parseFloat(selectedRate.price) * 100)

    console.log(`[calculate-shipping] ✅ ${selectedRate.title} = €${(shippingCents / 100).toFixed(2)}`)

    await db.collection(COLLECTION).doc(sessionId).update({
      shippingCents,
      shippingDestination: destination,
      shippingCalculatedAt: new Date().toISOString(),
      shippingMethod: selectedRate.title,
      shippingHandle: selectedRate.handle,
      availableShippingRates: shippingRates.map((rate: any) => ({
        title: rate.title,
        handle: rate.handle,
        priceCents: Math.round(parseFloat(rate.price) * 100),
      })),
    })

    return NextResponse.json({
      shippingCents,
      destination,
      method: selectedRate.title,
      handle: selectedRate.handle,
      currency: "EUR",
      availableRates: shippingRates.map((rate: any) => ({
        title: rate.title,
        handle: rate.handle,
        priceCents: Math.round(parseFloat(rate.price) * 100),
      })),
    })
  } catch (error: any) {
    console.error("[calculate-shipping] ✗ Errore:", error)
    return NextResponse.json(
      { error: error?.message || "Errore calcolo spedizione" },
      { status: 500 }
    )
  }
}

async function calculateShippingWithAdmin({
  shopifyDomain,
  adminToken,
  cartItems,
  destination,
}: {
  shopifyDomain: string
  adminToken: string
  cartItems: any[]
  destination: Destination
}) {
  let draftOrderId: number | null = null

  try {
    // Prepara line items
    const lineItems = cartItems.map((item: any) => {
      const variantId = item.variant_id || item.id
      
      if (!variantId) {
        console.error("[calculateShippingWithAdmin] Item senza variant_id:", item)
        return null
      }

      // Pulisci variant_id (rimuovi gid:// se presente)
      let cleanVariantId = variantId
      if (typeof variantId === "string" && variantId.startsWith("gid://")) {
        cleanVariantId = variantId.split("/").pop()
      }

      return {
        variant_id: cleanVariantId,
        quantity: item.quantity || 1,
      }
    }).filter(Boolean)

    if (lineItems.length === 0) {
      throw new Error("Nessun line item valido trovato")
    }

    console.log(`[calculateShippingWithAdmin] → Creazione draft order con ${lineItems.length} prodotti`)

    // 1. CREA DRAFT ORDER
    const createResponse = await fetch(
      `https://${shopifyDomain}/admin/api/2024-10/draft_orders.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
        body: JSON.stringify({
          draft_order: {
            line_items: lineItems,
            shipping_address: {
              address1: " ",
              city: destination.city || " ",
              province: destination.province || undefined,
              country_code: destination.countryCode || "IT",
              zip: destination.postalCode || undefined,
            },
            use_customer_default_address: false,
          },
        }),
      }
    )

    if (!createResponse.ok) {
      const errorText = await createResponse.text()
      console.error("[calculateShippingWithAdmin] ✗ Errore creazione draft order:", createResponse.status)
      console.error("Dettagli:", errorText)
      throw new Error(`Errore creazione draft order: ${createResponse.status}`)
    }

    const draftOrderResult = await createResponse.json()

    if (!draftOrderResult.draft_order?.id) {
      console.error("[calculateShippingWithAdmin] ✗ Draft order non creato")
      return null
    }

    draftOrderId = draftOrderResult.draft_order.id
    console.log(`[calculateShippingWithAdmin] ✓ Draft order creato: ${draftOrderId}`)

    // 2. OTTIENI SHIPPING RATES
    const ratesResponse = await fetch(
      `https://${shopifyDomain}/admin/api/2024-10/draft_orders/${draftOrderId}/shipping_rates.json`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
      }
    )

    if (!ratesResponse.ok) {
      const errorText = await ratesResponse.text()
      console.error("[calculateShippingWithAdmin] ✗ Errore recupero shipping rates:", ratesResponse.status)
      console.error("Dettagli:", errorText)
      throw new Error(`Errore recupero shipping rates: ${ratesResponse.status}`)
    }

    const ratesResult = await ratesResponse.json()
    const shippingRates = ratesResult.shipping_rates || []

    console.log(
      `[calculateShippingWithAdmin] ✓ Trovate ${shippingRates.length} tariffe:`,
      shippingRates.map((r: any) => `${r.title}: €${r.price}`)
    )

    // 3. ELIMINA DRAFT ORDER (pulizia)
    if (draftOrderId) {
      await fetch(
        `https://${shopifyDomain}/admin/api/2024-10/draft_orders/${draftOrderId}.json`,
        {
          method: "DELETE",
          headers: { "X-Shopify-Access-Token": adminToken },
        }
      )
      console.log(`[calculateShippingWithAdmin] ✓ Draft order ${draftOrderId} eliminato`)
    }

    if (shippingRates.length === 0) {
      console.warn("[calculateShippingWithAdmin] ⚠ Nessuna shipping rate disponibile")
      return null
    }

    return shippingRates.map((rate: any) => ({
      handle: rate.handle || rate.id || "standard",
      title: rate.title || "Spedizione Standard",
      price: rate.price || "0.00",
    }))
  } catch (error: any) {
    console.error("[calculateShippingWithAdmin] ✗ Errore:", error)
    
    // Cleanup: elimina draft order se esiste
    if (draftOrderId) {
      try {
        await fetch(
          `https://${shopifyDomain}/admin/api/2024-10/draft_orders/${draftOrderId}.json`,
          {
            method: "DELETE",
            headers: { "X-Shopify-Access-Token": adminToken },
          }
        )
        console.log(`[calculateShippingWithAdmin] ✓ Draft order ${draftOrderId} eliminato (cleanup)`)
      } catch (cleanupError) {
        console.error("[calculateShippingWithAdmin] ✗ Errore cleanup:", cleanupError)
      }
    }
    
    throw error
  }
}

function getFallbackShipping(countryCode: string): number {
  const country = countryCode.toUpperCase()
  
  console.log(`[getFallbackShipping] Calcolo fallback per ${country}`)
  
  if (country === "IT") {
    return 500 // 5€
  } else if (["FR", "DE", "ES", "AT", "BE", "NL", "PT", "IE", "LU"].includes(country)) {
    return 1000 // 10€
  } else if (["GB", "CH", "NO", "SE", "DK", "FI", "PL", "CZ", "HU"].includes(country)) {
    return 1500 // 15€
  } else {
    return 2000 // 20€
  }
}

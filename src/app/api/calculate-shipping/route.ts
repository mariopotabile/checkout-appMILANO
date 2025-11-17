// src/app/api/calculate-shipping/route.ts
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/firebaseAdmin"
import { getConfig } from "@/lib/config"

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

    console.log("[calculate-shipping] Struttura sessione:", {
      sessionId,
      hasRawCart: !!data.rawCart,
      hasRawCartItems: !!data.rawCart?.items,
      rawCartItemsCount: data.rawCart?.items?.length,
      hasItems: !!data.items,
      itemsCount: data.items?.length,
    })

    // ESTRAI GLI ITEMS DAL CARRELLO
    let cartItems: any[] = []

    // Il tuo carrello ha rawCart.items come array diretto
    if (Array.isArray(data.rawCart?.items) && data.rawCart.items.length > 0) {
      cartItems = data.rawCart.items
      console.log("[calculate-shipping] Usando rawCart.items (array diretto)")
    }
    // Fallback: usa items array top-level
    else if (Array.isArray(data.items) && data.items.length > 0) {
      cartItems = data.items
      console.log("[calculate-shipping] Usando items array (top-level)")
    }

    if (cartItems.length === 0) {
      console.error("[calculate-shipping] Nessun item trovato nel carrello")
      return NextResponse.json({ error: "Carrello vuoto" }, { status: 400 })
    }

    console.log(`[calculate-shipping] Trovati ${cartItems.length} items nel carrello`)

    const cfg = await getConfig()
    const shopifyDomain = cfg.shopify.shopDomain
    const storefrontToken = cfg.shopify.storefrontToken

    if (!shopifyDomain || !storefrontToken) {
      console.error("[calculate-shipping] Config Shopify mancante")
      return NextResponse.json({ error: "Configurazione Shopify mancante" }, { status: 500 })
    }

    console.log(`[calculate-shipping] Calcolo spedizione per ${destination.city}, ${destination.countryCode}`)

    const shippingRates = await getShopifyShippingRates({
      shopifyDomain,
      storefrontToken,
      cartItems, // Passa gli items diretti
      destination,
    })

    if (!shippingRates || shippingRates.length === 0) {
      console.warn("[calculate-shipping] Nessuna tariffa trovata")
      return NextResponse.json(
        { error: "Nessuna tariffa di spedizione disponibile per questa destinazione" },
        { status: 404 }
      )
    }

    shippingRates.sort((a: any, b: any) => parseFloat(a.price.amount) - parseFloat(b.price.amount))

    const selectedRate = shippingRates[0]
    const shippingCents = Math.round(parseFloat(selectedRate.price.amount) * 100)

    console.log(`[calculate-shipping] ✅ Tariffa: ${selectedRate.title} = €${(shippingCents / 100).toFixed(2)}`)

    await db.collection(COLLECTION).doc(sessionId).update({
      shippingCents,
      shippingDestination: destination,
      shippingCalculatedAt: new Date().toISOString(),
      shippingMethod: selectedRate.title,
      shippingHandle: selectedRate.handle,
      availableShippingRates: shippingRates.map((rate: any) => ({
        title: rate.title,
        handle: rate.handle,
        priceCents: Math.round(parseFloat(rate.price.amount) * 100),
        currency: rate.price.currencyCode,
      })),
    })

    return NextResponse.json({
      shippingCents,
      destination,
      method: selectedRate.title,
      handle: selectedRate.handle,
      currency: selectedRate.price.currencyCode,
      availableRates: shippingRates.map((rate: any) => ({
        title: rate.title,
        handle: rate.handle,
        priceCents: Math.round(parseFloat(rate.price.amount) * 100),
        currency: rate.price.currencyCode,
      })),
    })
  } catch (error: any) {
    console.error("[calculate-shipping] errore:", error)
    return NextResponse.json(
      { error: error?.message || "Errore calcolo spedizione" },
      { status: 500 }
    )
  }
}

async function getShopifyShippingRates({
  shopifyDomain,
  storefrontToken,
  cartItems,
  destination,
}: {
  shopifyDomain: string
  storefrontToken: string
  cartItems: any[]
  destination: Destination
}) {
  try {
    // Converti items nel formato GraphQL lineItems
    const lineItems = cartItems.map((item: any) => {
      // Il tuo carrello ha variant_id come numero
      const variantId = item.variant_id || item.id

      if (!variantId) {
        console.error("[getShopifyShippingRates] Item senza variant_id:", item)
        return null
      }

      // Converti in formato GID se necessario
      let gid = variantId
      if (typeof variantId === "number" || !variantId.toString().startsWith("gid://")) {
        gid = `gid://shopify/ProductVariant/${variantId}`
      }

      const quantity = item.quantity || 1

      console.log("[getShopifyShippingRates] Line item:", { gid, quantity })

      return {
        variantId: gid,
        quantity,
      }
    }).filter(Boolean) // Rimuovi eventuali null

    if (lineItems.length === 0) {
      throw new Error("Nessun variantId valido trovato negli items")
    }

    console.log(`[getShopifyShippingRates] Creazione checkout con ${lineItems.length} prodotti`)

    const mutation = `
      mutation checkoutCreate($input: CheckoutCreateInput!) {
        checkoutCreate(input: $input) {
          checkout {
            id
            webUrl
            availableShippingRates {
              ready
              shippingRates {
                handle
                title
                priceV2 {
                  amount
                  currencyCode
                }
              }
            }
          }
          checkoutUserErrors {
            message
            field
            code
          }
        }
      }
    `

    const variables = {
      input: {
        lineItems,
        shippingAddress: {
          address1: " ",
          city: destination.city || " ",
          province: destination.province || undefined,
          country: destination.countryCode || "IT",
          zip: destination.postalCode || undefined,
        },
      },
    }

    console.log("[getShopifyShippingRates] GraphQL variables:", JSON.stringify(variables, null, 2))

    const response = await fetch(
      `https://${shopifyDomain}/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": storefrontToken,
        },
        body: JSON.stringify({ query: mutation, variables }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[getShopifyShippingRates] HTTP error:", response.status, errorText)
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const result = await response.json()

    if (result.errors) {
      console.error("[getShopifyShippingRates] GraphQL errors:", JSON.stringify(result.errors, null, 2))
      throw new Error(result.errors[0]?.message || "Errore GraphQL")
    }

    const checkoutUserErrors = result.data?.checkoutCreate?.checkoutUserErrors
    if (checkoutUserErrors && checkoutUserErrors.length > 0) {
      console.error("[getShopifyShippingRates] Checkout errors:", JSON.stringify(checkoutUserErrors, null, 2))
      throw new Error(checkoutUserErrors[0]?.message || "Errore creazione checkout")
    }

    const checkout = result.data?.checkoutCreate?.checkout
    if (!checkout) {
      console.error("[getShopifyShippingRates] Nessun checkout creato")
      return null
    }

    console.log(`[getShopifyShippingRates] Checkout creato: ${checkout.id}`)

    const availableShippingRates = checkout.availableShippingRates
    if (!availableShippingRates?.ready) {
      console.warn("[getShopifyShippingRates] ⚠️ Tariffe non pronte")
      return null
    }

    const shippingRates = availableShippingRates.shippingRates || []

    console.log(
      `[getShopifyShippingRates] ✅ ${shippingRates.length} tariffe:`,
      shippingRates.map((r: any) => `${r.title}: ${r.priceV2?.amount} ${r.priceV2?.currencyCode}`)
    )

    return shippingRates.map((rate: any) => ({
      handle: rate.handle,
      title: rate.title,
      price: {
        amount: rate.priceV2?.amount || rate.price?.amount || "0",
        currencyCode: rate.priceV2?.currencyCode || rate.price?.currencyCode || "EUR",
      },
    }))
  } catch (error: any) {
    console.error("[getShopifyShippingRates] errore:", error)
    throw error
  }
}


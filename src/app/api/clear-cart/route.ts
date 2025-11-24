// src/app/api/clear-cart/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getConfig } from "@/lib/config"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { cartId } = body

    if (!cartId) {
      return NextResponse.json({ error: "cartId mancante" }, { status: 400 })
    }

    console.log(`[clear-cart] 🧹 Svuotamento carrello Shopify: ${cartId}`)

    const config = await getConfig()
    const shopifyDomain = config.shopify?.shopDomain
    const storefrontToken = config.shopify?.storefrontToken

    if (!shopifyDomain || !storefrontToken) {
      console.error("[clear-cart] ❌ Config Shopify mancante")
      return NextResponse.json({ error: "Config mancante" }, { status: 500 })
    }

    // STEP 1: Ottieni ID linee carrello
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
      console.error("[clear-cart] ❌ Errore GraphQL:", cartData.errors)
      return NextResponse.json({ error: "Errore GraphQL" }, { status: 500 })
    }

    const lineIds =
      cartData.data?.cart?.lines?.edges?.map((edge: any) => edge.node.id) || []

    if (lineIds.length === 0) {
      console.log("[clear-cart] ℹ️ Carrello già vuoto")
      return NextResponse.json({ success: true, message: "Carrello già vuoto" })
    }

    console.log(`[clear-cart] 📋 Trovate ${lineIds.length} linee da rimuovere`)

    // STEP 2: Rimuovi tutte le linee
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
      console.error("[clear-cart] ❌ Errori:", removeData.data.cartLinesRemove.userErrors)
      return NextResponse.json({ 
        error: "Errore rimozione linee",
        details: removeData.data.cartLinesRemove.userErrors
      }, { status: 500 })
    }

    const finalQuantity = removeData.data?.cartLinesRemove?.cart?.totalQuantity || 0
    console.log(`[clear-cart] ✅ Carrello svuotato (quantità: ${finalQuantity})`)

    return NextResponse.json({ 
      success: true, 
      message: "Carrello svuotato",
      finalQuantity 
    })

  } catch (error: any) {
    console.error("[clear-cart] ❌ Errore:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}


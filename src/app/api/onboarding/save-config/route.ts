// src/app/api/onboarding/save-config/route.ts
import { NextRequest, NextResponse } from "next/server"
import { setConfig, AppConfig, StripeAccount, ShopifyConfig } from "@/lib/config"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const {
      checkoutDomain,
      defaultCurrency,
      shopifyDomain,
      shopifyClientId,
      shopifyClientSecret,
      shopifyStorefrontToken,
      stripeAccounts,
    } = body

    // ✅ Shopify config - AGGIORNATO CON CLIENT ID E SECRET
    const shopify: ShopifyConfig = {
      shopDomain: (shopifyDomain || "").trim(),
      clientId: (shopifyClientId || "").trim(),
      clientSecret: (shopifyClientSecret || "").trim(),
      apiVersion: "2024-10",
      storefrontToken: (shopifyStorefrontToken || "").trim(),
    }

    // ✅ Stripe accounts con TUTTI i campi
    const normalizedStripeAccounts: StripeAccount[] = (stripeAccounts || [])
      .slice(0, 4)
      .map((acc: any, idx: number) => ({
        label: (acc.label || `Account ${idx + 1}`).trim(),
        secretKey: (acc.secretKey || "").trim(),
        publishableKey: (acc.publishableKey || "").trim(),    // ✅ AGGIUNTO
        webhookSecret: (acc.webhookSecret || "").trim(),
        active: !!acc.active,
        order: typeof acc.order === "number" ? acc.order : idx,
        merchantSite: (acc.merchantSite || "").trim(),
        lastUsedAt: acc.lastUsedAt ?? 0,                      // ✅ AGGIUNTO
      }))

    // ✅ Config completa
    const update: Partial<AppConfig> = {
      checkoutDomain: (checkoutDomain || "").trim(),
      defaultCurrency: (defaultCurrency || "eur").toLowerCase(),
      shopify,
      stripeAccounts: normalizedStripeAccounts,
    }

    await setConfig(update)

    console.log("[onboarding/save-config] ✓ Configurazione salvata")

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("[onboarding/save-config] error:", err)
    return NextResponse.json(
      { error: err.message || "Errore nel salvataggio config" },
      { status: 500 },
    )
  }
}

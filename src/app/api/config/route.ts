// src/app/api/config/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getConfig, setConfig, AppConfig } from "@/lib/config"

/**
 * GET /api/config
 * Ritorna la config, ma senza secret key Stripe in chiaro.
 */
export async function GET() {
  try {
    const cfg = await getConfig()

    // non mandiamo i secret in chiaro al client
    const safeCfg: AppConfig = {
      ...cfg,
      stripeAccounts: cfg.stripeAccounts.map(acc => ({
        ...acc,
        secretKey: "",
        webhookSecret: "",
      })),
    }

    return NextResponse.json(safeCfg)
  } catch (err: any) {
    console.error("[config GET] error:", err)
    return NextResponse.json(
      { error: err.message || "Errore nel recupero config" },
      { status: 500 },
    )
  }
}

/**
 * POST /api/config
 *
 * 👉 Ora supporta il payload dell'onboarding:
 * {
 *   shopifyDomain,
 *   shopifyAdminToken,
 *   shopifyStorefrontToken,
 *   stripeAccounts: [{ label, secretKey, webhookSecret, active, order }],
 *   defaultCurrency
 * }
 *
 * e, per compatibilità, anche il vecchio formato:
 * {
 *   checkoutDomain?,
 *   shopify: { shopDomain, adminToken, apiVersion, storefrontToken? },
 *   stripeAccounts: [...]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)

    if (!body) {
      return NextResponse.json(
        { error: "Body JSON mancante." },
        { status: 400 },
      )
    }

    // ----------------------------
    // 1) Shopify config
    // ----------------------------

    // formato nuovo (onboarding)
    const flatShopifyDomain: string | undefined = body.shopifyDomain
    const flatShopifyAdminToken: string | undefined =
      body.shopifyAdminToken
    const flatShopifyStorefrontToken: string | undefined =
      body.shopifyStorefrontToken

    // formato vecchio (nested)
    const nestedShopify = body.shopify

    let shopDomain = ""
    let adminToken = ""
    let apiVersion = ""
    let storefrontToken = ""

    if (flatShopifyDomain || flatShopifyAdminToken) {
      // 🟢 payload dall'onboarding
      shopDomain = (flatShopifyDomain || "").trim()
      adminToken = (flatShopifyAdminToken || "").trim()
      apiVersion = "2024-10"
      storefrontToken = (flatShopifyStorefrontToken || "").trim()
    } else if (nestedShopify) {
      // 🔵 compatibilità col vecchio payload
      shopDomain = (nestedShopify.shopDomain || "").trim()
      adminToken = (nestedShopify.adminToken || "").trim()
      apiVersion = (nestedShopify.apiVersion || "2024-10").trim()
      storefrontToken = (nestedShopify.storefrontToken || "").trim()
    }

    if (!shopDomain || !adminToken) {
      return NextResponse.json(
        {
          error:
            "shopifyDomain / shopDomain e shopifyAdminToken / adminToken sono obbligatori.",
        },
        { status: 400 },
      )
    }

    const shopify: AppConfig["shopify"] = {
      shopDomain,
      adminToken,
      apiVersion,
      storefrontToken,
    }

    // ----------------------------
    // 2) Stripe accounts
    // ----------------------------

    const rawStripeAccounts: any[] = Array.isArray(body.stripeAccounts)
      ? body.stripeAccounts
      : []

    const stripeAccounts: AppConfig["stripeAccounts"] =
      rawStripeAccounts.slice(0, 4).map((acc: any, idx: number) => ({
        label: (acc.label || `Account ${idx + 1}`).trim(),
        // supporta sia "secretKey" che "secret" dal form
        secretKey: (acc.secretKey || acc.secret || "").trim(),
        // supporta sia "webhookSecret" che "webhook"
        webhookSecret: (acc.webhookSecret || acc.webhook || "").trim(),
      }))

    // ----------------------------
    // 3) Altri campi (checkoutDomain, defaultCurrency)
    // ----------------------------

    const defaultCurrency = (
      body.defaultCurrency ||
      body.default_currency ||
      "EUR"
    )
      .toString()
      .toLowerCase()

    // se il client non manda checkoutDomain, proviamo a usare l'origin
    const origin = req.headers.get("origin") || ""
    const checkoutDomain =
      (body.checkoutDomain || "").trim() || origin

    const newCfg: Partial<AppConfig> = {
      checkoutDomain,
      defaultCurrency,
      shopify,
      stripeAccounts,
    }

    await setConfig(newCfg)

    return NextResponse.json(
      {
        success: true,
        saved: {
          checkoutDomain,
          defaultCurrency,
          shopify: {
            shopDomain,
            apiVersion,
            hasAdminToken: !!adminToken,
            hasStorefrontToken: !!storefrontToken,
          },
          stripeAccountsCount: stripeAccounts.length,
        },
      },
      { status: 200 },
    )
  } catch (err: any) {
    console.error("[config POST] error:", err)
    return NextResponse.json(
      {
        error:
          err.message ||
          "Errore nel salvataggio config",
      },
      { status: 500 },
    )
  }
}
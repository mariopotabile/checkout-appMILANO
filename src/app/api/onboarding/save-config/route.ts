// src/app/api/onboarding/save-config/route.ts
import { NextRequest, NextResponse } from "next/server"
import { setConfig, AppConfig } from "@/lib/config"

/**
 * Questa route riceve i dati dalla pagina di onboarding
 * e li salva in Firestore nel documento:
 *
 *   collection: "config"
 *   doc:        "global"
 *
 * usando setConfig(..., { merge: true })
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)

    if (!body) {
      return NextResponse.json(
        { ok: false, error: "Body JSON mancante." },
        { status: 400 },
      )
    }

    const {
      checkoutDomain,
      shopDomain,
      adminToken,
      apiVersion,
      defaultCurrency,
      stripeAccounts,
    } = body as {
      checkoutDomain?: string
      shopDomain?: string
      adminToken?: string
      apiVersion?: string
      defaultCurrency?: string
      stripeAccounts?: {
        label?: string
        secretKey?: string
        webhookSecret?: string
      }[]
    }

    // 👇 Minimo sindacale perché le API Shopify funzionino
    if (!shopDomain || !adminToken) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "shopDomain e adminToken sono obbligatori per collegare Shopify.",
        },
        { status: 400 },
      )
    }

    // Costruisco l'oggetto parziale da salvare
    const update: Partial<AppConfig> = {
      ...(checkoutDomain
        ? {
            checkoutDomain: checkoutDomain.trim(),
          }
        : {}),

      ...(defaultCurrency
        ? {
            defaultCurrency: defaultCurrency.toLowerCase(),
          }
        : {}),

      shopify: {
        shopDomain: shopDomain.trim(),
        adminToken: adminToken.trim(),
        apiVersion: (apiVersion || "2024-10").trim(),
      },

      // Se dalla UI invii anche i 4 account Stripe, li segniamo qui
      ...(stripeAccounts && Array.isArray(stripeAccounts)
        ? {
            stripeAccounts: stripeAccounts.map((acc, idx) => ({
              label: acc.label || `Account ${idx + 1}`,
              secretKey: acc.secretKey || "",
              webhookSecret: acc.webhookSecret || "",
            })),
          }
        : {}),
    }

    // 🔥 Salva in Firestore (merge = non perdi gli altri campi)
    await setConfig(update)

    return NextResponse.json(
      {
        ok: true,
        message: "Configurazione salvata correttamente.",
        saved: {
          checkoutDomain: update.checkoutDomain,
          shopify: update.shopify,
          defaultCurrency: update.defaultCurrency,
          stripeAccountsCount: update.stripeAccounts?.length ?? undefined,
        },
      },
      { status: 200 },
    )
  } catch (err: any) {
    console.error("[/api/onboarding/save-config] Errore:", err)
    return NextResponse.json(
      {
        ok: false,
        error:
          err?.message || "Errore interno durante il salvataggio configurazione.",
      },
      { status: 500 },
    )
  }
}
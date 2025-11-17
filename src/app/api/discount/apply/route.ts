// src/app/api/discount/apply/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getConfig } from "@/lib/config"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const code = body?.code as string | undefined
    const sessionId = body?.sessionId as string | undefined

    if (!code || !code.trim()) {
      return NextResponse.json(
        { ok: false, error: "Codice mancante." },
        { status: 400 },
      )
    }

    const cfg = await getConfig()
    const shopDomain = cfg.shopify?.shopDomain
    const adminToken = cfg.shopify?.adminToken
    const apiVersion = cfg.shopify?.apiVersion || "2024-10"

    if (!shopDomain || !adminToken) {
      console.error(
        "[/api/discount/apply] Config Shopify mancante:",
        shopDomain,
        !!adminToken,
      )
      return NextResponse.json(
        {
          ok: false,
          error:
            "Configurazione Shopify mancante sul server. Controlla l'onboarding.",
        },
        { status: 500 },
      )
    }

    const normalizedCode = code.trim()
    const baseUrl = `https://${shopDomain}/admin/api/${apiVersion}`

    // 1) LOOKUP DEL CODICE SCONTO
    const lookupUrl = `${baseUrl}/discount_codes/lookup.json?code=${encodeURIComponent(
      normalizedCode,
    )}`

    const commonHeaders = {
      "X-Shopify-Access-Token": adminToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    }

    // ⚠️ redirect: "manual" perché Shopify risponde 303 con Location
    const lookupRes = await fetch(lookupUrl, {
      method: "GET",
      headers: commonHeaders,
      redirect: "manual",
    })

    if (lookupRes.status === 404) {
      // codice inesistente
      return NextResponse.json(
        { ok: false, error: "Codice sconto non valido o non attivo." },
        { status: 404 },
      )
    }

    let discountCode: any = null

    if (lookupRes.status === 303) {
      // Shopify rimanda alla risorsa del discount_code
      const location = lookupRes.headers.get("location")
      if (!location) {
        console.error(
          "[discount lookup] 303 ma senza Location header, response:",
          await lookupRes.text().catch(() => ""),
        )
        return NextResponse.json(
          {
            ok: false,
            error:
              "Errore nella lettura del codice sconto da Shopify (redirect mancante).",
          },
          { status: 500 },
        )
      }

      const followUrl = location.startsWith("http")
        ? location
        : `https://${shopDomain}${location}`

      const followRes = await fetch(followUrl, {
        method: "GET",
        headers: commonHeaders,
      })

      if (!followRes.ok) {
        const txt = await followRes.text().catch(() => "")
        console.error(
          "[discount lookup follow] Errore:",
          followRes.status,
          txt,
        )
        return NextResponse.json(
          {
            ok: false,
            error:
              "Errore nella lettura del codice sconto da Shopify (redirect).",
          },
          { status: 500 },
        )
      }

      const followJson = await followRes.json().catch((e) => {
        console.error("[discount lookup follow] JSON error:", e)
        return null
      })

      discountCode =
        followJson?.discount_code || followJson?.discountCode || null
    } else if (lookupRes.ok) {
      // Caso “vecchio” in cui Shopify risponde direttamente 200 con il discount_code
      const lookupJson = await lookupRes.json().catch((e) => {
        console.error("[discount lookup json] error:", e)
        return null
      })
      discountCode =
        lookupJson?.discount_code || lookupJson?.discountCode || null
    } else {
      const txt = await lookupRes.text().catch(() => "")
      console.error(
        "[discount lookup] Errore generico:",
        lookupRes.status,
        txt,
      )
      return NextResponse.json(
        {
          ok: false,
          error: "Errore nel contatto con Shopify (lookup codice).",
        },
        { status: 500 },
      )
    }

    if (!discountCode?.price_rule_id) {
      console.error(
        "[discount lookup] Nessun price_rule_id nel discount_code:",
        discountCode,
      )
      return NextResponse.json(
        { ok: false, error: "Codice sconto non valido o scaduto." },
        { status: 400 },
      )
    }

    const priceRuleId = discountCode.price_rule_id

    // 2) RECUPERA LA PRICE RULE (per capire tipo e valore)
    const prUrl = `${baseUrl}/price_rules/${priceRuleId}.json`
    const prRes = await fetch(prUrl, {
      method: "GET",
      headers: commonHeaders,
    })

    if (!prRes.ok) {
      const txt = await prRes.text().catch(() => "")
      console.error("[price_rule] Errore:", prRes.status, txt)
      return NextResponse.json(
        {
          ok: false,
          error: "Errore nel recupero della regola di sconto da Shopify.",
        },
        { status: 500 },
      )
    }

    const prJson = await prRes.json().catch((e) => {
      console.error("[price_rule json] error:", e)
      return null
    })

    const priceRule = prJson?.price_rule
    if (!priceRule) {
      return NextResponse.json(
        {
          ok: false,
          error: "Regola di sconto non trovata o non più valida.",
        },
        { status: 400 },
      )
    }

    const valueType = priceRule.value_type as
      | "percentage"
      | "fixed_amount"
      | "shipping"
    const rawValue = Number(priceRule.value) // es. "-10.0" per 10%
    const absValue = Math.abs(rawValue)

    // Per ora supportiamo SOLO percentuali (come avevamo deciso prima)
    if (valueType !== "percentage") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Questo codice sconto non è di tipo percentuale. Al momento sono supportati solo sconti in percentuale.",
        },
        { status: 400 },
      )
    }

    // ✅ TUTTO OK → ritorniamo i dati essenziali al frontend
    return NextResponse.json(
      {
        ok: true,
        code: discountCode.code,
        valueType, // "percentage"
        percentValue: absValue, // es. 10
        priceRuleId,
      },
      { status: 200 },
    )
  } catch (err: any) {
    console.error("[/api/discount/apply] Errore:", err)
    return NextResponse.json(
      {
        ok: false,
        error:
          err?.message || "Errore interno nell'applicazione del codice sconto.",
      },
      { status: 500 },
    )
  }
}
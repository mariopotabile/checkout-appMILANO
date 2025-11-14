import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { db } from "@/lib/firebaseAdmin"
import { getConfig } from "@/lib/config"

let stripe: Stripe | null = null

async function getStripeFromFirebase(): Promise<Stripe> {
  if (stripe) return stripe

  const cfg = await getConfig()
  const first = (cfg.stripeAccounts || []).find((x: any) => x.secretKey)

  const secretKey = first?.secretKey || ""

  if (!secretKey) {
    throw new Error("Stripe secret key mancante")
  }

  stripe = new Stripe(secretKey)
  return stripe
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json()

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId mancante" }, { status: 400 })
    }

    const snap = await db.collection("cartSessions").doc(sessionId).get()
    if (!snap.exists) {
      return NextResponse.json({ error: "Carrello non trovato" }, { status: 404 })
    }

    const data = snap.data()!
    const total = (data.totals?.subtotal ?? 0) + (data.shippingCents ?? 0)

    if (total < 50) {
      return NextResponse.json({ error: "Importo non valido" }, { status: 400 })
    }

    const stripe = await getStripeFromFirebase()

    const intent = await stripe.paymentIntents.create({
      amount: total,
      currency: "eur",
      automatic_payment_methods: { enabled: true },
      metadata: { sessionId }
    })

    return NextResponse.json({ clientSecret: intent.client_secret })
  } catch (e: any) {
    console.error("payment-intent error", e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
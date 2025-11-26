// src/app/api/save-order/route.ts
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/firebaseAdmin"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sessionId, orderData } = body

    if (!sessionId || !orderData) {
      return NextResponse.json({ error: "Missing data" }, { status: 400 })
    }

    console.log(`[save-order] 💾 Salvataggio ordine per session: ${sessionId}`)

    // Usa sessionId come ID documento
    const docId = sessionId

    // Salva in Firebase
    await db.collection("completedOrders").doc(docId).set({
      ...orderData,
      savedAt: new Date().toISOString(),
      savedFrom: "thank_you_page",
    })

    console.log(`[save-order] ✅ Ordine salvato: ${docId}`)
    console.log(`[save-order] 📊 Items: ${orderData.totals?.itemsCount || 0}`)
    console.log(`[save-order] 💰 Totale: €${orderData.pricing?.totalEuro || '0.00'}`)

    return NextResponse.json({ success: true, orderId: docId })
  } catch (error: any) {
    console.error("[save-order] ❌ Errore:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// src/app/api/checkout-session-status/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getActiveStripeAccount } from '@/lib/stripeRotation'

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('session_id')

    if (!sessionId) {
      return NextResponse.json({ error: 'session_id mancante' }, { status: 400 })
    }

    const activeAccount = await getActiveStripeAccount()
    const stripe = activeAccount.stripe

    // Recupera Checkout Session
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    console.log('[Session Status]:', {
      id: session.id,
      status: session.status,
      payment_status: session.payment_status,
    })

    return NextResponse.json({
      status: session.status,
      payment_status: session.payment_status,
      customer_email: session.customer_details?.email,
      cart_session_id: session.metadata?.cart_session_id,
    })
  } catch (error: any) {
    console.error('[Session Status Error]:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}

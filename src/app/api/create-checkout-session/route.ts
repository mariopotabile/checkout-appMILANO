// src/app/api/create-checkout-session/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getActiveStripeAccount } from '@/lib/stripeRotation'
import { db } from '@/lib/firebaseAdmin'

export async function POST(request: NextRequest) {
  try {
    const { sessionId, cartData } = await request.json()

    console.log('[Checkout Session] Request ricevuta:', { sessionId, hasCartData: !!cartData })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId mancante' }, { status: 400 })
    }

    // Recupera cart da Firebase se non passato
    let cart = cartData
    if (!cart) {
      console.log('[Checkout Session] Recupero cart da Firebase...')
      const cartDoc = await db.collection('cartSessions').doc(sessionId).get()
      
      if (!cartDoc.exists) {
        console.error('[Checkout Session] Cart non trovato:', sessionId)
        return NextResponse.json({ error: 'Carrello non trovato' }, { status: 404 })
      }
      
      cart = cartDoc.data()
    }

    console.log('[Checkout Session] Cart recuperato:', {
      items: cart.items?.length || 0,
      currency: cart.currency,
    })

    // Ottieni account Stripe attivo con rotazione
    const activeAccount = await getActiveStripeAccount()
    const stripe = activeAccount.stripe

    console.log('[Checkout Session] Account Stripe:', activeAccount.label)

    // Calcola totali
    const subtotalCents = cart.items?.reduce((sum: number, item: any) => {
      return sum + (item.linePriceCents || item.priceCents || 0)
    }, 0) || 0

    const discountCents = cart.totalCents 
      ? Math.max(0, subtotalCents - cart.totalCents)
      : 0

    const shippingCents = 590 // BRT Express 24h
    const totalCents = subtotalCents - discountCents + shippingCents

    console.log('[Checkout Session] Totali:', {
      subtotal: subtotalCents / 100,
      discount: discountCents / 100,
      shipping: shippingCents / 100,
      total: totalCents / 100,
    })

    // Prepara line items
    const lineItems = cart.items?.map((item: any) => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.title || 'Prodotto',
          description: item.variantTitle || undefined,
          images: item.image ? [item.image] : undefined,
        },
        unit_amount: item.priceCents || 0,
      },
      quantity: item.quantity || 1,
    })) || []

    // Aggiungi spedizione come line item
    lineItems.push({
      price_data: {
        currency: 'eur',
        product_data: {
          name: 'Spedizione BRT Express 24h',
        },
        unit_amount: shippingCents,
      },
      quantity: 1,
    })

    console.log('[Checkout Session] Line items:', lineItems.length)

    // Crea Checkout Session
    const checkoutSession = await stripe.checkout.sessions.create({
      ui_mode: 'custom',
      mode: 'payment',
      line_items: lineItems,
      
      shipping_address_collection: {
        allowed_countries: ['IT', 'FR', 'DE', 'ES', 'AT', 'BE', 'NL', 'CH', 'PT'],
      },

      phone_number_collection: {
        enabled: true,
      },

      return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://nfrcheckout.com'}/checkout-return?session_id={CHECKOUT_SESSION_ID}`,

      metadata: {
        cart_session_id: sessionId,
        stripe_account: activeAccount.label,
        total_amount: String(totalCents),
      },
    })

    console.log('[Checkout Session] ✅ Creata:', checkoutSession.id)

    return NextResponse.json({
      clientSecret: checkoutSession.client_secret,
      checkoutSessionId: checkoutSession.id,
    })
  } catch (error: any) {
    console.error('[Checkout Session Error]:', error.message)
    console.error('[Checkout Session Stack]:', error.stack)
    
    return NextResponse.json(
      { error: error.message || 'Errore interno' },
      { status: 500 }
    )
  }
}

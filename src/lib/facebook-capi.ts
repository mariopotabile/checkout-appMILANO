// src/lib/facebook-capi.ts
import crypto from 'crypto'

function hashData(data: string): string {
  if (!data) return ''
  return crypto.createHash('sha256').update(data.toLowerCase().trim()).digest('hex')
}

export async function sendFacebookPurchaseEvent(params: {
  email: string
  phone?: string
  firstName?: string
  lastName?: string
  city?: string
  postalCode?: string
  country?: string
  orderValue: number // in cents
  currency: string
  orderItems: Array<{ id: string; quantity: number }>
  eventSourceUrl: string
  clientIp?: string
  userAgent?: string
  fbp?: string
  fbc?: string
}) {
  try {
    const pixelId = process.env.NEXT_PUBLIC_FB_PIXEL_ID
    const accessToken = process.env.FB_CAPI_ACCESS_TOKEN

    if (!pixelId || !accessToken) {
      console.error('[FB CAPI] ❌ Credenziali mancanti')
      return { success: false, error: 'Missing credentials' }
    }

    const eventData = {
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: params.eventSourceUrl,
      
      user_data: {
        em: hashData(params.email),
        ph: params.phone ? hashData(params.phone) : undefined,
        fn: params.firstName ? hashData(params.firstName) : undefined,
        ln: params.lastName ? hashData(params.lastName) : undefined,
        ct: params.city ? hashData(params.city) : undefined,
        zp: params.postalCode ? hashData(params.postalCode) : undefined,
        country: params.country ? hashData(params.country) : undefined,
        client_ip_address: params.clientIp,
        client_user_agent: params.userAgent,
        fbp: params.fbp,
        fbc: params.fbc,
      },
      
      custom_data: {
        currency: params.currency,
        value: params.orderValue / 100, // Converti da cents a euro
        content_ids: params.orderItems.map(item => item.id.toString()),
        content_type: 'product',
        num_items: params.orderItems.reduce((sum, item) => sum + item.quantity, 0),
      },
    }

    console.log('[FB CAPI] 📤 Invio evento Purchase...')

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pixelId}/events`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: [eventData],
          access_token: accessToken,
        }),
      }
    )

    const result = await response.json()

    if (response.ok) {
      console.log('[FB CAPI] ✅ Evento inviato con successo')
      return { success: true, response: result }
    } else {
      console.error('[FB CAPI] ❌ Errore:', result)
      return { success: false, error: result }
    }
  } catch (error: any) {
    console.error('[FB CAPI] ❌ Errore fatale:', error.message)
    return { success: false, error: error.message }
  }
}

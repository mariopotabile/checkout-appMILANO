// src/app/checkout-return/page.tsx
'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function CheckoutReturnContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session_id')
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [cartSessionId, setCartSessionId] = useState<string | null>(null)

  useEffect(() => {
    async function checkStatus() {
      if (!sessionId) {
        setStatus('error')
        return
      }

      try {
        const res = await fetch(`/api/checkout-session-status?session_id=${sessionId}`)
        const data = await res.json()

        console.log('[Checkout Return] Status:', data)

        if (data.status === 'complete' && data.payment_status === 'paid') {
          setStatus('success')
          setCartSessionId(data.cart_session_id)
          
          // Redirect dopo 2 secondi
          setTimeout(() => {
            window.location.href = `/thank-you?sessionId=${data.cart_session_id}`
          }, 2000)
        } else {
          setStatus('error')
        }
      } catch (err) {
        console.error('[Checkout Return] Error:', err)
        setStatus('error')
      }
    }

    checkStatus()
  }, [sessionId])

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg font-medium text-gray-900">Verifica pagamento in corso...</p>
          <p className="text-sm text-gray-600 mt-2">Attendere prego</p>
        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="text-center bg-white rounded-lg shadow-lg p-8 max-w-md">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Pagamento completato!
          </h1>
          <p className="text-gray-600 mb-4">
            Il tuo ordine è stato confermato con successo
          </p>
          <p className="text-sm text-gray-500">
            Reindirizzamento alla pagina di ringraziamento...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#fafafa] flex items-center justify-center p-4">
      <div className="text-center bg-white rounded-lg shadow-lg p-8 max-w-md">
        <div className="text-6xl mb-4">❌</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Errore nel pagamento
        </h1>
        <p className="text-gray-600 mb-6">
          Si è verificato un problema durante l'elaborazione del pagamento
        </p>
        <a 
          href="/cart" 
          className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
        >
          Torna al carrello
        </a>
      </div>
    </div>
  )
}

export default function CheckoutReturn() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
          <p className="text-sm text-gray-600">Caricamento…</p>
        </div>
      }
    >
      <CheckoutReturnContent />
    </Suspense>
  )
}

"use client"

import { PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js"
import { useState } from "react"

export default function PaymentBox({ sessionId }: { sessionId: string }) {
  const stripe = useStripe()
  const elements = useElements()

  const [loading, setLoading] = useState(false)

  async function handlePay() {
    if (!stripe || !elements) {
      console.log("Stripe non pronto")
      return
    }

    setLoading(true)

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/thank-you?sessionId=${sessionId}`,
      },
    })

    if (error) {
      alert(error.message)
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-xl bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-4">
      <PaymentElement />
      <button
        onClick={handlePay}
        disabled={loading}
        className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold"
      >
        {loading ? "Elaborazione…" : "Paga ora"}
      </button>
    </div>
  )
}
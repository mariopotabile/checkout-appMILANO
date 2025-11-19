// src/lib/stripeRotation.ts
import Stripe from 'stripe'
import { db } from "@/lib/firebaseAdmin"
import { getConfig, StripeAccount } from "@/lib/config"

const SIX_HOURS = 6 * 60 * 60 * 1000

// ✅ NUOVO TIPO: Estende StripeAccount con istanza Stripe
export type ActiveStripeAccount = StripeAccount & {
  stripe: Stripe
}

export async function getActiveStripeAccount(): Promise<ActiveStripeAccount> {
  const config = await getConfig()
  
  const activeAccounts = config.stripeAccounts.filter(
    (a) => a.active && a.secretKey && a.publishableKey
  )

  if (activeAccounts.length === 0) {
    throw new Error("Nessun account Stripe attivo configurato")
  }

  // Ordina per "order" (0, 1, 2, 3...)
  activeAccounts.sort((a, b) => (a.order || 0) - (b.order || 0))

  const now = Date.now()

  // Calcola quale account usare in base all'ora
  const hoursSinceEpoch = Math.floor(now / SIX_HOURS)
  const accountIndex = hoursSinceEpoch % activeAccounts.length

  const selectedAccount = activeAccounts[accountIndex]

  // Aggiorna lastUsedAt solo se è passata almeno 1 ora
  const currentLastUsed = selectedAccount.lastUsedAt || 0
  const timeSinceLastUpdate = now - currentLastUsed

  if (timeSinceLastUpdate > 60 * 60 * 1000) {
    const updatedAccounts = config.stripeAccounts.map((a) =>
      a.label === selectedAccount.label ? { ...a, lastUsedAt: now } : a
    )

    await db.collection("config").doc("global").update({
      stripeAccounts: updatedAccounts,
    })

    console.log(`[stripeRotation] ✅ Account attivo: ${selectedAccount.label} (slot ${accountIndex + 1}/${activeAccounts.length})`)
  }

  // ✅ CREA ISTANZA STRIPE
  const stripe = new Stripe(selectedAccount.secretKey, {
    apiVersion: '2025-10-29.clover',
  })

  return {
    ...selectedAccount,
    stripe,
  }
}

// ✅ FUNZIONE PER VEDERE QUANDO CAMBIA IL PROSSIMO ACCOUNT
export function getNextRotationTime(): Date {
  const now = Date.now()
  const hoursSinceEpoch = Math.floor(now / SIX_HOURS)
  const nextRotationMs = (hoursSinceEpoch + 1) * SIX_HOURS
  return new Date(nextRotationMs)
}

// ✅ FUNZIONE PER VEDERE L'ACCOUNT CORRENTE SENZA AGGIORNARE DB
export async function getCurrentAccountInfo(): Promise<{
  account: StripeAccount
  slotNumber: number
  totalSlots: number
  nextRotation: Date
}> {
  const config = await getConfig()
  
  const activeAccounts = config.stripeAccounts.filter(
    (a) => a.active && a.secretKey && a.publishableKey
  )

  if (activeAccounts.length === 0) {
    throw new Error("Nessun account Stripe attivo configurato")
  }

  activeAccounts.sort((a, b) => (a.order || 0) - (b.order || 0))

  const now = Date.now()
  const hoursSinceEpoch = Math.floor(now / SIX_HOURS)
  const accountIndex = hoursSinceEpoch % activeAccounts.length

  return {
    account: activeAccounts[accountIndex],
    slotNumber: accountIndex + 1,
    totalSlots: activeAccounts.length,
    nextRotation: getNextRotationTime(),
  }
}

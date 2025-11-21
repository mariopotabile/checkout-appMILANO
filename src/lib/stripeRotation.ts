// src/lib/stripeRotation.ts
import Stripe from 'stripe'
import { db } from "@/lib/firebaseAdmin"
import { getConfig, StripeAccount } from "@/lib/config"

const SIX_HOURS = 6 * 60 * 60 * 1000

// ✅ TIPO: Estende StripeAccount con istanza Stripe
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
  const hoursSinceEpoch = Math.floor(now / SIX_HOURS)
  const accountIndex = hoursSinceEpoch % activeAccounts.length

  const selectedAccount = activeAccounts[accountIndex]

  // ✅ VERIFICA ESPLICITA - LOG COMPLETO
  console.log('[stripeRotation] 🔍 VERIFICA COMPLETA:', {
    timestamp: new Date().toISOString(),
    hoursSinceEpoch,
    accountIndex,
    totalActive: activeAccounts.length,
    
    ALL_ACCOUNTS: activeAccounts.map((a, i) => ({
      index: i,
      label: a.label,
      order: a.order,
      secretStart: a.secretKey.substring(0, 30),
      secretEnd: a.secretKey.substring(a.secretKey.length - 10),
      merchantSite: a.merchantSite,
    })),
    
    SELECTED_ACCOUNT: {
      index: accountIndex,
      label: selectedAccount.label,
      order: selectedAccount.order,
      secretStart: selectedAccount.secretKey.substring(0, 30),
      secretEnd: selectedAccount.secretKey.substring(selectedAccount.secretKey.length - 10),
      merchantSite: selectedAccount.merchantSite,
    }
  })

  // ✅ VERIFICA CHE LA SECRET KEY SIA CORRETTA
  if (selectedAccount.label === 'US 2 CUMPEN') {
    if (!selectedAccount.secretKey.includes('51SPOFc')) {
      console.error('[stripeRotation] ❌ ERRORE: US 2 CUMPEN ha secret key di NFR1!')
      console.error('[stripeRotation] ❌ Secret ricevuta:', selectedAccount.secretKey.substring(0, 30))
      throw new Error('Mismatch tra label e secret key per US 2 CUMPEN')
    }
  }

  if (selectedAccount.label === 'NFR1') {
    if (!selectedAccount.secretKey.includes('51ROEYL')) {
      console.error('[stripeRotation] ❌ ERRORE: NFR1 ha secret key di US 2 CUMPEN!')
      console.error('[stripeRotation] ❌ Secret ricevuta:', selectedAccount.secretKey.substring(0, 30))
      throw new Error('Mismatch tra label e secret key per NFR1')
    }
  }

  // Aggiorna lastUsedAt
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

  // Crea istanza Stripe
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

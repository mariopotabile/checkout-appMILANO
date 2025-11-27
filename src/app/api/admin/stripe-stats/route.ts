// src/app/api/admin/stripe-stats/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firebaseAdmin'
import { getConfig } from '@/lib/config'
import { getCurrentAccountInfo } from '@/lib/stripeRotation'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const authQuery = request.nextUrl.searchParams.get('key')
    const correctKey = process.env.ADMIN_SECRET_KEY || 'your-secret-key'

    if (authHeader !== `Bearer ${correctKey}` && authQuery !== correctKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const config = await getConfig()
    const rotationInfo = await getCurrentAccountInfo()

    const activeAccounts = config.stripeAccounts.filter(
      (a) => a.active && a.secretKey
    )

    const now = new Date()
    const today = now.toISOString().split('T')[0] // "2025-11-27"

    console.log(`[stripe-stats] 📅 Caricamento transazioni del ${today}`)

    // ✅ CARICA TRANSAZIONI DA FIREBASE
    const transactionsRef = db.collection('transactions')
    const snapshot = await transactionsRef
      .where('date', '==', today)
      .orderBy('createdTimestamp', 'desc')
      .limit(100)
      .get()

    const allTransactions = snapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: data.paymentIntentId,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        created: data.createdTimestamp,
        email: data.email,
        customerName: data.customerName,
        orderNumber: data.orderNumber,
        account: data.stripeAccount,
      }
    })

    console.log(`[stripe-stats] 📊 Trovate ${allTransactions.length} transazioni oggi`)

    // ✅ AGGREGA PER ACCOUNT
    const accountStats = activeAccounts.map(account => {
      const accountTxs = allTransactions.filter(tx => tx.account === account.label)
      
      const totalCents = accountTxs.reduce((sum, tx) => sum + tx.amount, 0)
      const transactionCount = accountTxs.length

      return {
        label: account.label,
        order: account.order,
        active: account.active,
        isCurrentlyActive: account.label === rotationInfo.account.label,
        stats: {
          totalEur: totalCents / 100,
          totalCents,
          transactionCount,
          currency: 'EUR',
        },
      }
    })

    // ✅ TOTALI COMPLESSIVI
    const grandTotal = accountStats.reduce(
      (sum, acc) => sum + acc.stats.totalEur,
      0
    )

    const grandTotalTransactions = accountStats.reduce(
      (sum, acc) => sum + acc.stats.transactionCount,
      0
    )

    return NextResponse.json({
      date: now.toISOString(),
      dateLocal: now.toLocaleString('it-IT', { timeZone: 'Europe/Rome' }),
      rotation: {
        currentAccount: rotationInfo.account.label,
        slotNumber: rotationInfo.slotNumber,
        totalSlots: rotationInfo.totalSlots,
        nextRotation: rotationInfo.nextRotation.toISOString(),
        nextRotationLocal: rotationInfo.nextRotation.toLocaleString('it-IT', {
          timeZone: 'Europe/Rome',
        }),
      },
      accounts: accountStats,
      totals: {
        totalEur: grandTotal,
        transactionCount: grandTotalTransactions,
        currency: 'EUR',
      },
      transactions: allTransactions,
    })
  } catch (error: any) {
    console.error('[stripe-stats] Error:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}


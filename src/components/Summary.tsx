"use client";

import { useState } from "react";

type SummaryItem = {
  id: string | number;
  title: string;
  quantity: number;
  price: number; // centesimi
  line_price?: number;
};

type SummaryProps = {
  subtotal: number;       // centesimi
  currency: string;
  items: SummaryItem[];
  sessionId: string;
};

export default function Summary({
  subtotal,
  currency,
  items,
  sessionId,
}: SummaryProps) {
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per ora usiamo il subtotal come totale (puoi aggiungere spedizione/tasse dopo)
  const total = subtotal;

  async function handlePay() {
    if (!sessionId) {
      setError("Sessione checkout mancante.");
      return;
    }

    setPaying(true);
    setError(null);

    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          totalAmount: total, // in centesimi
          currency,
        }),
      });

      const raw = await res.text();
      let data: any = {};

      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (e) {
        console.error("[summary] errore parse JSON:", e, raw);
        throw new Error("Risposta non valida dal server di pagamento.");
      }

      if (!res.ok) {
        console.error("[summary] res not ok:", res.status, data);
        throw new Error(data.error || "Impossibile avviare il pagamento.");
      }

      if (data.url) {
        // Redirect alla pagina di checkout Stripe
        window.location.href = data.url;
        return;
      }

      throw new Error("URL di checkout non ricevuta da Stripe.");
    } catch (err: any) {
      console.error("[summary] errore handlePay:", err);
      setError(err?.message || "Errore imprevisto nel pagamento.");
      setPaying(false);
    }
  }

  return (
    <aside className="rounded-3xl border border-white/10 bg-slate-900/70 backdrop-blur-xl p-6 text-slate-100 space-y-4 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
      <h2 className="text-lg font-semibold">Totale ordine</h2>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Subtotale</span>
          <span className="font-medium">
            {(subtotal / 100).toFixed(2)} {currency}
          </span>
        </div>

        {/* placeholder per sconti / spedizioni se in futuro li vorrai aggiungere */}
        <div className="flex justify-between">
          <span className="text-slate-400">Spedizione</span>
          <span className="text-slate-400">Calcolata dopo</span>
        </div>

        <div className="border-t border-white/5 pt-2 flex justify-between items-center">
          <span className="text-slate-300">Totale</span>
          <span className="text-base font-semibold">
            {(total / 100).toFixed(2)} {currency}
          </span>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-950/40 border border-red-500/30 rounded-2xl px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={paying}
        className="w-full inline-flex items-center justify-center rounded-full bg-slate-50 text-slate-900 px-4 py-2.5 text-sm font-medium shadow-lg shadow-black/50 hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {paying ? "Reindirizzamento..." : "Paga ora con carta"}
      </button>

      <p className="text-[11px] text-slate-500 text-center">
        Pagamento sicuro gestito da Stripe. I dati della tua carta non
        transitano mai sui nostri server.
      </p>
    </aside>
  );
}
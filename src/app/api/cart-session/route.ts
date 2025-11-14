// src/app/api/cart-session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/firebaseAdmin";

type ShopifyCartItem = {
  id: number | string;
  title: string;
  quantity: number;
  price: number; // centesimi
  line_price?: number; // centesimi
  image?: string;
  variant_title?: string;
};

type ShopifyCart = {
  items?: ShopifyCartItem[];
  items_subtotal_price?: number; // centesimi
  currency?: string;
};

type CheckoutItem = {
  id: string | number;
  title: string;
  quantity: number;
  price: number; // centesimi
  line_price?: number; // centesimi
  image?: string;
  variant_title?: string;
};

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// Gestione preflight CORS (importantissimo da Shopify -> Vercel)
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");

    const body = await req.json().catch(() => null);
    if (!body || !body.cart) {
      return new NextResponse(
        JSON.stringify({ error: "Body non valido o cart mancante" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    const cart: ShopifyCart = body.cart;

    const items: CheckoutItem[] = Array.isArray(cart.items)
      ? cart.items.map((item) => ({
          id: item.id,
          title: item.title,
          quantity: item.quantity || 0,
          price: item.price || 0,
          line_price: item.line_price,
          image: item.image,
          variant_title: item.variant_title,
        }))
      : [];

    // Subtotale in centesimi
    const subtotalFromCart =
      typeof cart.items_subtotal_price === "number"
        ? cart.items_subtotal_price
        : 0;

    const subtotalFromItems = items.reduce((sum, item) => {
      const lineCents =
        typeof item.line_price === "number"
          ? item.line_price
          : (item.price || 0) * (item.quantity || 0);
      return sum + lineCents;
    }, 0);

    const subtotal =
      subtotalFromCart && subtotalFromCart > 0
        ? subtotalFromCart
        : subtotalFromItems;

    const currency = cart.currency || "EUR";

    const sessionId = randomUUID();

    const doc = {
      sessionId,
      createdAt: new Date().toISOString(),
      items,
      totals: {
        subtotal,
        currency,
      },
      rawCart: cart,
    };

    await db.collection("cartSessions").doc(sessionId).set(doc);

    return new NextResponse(
      JSON.stringify({
        sessionId,
        items,
        totals: {
          subtotal,
          currency,
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      }
    );
  } catch (err) {
    console.error("[cart-session POST] errore:", err);
    return new NextResponse(
      JSON.stringify({ error: "Errore interno creazione sessione carrello" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(null),
        },
      }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return new NextResponse(
        JSON.stringify({ error: "sessionId mancante" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    const snap = await db.collection("cartSessions").doc(sessionId).get();

    if (!snap.exists) {
      return new NextResponse(
        JSON.stringify({ error: "Nessun carrello trovato" }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }

    const data = snap.data() || {};

    return new NextResponse(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(origin),
      },
    });
  } catch (err) {
    console.error("[cart-session GET] errore:", err);
    return new NextResponse(
      JSON.stringify({ error: "Errore interno lettura sessione carrello" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(null),
        },
      }
    );
  }
}
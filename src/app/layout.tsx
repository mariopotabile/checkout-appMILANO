// src/app/layout.tsx
import "./globals.css"
import type { Metadata } from "next"
import FacebookPixel from "@/components/FacebookPixel"

export const metadata: Metadata = {
  title: "Checkout App",
  description: "Custom Shopify + Stripe checkout",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it">
      <body>
        <FacebookPixel />
        {children}
      </body>
    </html>
  )
}

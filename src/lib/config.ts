// src/lib/config.ts
import { db } from "./firebaseAdmin"

export interface ShopifyConfig {
  shopDomain: string
  adminToken: string
  apiVersion: string
  // 👉 aggiunto: token Storefront per leggere carrelli/prodotti lato pubblico
  storefrontToken?: string
}

export interface StripeAccount {
  label: string
  secretKey: string
  webhookSecret: string
}

export interface AppConfig {
  checkoutDomain: string
  shopify: ShopifyConfig
  stripeAccounts: StripeAccount[]
  defaultCurrency?: string
}

const CONFIG_COLLECTION = "config"
const CONFIG_DOC_ID = "global"

const defaultConfig: AppConfig = {
  checkoutDomain: process.env.NEXT_PUBLIC_CHECKOUT_DOMAIN || "",
  defaultCurrency: "eur",

  shopify: {
    shopDomain: process.env.SHOPIFY_SHOP_DOMAIN || "",
    adminToken: process.env.SHOPIFY_ADMIN_TOKEN || "",
    apiVersion: process.env.SHOPIFY_API_VERSION || "2024-10",
    storefrontToken: process.env.SHOPIFY_STOREFRONT_TOKEN || "",
  },

  stripeAccounts: [
    { label: "Account 1", secretKey: "", webhookSecret: "" },
    { label: "Account 2", secretKey: "", webhookSecret: "" },
    { label: "Account 3", secretKey: "", webhookSecret: "" },
    { label: "Account 4", secretKey: "", webhookSecret: "" },
  ],
}

export async function getConfig(): Promise<AppConfig> {
  const ref = db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID)
  const snap = await ref.get()

  if (!snap.exists) {
    return defaultConfig
  }

  const data = snap.data() || {}

  return {
    checkoutDomain: data.checkoutDomain || defaultConfig.checkoutDomain,

    defaultCurrency: data.defaultCurrency || defaultConfig.defaultCurrency,

    shopify: {
      shopDomain:
        data.shopify?.shopDomain || defaultConfig.shopify.shopDomain,
      adminToken:
        data.shopify?.adminToken || defaultConfig.shopify.adminToken,
      apiVersion:
        data.shopify?.apiVersion || defaultConfig.shopify.apiVersion,
      storefrontToken:
        data.shopify?.storefrontToken ||
        defaultConfig.shopify.storefrontToken,
    },

    stripeAccounts: (data.stripeAccounts || defaultConfig.stripeAccounts).map(
      (acc: any, idx: number) => ({
        label: acc?.label || `Account ${idx + 1}`,
        secretKey: acc?.secretKey || "",
        webhookSecret: acc?.webhookSecret || "",
      }),
    ),
  }
}

export async function setConfig(newConfig: Partial<AppConfig>): Promise<void> {
  const ref = db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID)
  await ref.set(newConfig, { merge: true })
}
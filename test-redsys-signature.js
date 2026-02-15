import crypto from "crypto"

const secretKey = "LA_TUA_SECRET_KEY_BASE64" // usa quella TEST
const merchantParams = {
  DS_MERCHANT_AMOUNT: "1099",
  DS_MERCHANT_ORDER: "123456789012",
  DS_MERCHANT_MERCHANTCODE: "367744828",
  DS_MERCHANT_CURRENCY: "978",
  DS_MERCHANT_TRANSACTIONTYPE: "0",
  DS_MERCHANT_TERMINAL: "1",
}

// base64url encode
const merchantParamsB64 = Buffer
  .from(JSON.stringify(merchantParams))
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "")

// key derivation
const key = Buffer.from(secretKey, "base64")
const orderKey = crypto.createHmac("sha256", key)
  .update(merchantParams.DS_MERCHANT_ORDER)
  .digest()

// signature
const signature = crypto.createHmac("sha256", orderKey)
  .update(merchantParamsB64)
  .digest("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "")

console.log("Ds_MerchantParameters:", merchantParamsB64)
console.log("Ds_Signature:", signature)
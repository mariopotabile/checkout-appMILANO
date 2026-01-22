
        body: JSON.stringify({
          query: mutation,
          variables: { cartId, lineIds },
        }),
      }
    )

    const removeData = await removeResponse.json()

    if (removeData.data?.cartLinesRemove?.userErrors?.length > 0) {
      console.error("[clearShopifyCart] ❌ Errori:", removeData.data.cartLinesRemove.userErrors)
    } else {
      console.log("[clearShopifyCart] ✅ Carrello svuotato")
    }
  } catch (error: any) {
    console.error("[clearShopifyCart] ❌ Errore:", error.message)
  }
}
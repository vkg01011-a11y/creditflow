# Shopify Native Store Credit redemption capabilities

Updated: 2026-11-27
Shopify API version in this app: `2026-10`

Shopify Native Store Credit is the balance authority for Pikmora Perks. The app must not create a competing balance, deduct credit after checkout to simulate a restriction, or advertise a control Shopify does not enforce.

## Capability matrix

| Requested control | Shopify capability found | Pikmora Perks decision |
|---|---|---|
| Minimum cart/order value | A Payment Customization Function can conditionally hide payment methods using cart data. Shopify documents cart-total-based visibility as a use case. | A threshold could hide the combined redeemable payment method below a cart total, but that also hides Shop Cash. This is a disruptive all-or-nothing visibility rule, not a credit amount restriction. Not implemented. |
| Maximum Store Credit amount per order | Payment customization can hide, rename or reorder methods. Its input does not include the Store Credit balance or amount the buyer applies. | Unsupported. A function cannot clamp the amount to a merchant-defined maximum. Not implemented. |
| Maximum percentage of cart paid with Store Credit | Same amount/balance limitation. | Unsupported. Not implemented. |
| Product/collection eligibility | A payment customization can inspect configured cart data and hide a method conditionally. | It could potentially hide the shared redeemable method based on cart contents, subject to the exact Function input and checkout surface; it cannot apply only the qualifying credit portion. Because this affects Shop Cash too, it is not a safe Pikmora Perks-specific Store Credit guarantee. No such rule is implemented. |
| Customer eligibility | Function inputs can include supported customer/cart data; a checkout UI extension can read selected payment options for display. | Hiding the shared method may be possible for some customer/cart conditions, but does not control amount and must be validated per surface and plan before any claim. Not implemented. |
| Detect that Store Credit is selected | Checkout UI Extensions expose read-only payment options, including a `redeemable` type. | This is display/extension context, not authorization to change the amount or payment option. It does not make per-transaction Store Credit controls safe. |
| Distinguish Store Credit from Shop Cash | Shopify documents one shared `paymentMethods` entry for Store Credit and Shop Cash, currently displayed as `Redeemable payment method`. | Not reliably distinguishable in the Payment Customization Function. Hiding the entry hides both. |
| Inspect amount/balance at checkout | Shopify's Payment Customization Function input does not carry Store Credit balance. Checkout payment options are read-only. | Unsupported in the surfaces reviewed. No balance or applied amount is available to the app's payment customization logic. |
| Accelerated checkout and other surfaces | Cart and Checkout Validation Functions cover checkout validation across documented supported surfaces, but they validate cart/order rules rather than modifying Store Credit tender amount. Payment customization behavior is specific to its documented checkout target. | Do not imply one app control covers every sales channel or accelerated checkout. Verify exact target and surface before implementing a future visibility rule. |

## Safe current product behavior

- Pikmora Perks controls when it issues Native Store Credit through reward rules.
- It can reverse the original reward proportionally when merchandise refunds are processed, using Shopify Native Store Credit debit operations and a durable idempotency reservation.
- It verifies Shopify's remaining credit amount and expiry before queuing an expiry reminder.
- It does not debit Store Credit after checkout to mimic a redemption cap.
- It does not provide minimum-cart, per-order maximum, cart-percentage, product, collection or customer redemption settings.

## Official Shopify documentation reviewed

- [Payment Customization Function API](https://shopify.dev/docs/api/functions/2026-04/payment-customization): payment-method visibility/reordering/renaming; Store Credit and Shop Cash share a payment method entry; input does not include Store Credit balance.
- [Cart and Checkout Validation Function API](https://shopify.dev/docs/api/functions/2026-04/cart-and-checkout-validation): server-side cart and checkout validation and supported checkout surfaces. It does not provide a Store Credit tender amount adjustment.
- [Checkout UI Extensions Payments API](https://shopify.dev/docs/api/checkout-ui-extensions/2026-01/target-apis/checkout-apis/payments-api): selected and available payment options are read-only; `redeemable` includes options such as gift cards or Store Credit.

The Shopify documentation version surfaced in the official docs index was `2026-04` for these Function pages at review time. Before implementing a future checkout extension, recheck the exact API version selected by the extension and all supported surfaces. The app's current `2026-10` Admin API version does not itself add an amount-control API.

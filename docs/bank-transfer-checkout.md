# PromptPay receipt checkout

The current checkout uses the existing frontend image `assets/images/ppqr.jpg`.
The customer creates an order first, sees the server-calculated total, scans the
QR with their banking app, enters that amount and uploads a receipt. There is
no Stripe or automatic bank/slip verification in this workflow.

## Customer API

All routes below require a Users & Permissions customer JWT. Bootstrap enables
only these workflow permissions for the Authenticated role. Public permissions
and management CRUD access are not expanded.

- `POST /api/checkout/quote`: `{ items: [{ variantDocumentId, quantity }] }`.
- `POST /api/checkout/orders`: header `Idempotency-Key` (UUID); body includes
  `customer: { firstName, lastName, email }`, `shippingAddress`, `billingAddress`,
  `items`, and the quoted `expectedTotal`.
- Each address contains `recipientName`, `phone`, `addressLine1`, `subdistrict`,
  `district`, `province`, `postalCode` and `countryCode: "TH"`.
- `GET /api/checkout/requests/:key`: recover this customer's order when a
  create response was lost or the checkout page was reloaded.
- `GET /api/checkout/orders/:documentId`: read this customer's saved order.
- `GET /api/checkout/orders?page=1&pageSize=10&search=PS-&status=pending_review`:
  this customer's history, newest first. Returns `{ data, meta: { pagination:
  { page, pageSize, total, pageCount } } }`. Page size is 1–50. Search matches
  order numbers; status accepts order statuses or `pending_review` for receipts
  awaiting review. `pending_payment` includes only unpaid orders. Ownership is
  always derived from the JWT; email/user/filter/populate parameters cannot
  broaden access. Only fixed customer summary fields are returned.
- `POST /api/checkout/orders/:documentId/receipt`: multipart field `files`,
  exactly one JPG/PNG/WebP image, maximum 5 MB. Image contents are decoded and
  re-encoded as PNG; original metadata is discarded.
- `GET /api/checkout/orders/:documentId/receipt`: authenticated receipt download
  for the owner only, with private/no-store cache headers.

Frontend session recovery stores only a request key, order ID and cart
signature, under a user-specific key. Contact/address details come from the
authenticated order response. Existing carts are upgraded with variant IDs
using the catalog API before checkout. Cart contents are cleared only after
receipt submission, and only when they still match the saved order's cart.

## Persistence and stock

Order creation transactionally saves Customer Profile, the current shipping/
billing address book entries, Order/address snapshots, Order Item snapshots,
Payment (`bank_transfer`) and Stock Reservation. Server prices and shipping
settings determine totals. With no Store Setting record, shipping is zero.

Customer and variant row locks prevent duplicate profile/order retries and
overselling. Locking stock reads use the current MySQL row balance rather
than an older repeatable-read snapshot. Repeating a request key with the same
payload returns its original order; different details under that key are rejected.

New orders: `orderStatus=pending_payment`, `paymentStatus=unpaid`, Payment
`paymentStatus=pending`. Unpaid reservations expire after
`PAYMENT_WINDOW_MINUTES` (default 30); the server sweeps them every minute and
when processing checkout requests. An expired order cannot receive a receipt.

After receipt submission: Order `paymentStatus=pending_review`, Payment
`paymentStatus=awaiting_review`, plus a manual Payment Event. No `paidAt` is
set and no sale is recorded. Its stock remains reserved for manual review;
the unpaid-order expiry job does not release submitted payments.

## Private storage and the next phase

`PAYMENT_SLIP_DIR` defaults to `.private/payment-slips`, outside `public/` and
excluded from Git. Keep it on persistent storage and include it in backups
alongside the database. Use an absolute directory outside public/ when deploying.

Trusted reviewers can download receipts using
`GET /api/checkout/review/:documentId/receipt` with a management API token.
Customer tokens cannot use this route. Slip storage keys/names/hashes are
private fields and are not returned in customer responses or public media URLs.

The admin sales history UI is available at the application admin route and uses
the protected `GET /api/checkout/admin/orders` endpoint. Reviewers can download
receipts through the private review route and approve a pending review through
`POST /api/checkout/admin/orders/:documentId/approve`. Approval is transactional:
it consumes active reservations, decrements stock, writes an Inventory Movement,
marks the payment succeeded and changes the order to confirmed. Do not mark
orders paid by directly editing only a status field. Rejection remains a
separate workflow; after a receipt upload the customer still sees
"awaiting review" until an approval transaction succeeds.

## Verification

- Backend: `npm run check:checkout` (temporary users/products/orders and a
  generated test image; fixture data and files are cleaned up).
- Backend type check: `node node_modules/typescript/bin/tsc --noEmit`.
- Frontend: `npm run build` and `npm test -- --watch=false --browsers=ChromeHeadless`.

The integration checks exercise server totals, invalid address/quantity data,
idempotency/recovery, customer ownership, simultaneous last-unit purchases,
unpaid expiry, multipart validation, private receipt download, reviewer access
and awaiting-review statuses. They perform no bank transfers.

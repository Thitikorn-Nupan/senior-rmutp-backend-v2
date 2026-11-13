# Perfume store database

The commerce schemas live in `src/api/*/content-types/*/schema.json` and
`src/components/commerce`. Strapi manages the SQL tables and relation tables;
do not run the legacy SQL dump into these tables. The configured MySQL database
is selected by `.env`. Commerce tables use `shop_` and components use
`components_commerce_` to avoid legacy/template table-name collisions.
The unused blog template types (Article, Author, Category, About and Global),
their shared components, and the template seed command have been removed.
Product Category, Brand, and all commerce schemas are retained. Existing
uploaded media are retained; they may be reviewed separately in Media Library.

## Apply and check

Back up the target database before a deployment. Stop an existing development
server before applying schema changes. Run from the repository root:

```powershell
npm run strapi -- ts:generate-types
node scripts/check-commerce.cjs
npm run dev
```

The check compiles and loads Strapi, synchronizing the database without opening
an HTTP listener. It checks relations, historical snapshots, decimal precision,
invalid quantity rejection, unique SKU/event identifiers, and rollback. Its
fixture data is rolled back. Run against a development/test database only.
On normal startup Strapi also synchronizes the schema. No separate SQL import
is needed.

Open Content Manager to enter brands, product categories, products, variants,
and the Store Setting. Use Users & Permissions for customer login and Admin
RBAC for staff. Schema startup does not create customer accounts, seed products
or Thai geographic reference data, configure API permissions, or migrate old
purchases/passwords. Use the explicit demo catalog seed below for sample products.

## Models

### Demo catalog

Run `npm run seed:commerce` to add 10 fictional perfumes: 3 unisex, 3 male,
and 4 female, with matching Product Categories. Each product has one variant
with size, concentration, THB price, opening stock, and an opening inventory
movement. Products and categories are published. No product photos are seeded.
The sample data lives in `data/commerce-products.json`.

The seed reuses existing records by slug/SKU, preserves edited data and stock,
and verifies product/category/variant relations before committing. Re-running
does not duplicate the catalog or reset inventory. If a matching record exists
only as an unpublished draft, it stops without overwriting that draft. Use
`seed:commerce`; the original blog seed command has been removed.

| Type | Purpose / relationships |
| --- | --- |
| Brand | One brand has many products. |
| Product Category | Many-to-many with products; gender is a separate product enum. |
| Product | Marketing content; one product has many variants. |
| Product Variant | Unique SKU, size, concentration, price, currency, physical and reserved stock. |
| Customer Profile | Optional one-to-one Users & Permissions user; many addresses/orders. |
| Customer Address | Address book entry with address component and default-address flags. |
| Order | Optional customer (guest checkout supported), buyer/address snapshots, totals, statuses, shipping tracking. |
| Order Item | Product/SKU/variant/price snapshots and optional current variant reference. |
| Payment | Many attempts per order, transfer review or Stripe references. |
| Payment Event | Unique provider event ID, processing state and retry count. |
| Stock Reservation | Order/variant, quantity, expiration and reservation state. |
| Inventory Movement | Signed physical stock delta; unique operation key for deduplication. |
| Province | Unique reference code, Thai/English names, many districts. |
| District | Unique reference code, province, many subdistricts. |
| Subdistrict | Unique reference code, district, `postalCodes` JSON array of five-digit strings. |
| Store Setting (Single Type) | Shop identity, bank accounts, payment windows, shipping defaults, currency and timezone. |

Components: Address (Thai format), Bank Account, Variant Snapshot. Address
components in orders deliberately contain copied text, not live geographic or
address-book relations. Bank accounts displayed during payment are also copied.
Address book defaults start false. Store payment methods start disabled; enter
real bank details/configure Stripe before enabling either method.

Catalog marketing types (Product, Brand, Product Category) support Draft &
Publish. Variants, financial/customer/stock/reference data and settings do not
use Draft & Publish or localization. Publish the parent product before listing
its active variants. Fields such as SKU and stock must never be duplicated
between draft and published versions.

## Required commerce services (next implementation phase)

These schemas are not a checkout/payment engine. All 16 models now have core
CRUD routes/controllers/services for trusted management clients (78 routes,
including the Single Type). Every CRUD action requires a Content API Token via
the `management-api-token` policy; customer JWTs and anonymous users are denied.
See [Management CRUD APIs](crud-api.md) for paths, token scopes and examples.
These CRUD operations do not execute commerce workflows or customer ownership
rules. The phase 1 storefront continues to expose public, read-only
`/api/catalog/products`, `/api/catalog/products/:documentId`, and
`/api/catalog/categories` routes with fixed fields/relations, published and
active filtering, name search, category filtering and product pagination.
Customer login uses the existing Users & Permissions `/api/auth/local` route.
Run `node scripts/check-storefront.cjs` against a development/test database
with a seeded catalog to verify this flow; temporary fixtures are cleaned up.
The admin Content Manager can manage the schemas, but
editing a status there does not execute a stock/payment workflow. Restrict
transaction and inventory edits in staff RBAC before using real orders.

- Checkout must resolve active variants of published products, compute prices,
  shipping, discounts and tax on the server, and copy snapshots. All order
  amounts use decimal(15,2) in currency major units; use decimal-safe arithmetic
  or integer minor units in services. Convert THB amounts to integer satang
  when calling Stripe. Never trust client totals or a client-supplied paid flag.
- Define totals as `subtotal - discountTotal + shippingTotal + taxTotal`.
  For tax-inclusive prices, split out the included tax before assigning the
  pre-tax subtotal; do not add the same tax twice. Persist the computed amounts
  on the order/items. Settings are defaults for new checkouts, not historical
  prices. Currency consistency and cross-field arithmetic need service validation.
- Reserve stock atomically with a transaction plus conditional update or row
  lock. Availability is `stockOnHand - stockReserved`; reject insufficient
  availability. Enforce `0 <= stockReserved <= stockOnHand` in the service.
  A reservation row alone does not update counters. Active reservations must
  be consumed once after payment or released once after cancellation/expiry.
- Inventory movements track changes to physical stock, not reservation holds.
  A sale consumes reserved and physical stock together; a released unpaid
  reservation changes reserved stock only. Write movements and counters in
  the same transaction, using stable movement/reservation keys.
- Transfer upload moves a payment to awaiting review. Approval/rejection must
  verify staff rights and run through the same settlement service used by
  Stripe. Verify Stripe signature using the raw request body, amount, currency
  and order/payment references. Persist event receipt, retry failures, and
  atomically settle once. Handle duplicate/out-of-order events and late payment
  after reservation expiry without overselling. No card data or Stripe secrets
  belong in these models.
- Slips use private `slipStorageKey`/metadata, intentionally not a public Upload
  media field. Implement private object storage and an authorized download
  endpoint. A private field alone does not make a public file private. Never
  return storage keys or legacy slip paths to customers.
- Customer ownership must be checked on every address/order/payment read/write.
  Derive customer/user links from authentication, not request body identifiers.
  Prevent multiple default shipping/billing addresses per customer in a
  transaction. Validate geographic hierarchy and postal-code membership;
  `postalCodes` must be an array of five-digit strings. JSON schema alone does
  not enforce that array shape. Component postal code validation assumes TH.
- Do not delete products, variants, orders, payments or stock history used by
  transactions. Archive catalog entries with `isActive`. Admin permissions and
  future service guards must enforce this; relations alone do not prevent it.
- Reports aggregate payments/orders/items, count successful settlement once,
  use `paidAt` for receipts, and apply Asia/Bangkok reporting boundaries. Add
  Refund records before supporting partial/full refunds; status enums reserve
  those states but do not implement refund accounting. One order currently
  stores one shipping tracking number; add Shipment for split deliveries.

## Legacy migration

Use `legacyId` where available and maintain an old-ID to new-documentId map.
Map old products into products plus one variant initially. Customer emails
belong to Strapi users, and old order buyer emails are copied into orders.
Customers can exist without login accounts. Preserve original order date as
`placedAt`, not the new record's `createdAt`. Preserve old tracking identifiers
in `legacyTrackingNumber`.

Old `status_purchase` is ambiguous. Use `legacy_review` for unresolved order
and payment states, `legacy_unknown` as payment method, and retain old slip
paths privately. Do not infer payment success from a boolean or file path.
Do not infer old inventory opening balances from incomplete sales history.
Confirm size/concentration before backfilling them; no size is invented and
concentration defaults to `unspecified`.

Migrate only validated geographic reference data: old districts mix district
and subdistrict names. Preserve historical addresses verbatim; record missing
required address values in an explicit migration exception process rather than
inventing names. Reconcile order/item totals before importing; retain/report
any discrepancy. Test bcrypt compatibility or arrange password resets, and
never migrate the old unique-password constraint or turn customer roles into
Strapi admin accounts automatically.

References: [Strapi models](https://docs.strapi.io/cms/backend-customization/models),
[Strapi document service](https://docs.strapi.io/cms/api/document-service),
[Stripe webhooks](https://docs.stripe.com/webhooks).

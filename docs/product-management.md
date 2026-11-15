# Storefront product management

The Angular `/product-admin` and `/add-product` screens use the same responsive
editor and the application Admin role. They no longer call legacy product or
upload endpoints. A save publishes the product; `isActive: false` hides it from
the storefront.

## Protected endpoints

- `GET /api/management/products?page=1&search=...&category=<documentId>&active=true`
  returns 12 draft documents per page, their images/categories/variants, category
  options and pagination. Draft counterparts represent the complete management
  collection, including hidden products.
- `POST /api/management/products` creates a product with 1–30 SKUs.
- `PUT /api/management/products/:documentId` atomically updates the product and
  all supplied SKUs. Include every existing SKU; disable old SKUs rather than
  removing them. Supply `expectedUpdatedAt` from the list, plus each existing
  variant's `expectedStockOnHand` to detect stale edits.
- `DELETE /api/management/products/:documentId` archives the product, disables
  its variants and unpublishes it. Archived products leave both lists while
  historical order/inventory relations remain intact. Products with reserved
  stock cannot be deleted until reservations are released.
- `POST /api/upload` handles optional cover uploads through Strapi's media
  library. Only the application Admin role receives the upload permission.

Write bodies use `{data: {name, description, gender, isActive,
images, variants, expectedUpdatedAt?}}`. The selected `gender` is the fragrance
category: the server assigns the published active category whose slug is
`male`, `female` or `unisex`, replacing the previous relationship on edit.
Legacy `categories` inputs are ignored. Images are numeric media ids.
Each variant contains `documentId?`, `sku`, `label`,
`price`, `stockOnHand`, `isActive`, `expectedStockOnHand?`. Currency is THB for
new variants. Existing size, concentration and variant images are preserved.

All product/variant writes use one database transaction. Variant rows are locked
in id order, using the same locks as checkout. Reserved stock is server-managed
and cannot be overwritten by the editor. Stock changes create inventory
movements. Validation rejects duplicate SKUs, foreign variant ids, invalid
prices/stock, unavailable categories and non-image media.

The frontend waits for uploads to complete before saving, retains uploaded
media ids for retries, prevents repeated submissions, keeps unsaved form values
after errors, and uses the shared four-second Alert for all results. The editor
supports Thai/English, keyboard focus trapping, Escape and focus restoration.

Run `npm run check:products` on a local development database to exercise real
image upload, multi-SKU create/edit, publication, validation, stale edits,
stock reservations, access denial and archive behavior. Fixtures are removed.

`node scripts/repair-product-categories.cjs` fills missing category relationships
from each product's existing gender. It preserves draft/published content,
existing category relationships, prices, inventory and archived products.

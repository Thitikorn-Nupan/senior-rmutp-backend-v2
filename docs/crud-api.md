# Management CRUD APIs

All 16 commerce content types now have standard Strapi core routers,
controllers and services. These generate 78 CRUD routes. The `catalog` API
remains a separate public, read-only API for the Angular storefront.

## Structure

For example:

```text
src/api/product/
  content-types/product/schema.json
  routes/product.ts
  controllers/product.ts
  services/product.ts
```

Each file uses `createCoreRouter`, `createCoreController` or `createCoreService`.
The factories implement schema validation, query handling, response sanitization
and database operations; these files are extension points for later custom logic.
The global `management-api-token` policy is applied to every CRUD action.

## Authentication

Use a **Content API Token** from Strapi Admin > Settings > API Tokens.
Send `Authorization: Bearer <API_TOKEN>` on CRUD requests. A Read-only token
can read, and a Custom token can call only the explicitly selected actions.
A Full access token can call all these management CRUD actions.

The policy accepts only Strapi's `content-api-token` authentication strategy.
Anonymous callers, customer JWTs from `/api/auth/local`, and admin panel JWTs
cannot use these CRUD routes. Enabling Users & Permissions role actions does
not bypass this policy. No existing role permissions are changed by this code.
Keep management tokens on trusted clients such as a backend or local API client;
do not embed them in the Angular application.

Customer-owned address/order endpoints with ownership checks belong in a later
customer API. This management API intentionally does not accept customer JWTs.
Strapi's Admin Content Manager continues to use its own admin endpoints and RBAC.

## Collection endpoints

For every collection base path below:

| Method | Path | Core action |
| --- | --- | --- |
| GET | `/api/{collection}` | find (list) |
| GET | `/api/{collection}/{documentId}` | findOne |
| POST | `/api/{collection}` | create |
| PUT | `/api/{collection}/{documentId}` | update |
| DELETE | `/api/{collection}/{documentId}` | delete |

| Content type | Collection base path |
| --- | --- |
| Brand | `/api/brands` |
| Customer Address | `/api/customer-addresses` |
| Customer Profile | `/api/customer-profiles` |
| District | `/api/districts` |
| Inventory Movement | `/api/inventory-movements` |
| Order | `/api/orders` |
| Order Item | `/api/order-items` |
| Payment | `/api/payments` |
| Payment Event | `/api/payment-events` |
| Product | `/api/products` |
| Product Category | `/api/product-categories` |
| Product Variant | `/api/product-variants` |
| Province | `/api/provinces` |
| Stock Reservation | `/api/stock-reservations` |
| Subdistrict | `/api/subdistricts` |

Use Strapi 5 `documentId` strings for detail/update/delete and relation references,
not the numeric database `id`. Successful creates return 201, reads/updates 200,
and deletes 204 with no JSON body. Missing detail documents return 404.

## Single type

Store Setting has one document and three routes:

| Method | Path | Action |
| --- | --- | --- |
| GET | `/api/store-setting` | Read settings (404 until created) |
| PUT | `/api/store-setting` | Create or update settings |
| DELETE | `/api/store-setting` | Delete settings |

There is no POST or documentId suffix for this Single Type.

## Request examples

Base URL in local development: `http://localhost:1337`.
For POST/PUT, use `Content-Type: application/json` with the Strapi `data` envelope.

Create a published brand: `POST /api/brands?status=published`

```json
{
  "data": {
    "name": "Example Brand",
    "slug": "example-brand",
    "description": "Example description",
    "isActive": true
  }
}
```

Update: `PUT /api/brands/{documentId}?status=published`

```json
{
  "data": {
    "description": "Updated description"
  }
}
```

Product list with standard query options:

```text
GET /api/products?filters[name][$containsi]=rose&sort=name:asc&pagination[page]=1&pagination[pageSize]=10
GET /api/products/{documentId}?populate=images
GET /api/products?status=draft
```

Responses use `{ "data": ..., "meta": ... }`; list responses contain pagination
metadata. Relations/media are not populated unless requested with `populate`.
Fields and required relations for each type are defined in its `schema.json`.
Brand, Product and Product Category support Draft & Publish: creates default
to draft unless `status=published` is specified; GET defaults to published.
Management reads can include inactive records. The storefront should continue
using `/api/catalog/*`, which enforces published/active filtering and fixed fields.

## Commerce behavior

These are schema-level management operations. Updating an order/payment status
does not charge a customer, verify a slip, reserve stock, settle a payment or
create an inventory movement. Cross-field rules, customer ownership, reference
deletion guards, checkout and settlement services are still separate work.
Use `isActive` to archive catalog data referenced by purchases rather than
deleting it. Restrict token actions before using the API with real transactions.

## Checks

```powershell
npx tsc --noEmit
npm run build
npm run check:crud
npm run check:storefront
```

Run integration checks only against a development/test database. Checks compile
and load Strapi and open an ephemeral local HTTP port. `check:crud` verifies all
78 routes, anonymous denial, token reads for all types, complete brand CRUD,
validation, query handling, token scopes and rejection of a customer JWT even
when its temporary role grants the action. It does not create/update/delete
fixtures for every financial/customer schema or mutate an existing Store Setting.
Temporary tokens/users/roles/brand fixtures are removed in cleanup. The existing
storefront check requires a seeded catalog and verifies login and catalog reads.

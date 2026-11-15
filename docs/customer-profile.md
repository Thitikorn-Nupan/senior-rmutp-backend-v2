# Customer profiles

`Customer Profile` is the existing commerce collection, extended with a private inverse
`User.profile` one-to-one relation, `displayName`, an image `avatar`, and an optional
`shippingAddress` contact component. Email remains on Users & Permissions User.
Existing profile/order/address relations are retained. Names can be empty until the
customer completes their profile; saving through the self-service API requires both names.

Bootstrap creates missing profiles for existing users. A User database lifecycle creates
one for new registrations. Creation and edits lock the owning User row, as checkout does,
to serialize concurrent requests. Existing order address snapshots are unchanged.

Authenticated User and app Admin roles receive these owner-only routes:

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/profile/me` | None |
| PUT | `/api/profile/me` | `{data: {firstName, lastName, displayName, phone, shippingAddress}}` |
| POST | `/api/profile/me/avatar` | Multipart field `avatar` (one file) |
| DELETE | `/api/profile/me/avatar` | None |

All routes return `{data: profile}` and require a Users & Permissions bearer token.
The authenticated User ID determines ownership; client-supplied owner IDs and avatar
references are rejected. Responses expose only an explicit profile field list. The
existing generic CRUD routes remain management-only.

Contact address fields: `addressLine1`, `addressLine2`, `subdistrict`, `district`,
`province`, `postalCode`, `countryCode` (`TH`). Address and phone are optional;
non-empty postal codes must contain five digits. This is a contact address and does
not bypass checkout's location validation or automatically replace checkout input.

Avatar uploads accept real JPEG, PNG and WebP images up to 5 MB / 25 megapixels.
Images are decoded, stripped of metadata and converted to a square WebP up to 512px.
Only the custom route is granted to customers, not generic Media Library uploads.
Removing/replacing the profile reference retains the previous media-library file;
admins can manage unused media separately. Avatar files use the public media provider,
so they should not contain private identity documents.

Run `npm run check:profile` against a development/test database. The script creates
temporary users and images, tests authorization, validation and avatar operations,
then removes its fixtures. Run `npm run dev` to start the backend on port 1337.

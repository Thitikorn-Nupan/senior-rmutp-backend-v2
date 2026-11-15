# Application roles

The User collection uses the built-in Users & Permissions `role` relation:

| Name | Stable type | Frontend role |
| --- | --- | --- |
| User | authenticated | ROLE_USER |
| Admin | app-admin | ROLE_ADMIN |

These are storefront roles, separate from Strapi admin-panel accounts. Change an
existing user's Role in the Strapi Content Manager. Public registration accepts
only username, email and password and defaults to User. It never infers Admin
rights from newly supplied email addresses.

Bootstrap creates the Admin role, names the authenticated role User, sets the
registration default, and grants commerce permissions. Login, registration and
`GET /api/users/me` return a safe `user.role` summary containing id, name and type.
Frontend login maps that type to its existing menu and route guard roles.

The one-time `app-role-migration-v1` bootstrap migration assigns existing emails
matching `/^adminv[^@\s]*@[^@\s]+$/i` to Admin and other existing accounts to User.
Its completion time, checked count, changed user ids and prior role ids are stored
in the Users & Permissions plugin store. Later restarts do not promote new
`adminv` registrations or overwrite manual role edits. Existing browser sessions
need a fresh login to receive the updated frontend role.

Both roles retain customer checkout actions with ownership checks. Only Admin
and appropriately scoped management API tokens pass commerce CRUD policies.
Changing browser session data does not grant API permissions; Strapi reads the
current role from its database. App Admin JWTs cannot edit users or roles.

Product management now uses the protected Strapi workflow documented in
`product-management.md`. The older sales report services still call legacy API
URLs; Strapi JWTs do not authenticate against that legacy server.

Validation: `npm run check:roles` exercises temporary users against real HTTP
endpoints and cleans them up. `npm run check:crud` verifies existing token scopes
and customer isolation. Use a local development database.

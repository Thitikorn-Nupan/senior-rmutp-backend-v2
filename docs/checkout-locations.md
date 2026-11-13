# Checkout locations

`npm run seed:locations` imports the supplied four provinces and 32 districts
from `data/checkout-locations.json` through Strapi's Document Service. Each
province has eight districts. Running it again reuses matching records and
checks their relationships; conflicting codes abort the transaction.

The supplied `pid` and `did` values are stored as string `code` values. Strapi
assigns its own database IDs and document IDs. These are sample codes, not
official administrative codes. Names and groupings are preserved exactly as
provided. Because only English names were supplied, both the required `nameTh`
and optional `nameEn` fields contain that English name.

Checkout reads `GET /api/locations/provinces` and
`GET /api/locations/districts?province=<Strapi database ID>`. Responses expose
fixed location fields only. The existing management CRUD endpoints retain
their API-token policy. Verify the imported data and HTTP API with
`npm run check:locations`.

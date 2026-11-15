# Checkout locations

`npm run seed:locations` imports a pinned, MIT-licensed snapshot of Thai administrative
names from https://github.com/thailand-geography-data/thailand-geography-json
(commit `021d18e9a481bc141ea87de4ddeebe843cff2f12`). The upstream files are
`src/provinces.json` and `src/districts.json`; provenance is included in
`data/checkout-locations.json`, and the license is in `data/checkout-locations.LICENSE`.

The selected checkout dataset has **20 provinces and 387 districts**, including all
available districts for each selected province (at least ten per province).
Thai/English names and administrative codes are stored separately. Strapi database IDs
remain distinct from administrative codes.

## Data migration

The previous four-province sample is retained at `data/checkout-locations.legacy.json`.
Some old district records were actually subdistricts. Nonthaburi and Samut Sakhon have
fewer than ten real districts and are excluded from this selected checkout dataset.

Before importing, the script backs up all current province/district records and their
relations to `.private/location-backups/<timestamp>.json`. It reuses matching existing
records, updates their names/codes, and inserts missing records in a transaction.
Unselected or invalid sample records are retained with `isCheckoutEnabled: false`.
No records or order-address snapshots are deleted. Run the import while the backend
is stopped. Re-running it creates no duplicate records.

Both the public location API and checkout address validation require
`isCheckoutEnabled: true`. New records default to enabled. Management CRUD retains
its existing token policy.

## Verification

- `npm run check:locations`: asserts exactly twenty selectable provinces, all 387
  district names/codes and parent links, at least ten districts per province, and
  exclusion of archived data; also checks invalid queries and management protection.
- `npm run check:checkout`: checks order creation, address validation and payment flow.
- Frontend `checkout-locations.spec.ts` renders the checkout form with the imported
  names and tests all twenty province selections, all district options, scrollable
  menus, independent billing selection and copying the shipping address. Its fixture
  is a test-only copy of the pinned data, with IDs used solely for simulated API responses.

The API endpoints are `GET /api/locations/provinces` and
`GET /api/locations/districts?province=<Strapi database ID>`. Checkout currently displays
English names, consistent with its existing English form. Thai names are also available
in the API. Districts sharing an English name are shown with Thai names in parentheses; their Thai name is submitted to identify the selected district. Subdistrict and postal-code inputs remain manual.

## Selected provinces

| Code | Province | Districts |
| --- | --- | ---: |
| 10 | กรุงเทพมหานคร / Bangkok | 50 |
| 14 | พระนครศรีอยุธยา / Phra Nakhon Si Ayutthaya | 16 |
| 16 | ลพบุรี / Lop Buri | 11 |
| 19 | สระบุรี / Saraburi | 13 |
| 20 | ชลบุรี / Chon Buri | 11 |
| 22 | จันทบุรี / Chanthaburi | 10 |
| 24 | ฉะเชิงเทรา / Chachoengsao | 11 |
| 30 | นครราชสีมา / Nakhon Ratchasima | 32 |
| 31 | บุรีรัมย์ / Buri Ram | 23 |
| 34 | อุบลราชธานี / Ubon Ratchathani | 25 |
| 40 | ขอนแก่น / Khon Kaen | 26 |
| 41 | อุดรธานี / Udon Thani | 20 |
| 50 | เชียงใหม่ / Chiang Mai | 25 |
| 52 | ลำปาง / Lampang | 13 |
| 57 | เชียงราย / Chiang Rai | 18 |
| 60 | นครสวรรค์ / Nakhon Sawan | 15 |
| 70 | ราชบุรี / Ratchaburi | 10 |
| 80 | นครศรีธรรมราช / Nakhon Si Thammarat | 23 |
| 84 | สุราษฎร์ธานี / Surat Thani | 19 |
| 90 | สงขลา / Songkhla | 16 |

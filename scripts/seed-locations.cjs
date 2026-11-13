'use strict';

const assert = require('node:assert/strict');
const {compileStrapi, createStrapi} = require('@strapi/strapi');
const locations = require('../data/checkout-locations.json');

async function main() {
    const app = createStrapi(await compileStrapi());
    try {
        await app.load();
        const provinces = app.documents('api::province.province');
        const districts = app.documents('api::district.district');
        const created = {provinces: 0, districts: 0};
        await app.db.transaction(async () => {
            const parents = new Map();
            for (const sample of locations.provinces) {
                const code = String(sample.pid);
                let entry = await provinces.findFirst({filters: {code}});
                if (entry) {
                    assert.equal(entry.nameEn, sample.name, `Province code ${code} already has a different name.`);
                } else {
                    // Only English names were supplied. Preserve them verbatim in the
                    // required nameTh field too; do not invent translations or official codes.
                    entry = await provinces.create({data: {code, nameTh: sample.name, nameEn: sample.name}});
                    created.provinces++;
                }
                parents.set(sample.pid, entry.documentId);
            }
            for (const sample of locations.districts) {
                const code = String(sample.did);
                const province = parents.get(sample.pid);
                assert.ok(province, `Missing province ${sample.pid}`);
                const existing = await districts.findFirst({filters: {code}, populate: {province: true}});
                if (existing) {
                    assert.equal(existing.nameEn, sample.name, `District code ${code} already has a different name.`);
                    assert.equal(existing.province?.documentId, province, `District ${code} belongs to another province.`);
                } else {
                    await districts.create({data: {code, nameTh: sample.name, nameEn: sample.name, province}});
                    created.districts++;
                }
            }
            for (const sample of locations.provinces) {
                const rows = await districts.findMany({
                    filters: {province: {documentId: parents.get(sample.pid)}}, fields: ['code', 'nameEn'], limit: 100,
                });
                const expected = locations.districts.filter(d => d.pid === sample.pid);
                for (const district of expected) {
                    assert.ok(rows.some(row => row.code === String(district.did) && row.nameEn === district.name));
                }
            }
        });
        console.log(JSON.stringify({
            created,
            verified: {provinces: 4, districts: 32, districtsPerProvince: 8}
        }, null, 2));
    } finally {
        await app.destroy();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

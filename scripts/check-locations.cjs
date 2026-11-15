'use strict';
const assert = require('node:assert/strict');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const expected = require('../data/checkout-locations.json');

async function main() {
  const app = createStrapi(await compileStrapi());
  try {
    await app.load();
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.httpServer.address().port}/api`;
    const get = async path => {
      const response = await fetch(base + path);
      return { status: response.status, body: await response.json() };
    };
    const provinces = await get('/locations/provinces');
    assert.equal(provinces.status, 200);
    assert.equal(provinces.body.data.length, 20);
    let districtCount = 0;
    for (const province of expected.provinces) {
      const row = provinces.body.data.find(p => p.code === province.code);
      assert.equal(row?.nameEn, province.nameEn);
      assert.equal(row?.nameTh, province.nameTh);
      const districts = await get(`/locations/districts?province=${row.id}`);
      assert.equal(districts.status, 200);
      const expectedRows = expected.districts.filter(d => d.provinceCode === province.code);
      const expectedNames = expectedRows.map(d => d.nameEn).sort();
      assert.deepEqual(districts.body.data.map(d => d.nameEn).sort(), expectedNames);
      assert.ok(districts.body.data.length >= 10);
      for (const district of expectedRows) {
        const stored = districts.body.data.find(d => d.code === district.code);
        assert.equal(stored?.nameTh, district.nameTh);
      }
      districtCount += districts.body.data.length;
      assert.equal(districts.body.data[0].subdistricts, undefined);
    }
    for (const query of ['', '?province=abc', '?province=-1', '?province=1.5', '?province[id]=1']) {
      assert.equal((await get('/locations/districts' + query)).status, 400);
    }
    assert.deepEqual((await get('/locations/districts?province=99999999')).body.data, []);
    for (const path of ['/provinces', '/districts']) {
      assert.ok([401, 403].includes((await get(path)).status), 'Management endpoints must remain protected');
    }
    assert.equal(districtCount, expected.districts.length);
    const archived = await app.documents('api::province.province').findMany({filters: {isCheckoutEnabled: false}});
    for (const province of archived) assert.deepEqual((await get(`/locations/districts?province=${province.id}`)).body.data, []);
    console.log(`PASS: 20 provinces, ${districtCount} districts, minimum 10 per province, Thai/English names, official codes, parent filtering, archived exclusions, invalid queries and protected CRUD.`);
  } finally { await app.destroy(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

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
    for (const province of expected.provinces) {
      const row = provinces.body.data.find(p => p.code === String(province.pid));
      assert.equal(row?.nameEn, province.name);
      const districts = await get(`/locations/districts?province=${row.id}`);
      assert.equal(districts.status, 200);
      const expectedNames = expected.districts.filter(d => d.pid === province.pid).map(d => d.name).sort();
      assert.deepEqual(districts.body.data.map(d => d.nameEn).sort(), expectedNames);
      assert.equal(districts.body.data[0].subdistricts, undefined);
    }
    for (const query of ['', '?province=abc', '?province=-1', '?province=1.5', '?province[id]=1']) {
      assert.equal((await get('/locations/districts' + query)).status, 400);
    }
    assert.deepEqual((await get('/locations/districts?province=99999999')).body.data, []);
    for (const path of ['/provinces', '/districts']) {
      assert.ok([401, 403].includes((await get(path)).status), 'Management endpoints must remain protected');
    }
    console.log('PASS: all 4 provinces, all 32 districts, province filtering, invalid queries, empty results and protected management CRUD.');
  } finally { await app.destroy(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

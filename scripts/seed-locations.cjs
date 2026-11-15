'use strict';
const assert = require('node:assert/strict');
const {mkdir, writeFile} = require('node:fs/promises');
const path = require('node:path');
const {compileStrapi, createStrapi} = require('@strapi/strapi');
const locations = require('../data/checkout-locations.json');
const normalize = value => String(value ?? '').toLowerCase().replace(/[\s-]/g, '');

async function main() {
  assert.equal(locations.provinces.length, 20);
  assert.equal(new Set(locations.provinces.map(p => p.code)).size, 20);
  assert.equal(new Set(locations.districts.map(d => d.code)).size, locations.districts.length);
  for (const province of locations.provinces) {
    assert.ok(locations.districts.filter(d => d.provinceCode === province.code).length >= 10);
  }
  const app = createStrapi(await compileStrapi());
  try {
    await app.load();
    const provinces = app.documents('api::province.province'), districts = app.documents('api::district.district');
    const oldProvinces = await provinces.findMany({limit: 1000});
    const oldDistricts = await districts.findMany({populate: {province: true, subdistricts: true}, limit: 10000});
    const backupDir = path.join(app.dirs.app.root, '.private/location-backups');
    await mkdir(backupDir, {recursive: true});
    const backupPath = path.join(backupDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(backupPath, JSON.stringify({createdAt: new Date().toISOString(), provinces: oldProvinces, districts: oldDistricts}, null, 2));
    const counts = {provincesCreated: 0, provincesUpdated: 0, districtsCreated: 0, districtsUpdated: 0, provincesArchived: 0, districtsArchived: 0};
    await app.db.transaction(async () => {
      const selectedProvinces = new Set(), selectedDistricts = new Set(), parents = new Map();
      for (const sample of locations.provinces) {
        const coded = oldProvinces.filter(p => p.code === sample.code);
        const candidates = coded.length ? coded : oldProvinces.filter(p => normalize(p.nameEn) === normalize(sample.nameEn) || p.nameTh === sample.nameTh);
        assert.ok(candidates.length <= 1, `Ambiguous existing province ${sample.nameEn}`);
        const data = {...sample, isCheckoutEnabled: true};
        const entry = candidates[0]
          ? await provinces.update({documentId: candidates[0].documentId, data}) : await provinces.create({data});
        counts[candidates[0] ? 'provincesUpdated' : 'provincesCreated']++;
        selectedProvinces.add(entry.documentId); parents.set(sample.code, entry.documentId);
      }
      for (const sample of locations.districts) {
        const parent = parents.get(sample.provinceCode);
        assert.ok(parent, `Missing province for district ${sample.code}`);
        // Distinct Thai district names can have identical English transliterations (e.g. Bang Sai).
        // Administrative code takes precedence on subsequent imports.
        const coded = oldDistricts.filter(d => d.code === sample.code);
        const candidates = coded.length ? coded : oldDistricts.filter(d => d.province?.documentId === parent &&
          (normalize(d.nameEn) === normalize(sample.nameEn) || d.nameTh === sample.nameTh));
        assert.ok(candidates.length <= 1, `Ambiguous existing district ${sample.code}`);
        if (candidates[0]) assert.equal(candidates[0].province?.documentId, parent, `District ${sample.code} already belongs to another province`);
        const data = {code: sample.code, nameTh: sample.nameTh, nameEn: sample.nameEn, province: parent, isCheckoutEnabled: true};
        const entry = candidates[0]
          ? await districts.update({documentId: candidates[0].documentId, data}) : await districts.create({data});
        counts[candidates[0] ? 'districtsUpdated' : 'districtsCreated']++;
        selectedDistricts.add(entry.documentId);
      }
      for (const row of oldDistricts) if (!selectedDistricts.has(row.documentId) && row.isCheckoutEnabled !== false) {
        await districts.update({documentId: row.documentId, data: {isCheckoutEnabled: false}}); counts.districtsArchived++;
      }
      for (const row of oldProvinces) if (!selectedProvinces.has(row.documentId) && row.isCheckoutEnabled !== false) {
        await provinces.update({documentId: row.documentId, data: {isCheckoutEnabled: false}}); counts.provincesArchived++;
      }
      assert.equal(await provinces.count({filters: {isCheckoutEnabled: true}}), 20);
      assert.equal(await districts.count({filters: {isCheckoutEnabled: true}}), locations.districts.length);
    });
    console.log(JSON.stringify({backupPath, counts, verified: {provinces: 20, districts: locations.districts.length, minimumDistrictsPerProvince: 10}}, null, 2));
  } finally { await app.destroy(); }
}
main().catch(error => {console.error(error); process.exitCode = 1;});

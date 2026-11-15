'use strict';
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {compileStrapi, createStrapi} = require('@strapi/strapi');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Use a development/test database');
  const app = createStrapi(await compileStrapi());
  const userIds = [], productIds = [], imageIds = [];
  const marker = `management-check-${randomUUID()}`;
  try {
    await app.load();
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${app.server.httpServer.address().port}/api`;
    const request = async (method, path, token, data) => {
      const response = await fetch(url + path, {method, headers: {
        ...(token ? {Authorization: `Bearer ${token}`} : {}), ...(data && !(data instanceof FormData) ? {'Content-Type': 'application/json'} : {}),
      }, ...(data ? {body: data instanceof FormData ? data : JSON.stringify({data})} : {})});
      return {status: response.status, body: await response.json()};
    };
    const tokens = {};
    for (const type of ['authenticated', 'app-admin']) {
      const role = await app.db.query('plugin::users-permissions.role').findOne({where: {type}});
      const user = await app.plugin('users-permissions').service('user').add({username: `${marker}-${type}`, email: `${marker}-${type}@example.invalid`, password: randomUUID(), provider: 'local', confirmed: true, blocked: false, role: role.id});
      userIds.push(user.id);
      tokens[type] = await app.plugin('users-permissions').service('jwt').issue({id: user.id});
    }
    const admin = tokens['app-admin'], customer = tokens.authenticated;
    assert.ok([401,403].includes((await request('GET', '/management/products')).status));
    assert.equal((await request('GET', '/management/products', customer)).status, 403);
    const image = new FormData();
    const png = await require('sharp')({create: {width: 16, height: 16, channels: 3, background: '#edf3eb'}}).png().toBuffer();
    image.append('files', new Blob([png], {type: 'image/png'}), `${marker}.png`);
    const upload = await request('POST', '/upload', admin, image);
    assert.equal(upload.status, 201, `Upload: ${JSON.stringify(upload.body)}`);
    imageIds.push(upload.body[0].id);
    const category = await app.documents('api::product-category.product-category').findFirst({status: 'published', filters: {slug: 'female', isActive: true}});
    const maleCategory = await app.documents('api::product-category.product-category').findFirst({status: 'published', filters: {slug: 'male', isActive: true}});
    assert.ok(category && maleCategory, 'Seed the fragrance categories first');
    const data = {name: marker, description: 'Managed fragrance', gender: 'female', isActive: true, images: imageIds,
      variants: [{sku: `${marker}-30`, label: '30 ml', price: '490.00', stockOnHand: 10, isActive: true}, {sku: `${marker}-50`, label: '50 ml', price: '790.00', stockOnHand: 20, isActive: true}]};
    const created = await request('POST', '/management/products', admin, data);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const product = created.body.data;
    productIds.push(product.documentId);
    assert.deepEqual(product.categories.map(c => c.documentId), [category.documentId], 'Female fragrance must be linked to the female category without a categories input');
    assert.equal((await request('GET', `/management/products?search=${marker}&category=${category.documentId}`, admin)).body.meta.pagination.total, 1);
    const publicCategory = await request('GET', `/catalog/products?category=${category.id}`);
    assert.ok(publicCategory.body.data.some(row => row.documentId === product.documentId), 'Product must appear in its storefront category');
    assert.equal(product.variants.length, 2);
    assert.equal(product.images[0].id, imageIds[0]);
    assert.equal((await request('GET', `/catalog/products/${product.documentId}`)).status, 200);
    let list = await request('GET', `/management/products?search=${marker}`, admin);
    assert.equal(list.body.meta.pagination.total, 1);
    assert.equal(list.body.data[0].documentId, product.documentId);
    const edit = {...data, gender: 'male', categories: [category.documentId], expectedUpdatedAt: product.updatedAt, variants: product.variants.map(v => ({...v, expectedStockOnHand: v.stockOnHand, price: '599.00', stockOnHand: v.stockOnHand + 2}))};
    const updated = await request('PUT', `/management/products/${product.documentId}`, admin, edit);
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.deepEqual(updated.body.data.categories.map(c => c.documentId), [maleCategory.documentId], 'Changing group must replace the old category, including legacy stale payloads');
    assert.equal((await request('GET', `/management/products?search=${marker}&category=${category.documentId}`, admin)).body.meta.pagination.total, 0);
    assert.equal(updated.body.data.variants.length, 2);
    assert.equal(updated.body.data.variants[0].stockOnHand, product.variants[0].stockOnHand + 2);
    assert.equal((await request('PUT', `/management/products/${product.documentId}`, admin, edit)).status, 400, 'Stale product edit rejected');
    const fresh = updated.body.data;
    const invalid = {...edit, name: `${marker}-bad`, expectedUpdatedAt: fresh.updatedAt, variants: fresh.variants.map(v => ({...v, expectedStockOnHand: v.stockOnHand}))};
    invalid.variants[0].price = '-1';
    assert.equal((await request('PUT', `/management/products/${product.documentId}`, admin, invalid)).status, 400);
    list = await request('GET', `/management/products?search=${marker}`, admin);
    assert.equal(list.body.data[0].name, marker, 'Invalid update must not partially mutate product');
    const duplicate = await request('POST', '/management/products', admin, data);
    assert.equal(duplicate.status, 400);
    assert.equal((await request('GET', `/management/products?search=${marker}`, admin)).body.meta.pagination.total, 1);
    const variant = fresh.variants[0];
    await app.documents('api::product-variant.product-variant').update({documentId: variant.documentId, data: {stockReserved: 5}});
    const reservation = {...edit, expectedUpdatedAt: fresh.updatedAt, variants: fresh.variants.map(v => ({...v, expectedStockOnHand: v.stockOnHand, stockOnHand: 1}))};
    assert.equal((await request('PUT', `/management/products/${product.documentId}`, admin, reservation)).status, 400);
    assert.equal((await request('DELETE', `/management/products/${product.documentId}`, admin)).status, 400);
    await app.documents('api::product-variant.product-variant').update({documentId: variant.documentId, data: {stockReserved: 0}});
    assert.equal((await request('DELETE', `/management/products/${product.documentId}`, customer)).status, 403);
    assert.equal((await request('DELETE', `/management/products/${product.documentId}`, admin)).status, 200);
    assert.equal((await request('GET', `/management/products?search=${marker}`, admin)).body.meta.pagination.total, 0);
    assert.equal((await request('GET', `/catalog/products/${product.documentId}`)).status, 404);
    assert.ok(await app.documents('api::product-variant.product-variant').findOne({documentId: variant.documentId}), 'Historical variant retained');
    console.log('PASS: Admin image upload, multi-SKU create/update, publication, filtering, stale edits, validation, rollback, SKU uniqueness, stock reservations, access control and archive deletion.');
  } finally {
    for (const documentId of productIds) {
      const product = await app.documents('api::product.product').findOne({documentId, status: 'draft', populate: {variants: true}});
      for (const variant of product?.variants ?? []) {
        const movements = await app.documents('api::inventory-movement.inventory-movement').findMany({filters: {variant: {documentId: variant.documentId}}});
        for (const row of movements) await app.documents('api::inventory-movement.inventory-movement').delete({documentId: row.documentId});
        await app.documents('api::product-variant.product-variant').delete({documentId: variant.documentId});
      }
      await app.documents('api::product.product').delete({documentId});
    }
    for (const id of imageIds) { const file = await app.db.query('plugin::upload.file').findOne({where: {id}}); if (file) await app.plugin('upload').service('upload').remove(file); }
    for (const id of userIds) {
      await app.sessionManager('users-permissions').invalidateRefreshToken(String(id));
      await app.db.query('plugin::users-permissions.user').delete({where: {id}});
    }
    await app.destroy();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});

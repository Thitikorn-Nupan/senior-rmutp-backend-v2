'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Use a development/test database.');
  const app = createStrapi(await compileStrapi());
  const fixtureDocuments = [];
  let user;
  try {
    await app.load();
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.httpServer.address().port}/api`;
    const request = async (path, options) => {
      const response = await fetch(base + path, options);
      return { status: response.status, body: await response.json() };
    };
    const catalog = await request('/catalog/products');
    assert.equal(catalog.status, 200);
    assert.ok(catalog.body.data.length > 0, 'Seed the demo catalog first');
    const first = catalog.body.data[0];
    assert.ok(first.variants.length > 0);
    assert.equal(first.legacyId, undefined);
    assert.equal(first.variants[0].orderItems, undefined);
    const detail = await request(`/catalog/products/${first.documentId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.documentId, first.documentId);
    const categories = await request('/catalog/categories');
    assert.equal(categories.status, 200);
    for (const category of categories.body.data) {
      const filtered = await request(`/catalog/products?category=${category.id}`);
      assert.equal(filtered.status, 200);
      assert.ok(filtered.body.data.every(p => p.categories.some(c => c.id === category.id)));
    }
    const search = await request(`/catalog/products?search=${encodeURIComponent(first.name.toUpperCase())}`);
    assert.ok(search.body.data.some(p => p.documentId === first.documentId));
    assert.equal((await request('/catalog/products?search=no-such-product-check-123')).body.data.length, 0);
    const page = await request('/catalog/products?page=2&pageSize=1');
    assert.equal(page.body.data.length, 1);
    assert.notEqual(page.body.data[0].documentId, first.documentId);
    for (const query of ['page=0', 'pageSize=101', 'category=abc', 'search[x]=bad']) {
      assert.equal((await request(`/catalog/products?${query}`)).status, 400);
    }
    assert.equal((await request('/catalog/products/nonexistent')).status, 404);

    const marker = `storefront-check-${randomUUID()}`;
    for (const active of [true, false]) {
      const product = await app.documents('api::product.product').create({
        ...(active ? {} : { status: 'published' }),
        data: { name: marker, slug: `${marker}-${active}`, gender: 'unisex', isActive: active },
      });
      fixtureDocuments.push(product.documentId);
      assert.equal((await request(`/catalog/products/${product.documentId}`)).status, 404);
    }
    assert.equal((await request(`/catalog/products?search=${marker}`)).body.data.length, 0);

    const role = await app.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });
    const password = randomUUID();
    user = await app.plugin('users-permissions').service('user').add({
      username: marker, email: `${marker}@example.invalid`, password,
      provider: 'local', confirmed: true, blocked: false, role: role.id,
    });
    const login = identifier => request('/auth/local', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    for (const identifier of [user.username, user.email]) {
      const result = await login(identifier);
      assert.equal(result.status, 200);
      assert.ok(result.body.jwt);
      assert.equal(result.body.user.id, user.id);
      assert.equal(result.body.user.password, undefined);
    }
    assert.equal((await login('nonexistent@example.invalid')).status, 400);
    console.log('PASS: catalog, categories, search, pagination, detail, hidden drafts/inactive products, login by username/email and rejected login.');
  } finally {
    if (user) await app.db.query('plugin::users-permissions.user').delete({ where: { id: user.id } });
    for (const documentId of fixtureDocuments) await app.documents('api::product.product').delete({ documentId });
    await app.destroy();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

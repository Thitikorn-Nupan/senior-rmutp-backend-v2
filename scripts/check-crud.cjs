'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Use a development/test database.');
  const app = createStrapi(await compileStrapi());
  const tokens = [];
  const marker = `crud-check-${randomUUID()}`;
  let brandDocumentId;
  let role;
  let user;
  try {
    await app.load();
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.httpServer.address().port}/api`;
    const tokenService = app.service('admin::api-token-content-api');
    const management = await tokenService.create({ name: `${marker}-management`, type: 'full-access', lifespan: 604800000 });
    tokens.push(management.id);
    const reader = await tokenService.create({ name: `${marker}-reader`, type: 'read-only', lifespan: 604800000 });
    tokens.push(reader.id);
    const scoped = await tokenService.create({
      name: `${marker}-scoped`, type: 'custom', lifespan: 604800000,
      permissions: ['api::brand.brand.find'],
    });
    tokens.push(scoped.id);
    const request = async (method, path, key, data) => {
      const response = await fetch(base + path, {
        method,
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
        ...(data ? { body: JSON.stringify({ data }) } : {}),
      });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    };

    const types = Object.values(app.contentTypes).filter(type => type.uid.startsWith('api::'));
    let routeCount = 0;
    for (const type of types) {
      const name = type.info.singularName;
      const router = app.api(name).routes[name];
      assert.ok(router, `${name}: missing core router`);
      assert.ok(app.controller(type.uid), `${name}: missing controller`);
      assert.ok(app.service(type.uid), `${name}: missing service`);
      const actions = type.kind === 'singleType' ? ['find', 'update', 'delete'] : ['find', 'findOne', 'create', 'update', 'delete'];
      assert.equal(router.routes.length, actions.length, `${name}: route count`);
      for (const action of actions) {
        const route = router.routes.find(route => route.handler === `${type.uid}.${action}`);
        assert.ok(route, `${name}: missing ${action}`);
        assert.notEqual(route.config.auth, false);
        assert.ok(route.config.auth.scope.includes(`${type.uid}.${action}`));
        assert.ok(route.config.policies.includes('global::management-api-token'));
        const result = await request(route.method, route.path.replace(':id', 'nonexistent'));
        assert.ok([401, 403].includes(result.status), `${name}.${action}: anonymous access was ${result.status}`);
        routeCount++;
      }
      const listPath = `/${type.kind === 'singleType' ? name : type.info.pluralName}`;
      const result = await request('GET', listPath, management.accessKey);
      assert.ok([200, ...(type.kind === 'singleType' ? [404] : [])].includes(result.status), `${name}: token read was ${result.status}`);
    }
    assert.equal(types.length, 16);
    assert.equal(routeCount, 78);

    assert.equal((await request('GET', '/brands', reader.accessKey)).status, 200);
    assert.equal((await request('POST', '/brands', reader.accessKey, { name: marker, slug: marker })).status, 403);
    assert.equal((await request('GET', '/brands', scoped.accessKey)).status, 200);
    assert.equal((await request('GET', '/orders', scoped.accessKey)).status, 403);
    assert.equal((await request('POST', '/brands', scoped.accessKey, { name: marker, slug: marker })).status, 403);

    // Even an explicitly granted customer role must not bypass the management policy.
    role = await app.db.query('plugin::users-permissions.role').create({ data: { name: marker, description: 'Temporary CRUD check', type: marker } });
    await app.db.query('plugin::users-permissions.permission').create({ data: { action: 'api::brand.brand.find', role: role.id } });
    user = await app.plugin('users-permissions').service('user').add({
      username: marker, email: `${marker}@example.invalid`, password: randomUUID(),
      provider: 'local', confirmed: true, blocked: false, role: role.id,
    });
    const customerJwt = app.plugin('users-permissions').service('jwt').issue({ id: user.id });
    assert.equal((await request('GET', '/brands', customerJwt)).status, 403);

    const invalid = await request('POST', '/brands', management.accessKey, { name: 'x'.repeat(121), slug: marker });
    assert.equal(invalid.status, 400);
    const created = await request('POST', '/brands?status=published', management.accessKey, { name: marker, slug: marker });
    assert.ok([200, 201].includes(created.status), `Create failed: ${JSON.stringify(created.body)}`);
    brandDocumentId = created.body.data.documentId;
    assert.ok(brandDocumentId);
    assert.equal((await request('GET', `/brands/${brandDocumentId}`, management.accessKey)).status, 200);
    const filtered = await request('GET', `/brands?filters[slug][$eq]=${marker}&pagination[pageSize]=1&sort=name:asc`, management.accessKey);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data[0].documentId, brandDocumentId);
    const updated = await request('PUT', `/brands/${brandDocumentId}?status=published`, management.accessKey, { description: 'Updated through CRUD' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.description, 'Updated through CRUD');
    assert.equal((await request('DELETE', `/brands/${brandDocumentId}`, management.accessKey)).status, 204);
    assert.equal((await request('GET', `/brands/${brandDocumentId}`, management.accessKey)).status, 404);

    assert.equal((await request('GET', '/catalog/products')).status, 200);
    assert.equal((await request('GET', '/catalog/categories')).status, 200);
    console.log(`PASS: ${types.length} content types, ${routeCount} protected CRUD routes, management reads, full brand CRUD, validation/filter/pagination, read-only/custom scopes, rejected customer JWT and public catalog compatibility.`);
  } finally {
    if (brandDocumentId) await app.documents('api::brand.brand').delete({ documentId: brandDocumentId });
    if (user) await app.db.query('plugin::users-permissions.user').delete({ where: { id: user.id } });
    if (role) {
      await app.db.query('plugin::users-permissions.permission').deleteMany({ where: { role: role.id } });
      await app.db.query('plugin::users-permissions.role').delete({ where: { id: role.id } });
    }
    for (const id of tokens) await app.service('admin::api-token-content-api').revoke(id);
    await app.destroy();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

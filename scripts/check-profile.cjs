'use strict';
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {compileStrapi, createStrapi} = require('@strapi/strapi');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Use a development/test database');
  const app = createStrapi(await compileStrapi());
  const userIds = [], imageIds = [];
  const marker = `profile-check-${randomUUID()}`;
  try {
    await app.load();
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${app.server.httpServer.address().port}`;
    const request = async (method, path, token, data) => {
      const response = await fetch(origin + '/api' + path, {method, headers: {
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
        ...(data && !(data instanceof FormData) ? {'Content-Type': 'application/json'} : {}),
      }, ...(data ? {body: data instanceof FormData ? data : JSON.stringify(data)} : {})});
      return {status: response.status, body: await response.json()};
    };
    const tokens = [];
    for (let i = 0; i < 2; i++) {
      const email = `${marker}-${i}@example.invalid`;
      const registered = await request('POST', '/auth/local/register', null, {username: email, email, password: randomUUID() + 'Aa1!'});
      assert.equal(registered.status, 200, JSON.stringify(registered.body));
      userIds.push(registered.body.user.id);
      tokens.push(registered.body.jwt);
      assert.equal(await app.db.query('api::customer-profile.customer-profile').count({where: {user: userIds[i]}}), 1, 'Registration automatically creates exactly one profile');
      assert.equal(registered.body.user.profile, undefined, 'Private relation excluded from auth response');
    }
    const [a, b] = tokens;
    assert.ok([401,403].includes((await request('GET', '/profile/me')).status));
    assert.ok([401,403].includes((await request('PUT', '/profile/me', null, {data: {}})).status));
    const initialB = (await request('GET', '/profile/me', b)).body.data;
    const initial = await request('GET', '/profile/me', a);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.data.firstName, '');
    assert.equal(initial.body.data.user, undefined);
    const documentId = initial.body.data.documentId;
    const input = {firstName: ' Test ', lastName: ' Customer ', displayName: 'Fragrance lover', phone: '0812345678',
      shippingAddress: {addressLine1: '99 Example Road', addressLine2: 'Building A', subdistrict: 'บางซื่อ', district: 'บางซื่อ', province: 'กรุงเทพมหานคร', postalCode: '10800', countryCode: 'TH'}};
    const saved = await request('PUT', '/profile/me', a, {data: input});
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.firstName, 'Test');
    assert.equal(saved.body.data.shippingAddress.postalCode, '10800');
    assert.equal((await request('GET', '/profile/me', a)).body.data.displayName, input.displayName);
    assert.deepEqual((await request('GET', '/profile/me', b)).body.data, initialB, 'User B remains unchanged');
    assert.equal((await request('PUT', '/profile/me', a, {data: {...input, user: userIds[1]}})).status, 400);
    assert.equal((await request('PUT', '/profile/me', a, {data: {...input, avatar: 1}})).status, 400);
    for (const bad of [{firstName: ' '}, {phone: 'invalid-phone'}, {displayName: 'x'.repeat(91)}, {shippingAddress: {...input.shippingAddress, postalCode: 'abc'}}]) {
      assert.equal((await request('PUT', '/profile/me', a, {data: {...input, ...bad}})).status, 400);
    }
    assert.equal((await request('GET', '/profile/me', a)).body.data.firstName, 'Test', 'Invalid writes do not partially mutate data');
    for (const path of ['/customer-profiles', `/customer-profiles/${documentId}`, `/profile/me?populate=*&user=${userIds[1]}`]) {
      const result = await request('GET', path, a);
      if (path.startsWith('/customer-profiles')) assert.equal(result.status, 403);
      else assert.equal(result.body.data.documentId, documentId, 'Query cannot select another user');
    }
    const png = await require('sharp')({create: {width: 24, height: 24, channels: 3, background: '#edf3eb'}}).png().toBuffer();
    const photo = new FormData(); photo.append('avatar', new Blob([png], {type: 'image/png'}), 'avatar.png');
    const uploaded = await request('POST', '/profile/me/avatar', a, photo);
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    imageIds.push(uploaded.body.data.avatar.id);
    assert.ok(uploaded.body.data.avatar.url.endsWith('.webp'));
    assert.equal((await fetch(origin + uploaded.body.data.avatar.url)).status, 200);
    assert.equal((await request('GET', '/profile/me', b)).body.data.avatar, null);
    const invalidPhoto = new FormData(); invalidPhoto.append('avatar', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], {type: 'image/png'}), 'fake.png');
    assert.equal((await request('POST', '/profile/me/avatar', a, invalidPhoto)).status, 400);
    const largePhoto = new FormData(); largePhoto.append('avatar', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], {type: 'image/png'}), 'large.png');
    assert.equal((await request('POST', '/profile/me/avatar', a, largePhoto)).status, 400);
    assert.equal((await request('DELETE', '/profile/me/avatar', a)).body.data.avatar, null);
    assert.equal((await request('GET', '/profile/me', a)).body.data.firstName, 'Test');
    await Promise.all(Array.from({length: 4}, () => request('GET', '/profile/me', a)));
    assert.equal(await app.db.query('api::customer-profile.customer-profile').count({where: {user: userIds[0]}}), 1);
    const profileB = await app.documents('api::customer-profile.customer-profile').findFirst({filters: {user: {id: userIds[1]}}});
    await app.documents('api::customer-profile.customer-profile').delete({documentId: profileB.documentId});
    assert.equal((await request('GET', '/profile/me', b)).status, 200, 'Legacy accounts without a profile are supported');
    const role = await app.db.query('plugin::users-permissions.role').findOne({where: {type: 'app-admin'}});
    await app.db.query('plugin::users-permissions.user').update({where: {id: userIds[1]}, data: {role: role.id}});
    assert.equal((await request('GET', '/profile/me', b)).status, 200, 'App admins can manage their own profile');
    console.log('PASS: registration, private user relation, owner-only read/update, validation, atomic writes, avatar upload/conversion/removal, spoofed and oversized file rejection, legacy profiles, concurrent reads and admin access.');
  } finally {
    for (const id of userIds) {
      const rows = await app.documents('api::customer-profile.customer-profile').findMany({filters: {user: {id}}});
      for (const row of rows) await app.documents('api::customer-profile.customer-profile').delete({documentId: row.documentId});
      await app.sessionManager('users-permissions').invalidateRefreshToken(String(id));
      await app.db.query('plugin::users-permissions.user').delete({where: {id}});
    }
    for (const id of imageIds) {
      const file = await app.db.query('plugin::upload.file').findOne({where: {id}});
      if (file) await app.plugin('upload').service('upload').remove(file);
    }
    await app.destroy();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});

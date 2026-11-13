'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Use a development/test database.');
  const app = createStrapi(await compileStrapi());
  const users = [], productIds = [], variantIds = [], orderIds = [];
  const marker = `checkout-check-${randomUUID()}`;
  const slipDir = path.join(app.dirs.app.root, '.private/payment-slips');
  const storedFiles = [];
  let reviewerToken;
  try {
    await app.load();
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.httpServer.address().port}/api`;
    const role = await app.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });
    for (let i = 0; i < 2; i++) users.push(await app.plugin('users-permissions').service('user').add({
      username: `${marker}-${i}`, email: `${marker}-${i}@example.invalid`, password: randomUUID(),
      provider: 'local', confirmed: true, blocked: false, role: role.id,
    }));
    const tokens = new Map();
    const token = async index => {
      if (!tokens.has(index)) tokens.set(index, await app.plugin('users-permissions').service('jwt').issue({ id: users[index].id }));
      return tokens.get(index);
    };
    const request = async (method, endpoint, body, index = 0, key = randomUUID()) => {
      const response = await fetch(base + endpoint, { method,
        headers: { ...(index === null ? {} : { Authorization: `Bearer ${await token(index)}` }),
          'Idempotency-Key': key, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
      });
      const type = response.headers.get('content-type') || '';
      return { status: response.status, body: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
    };
    const product = await app.documents('api::product.product').create({ status: 'published',
      data: { name: marker, slug: marker, gender: 'unisex', isActive: true } });
    productIds.push(product.documentId);
    for (let i = 0; i < 2; i++) {
      const variant = await app.documents('api::product-variant.product-variant').create({ data: {
        product: product.documentId, sku: `${marker}-${i}`, price: 120.25, currency: 'THB', stockOnHand: i ? 1 : 20,
        stockReserved: 0, isActive: true, concentration: 'edp',
      } });
      variantIds.push(variant.documentId);
    }
    const item = { variantDocumentId: variantIds[0], quantity: 2, price: 0.01 };
    const quote = await request('POST', '/checkout/quote', { items: [item] });
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(quote.body.data.subtotal, '240.50');
    const preflight = await fetch(base + '/checkout/orders', { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:4200', 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
    } });
    assert.ok(preflight.headers.get('access-control-allow-headers').toLowerCase().includes('idempotency-key'));
    assert.ok([401,403].includes((await request('POST', '/checkout/quote', { items: [item] }, null)).status));
    const address = { recipientName: 'Checkout Test', phone: '0812345678', addressLine1: 'Test address',
      subdistrict: 'Test subdistrict', district: 'Dusit', province: 'Bangkok', postalCode: '10300', countryCode: 'TH' };
    const payload = { customer: { firstName: 'Checkout', lastName: 'Test', email: `${marker}@example.invalid` },
      shippingAddress: address, billingAddress: address, items: [item], expectedTotal: quote.body.data.grandTotal };
    const create = async (data = payload, index = 0, key = randomUUID()) => {
      const result = await request('POST', '/checkout/orders', data, index, key);
      if (result.status === 201 && !orderIds.includes(result.body.data.documentId)) orderIds.push(result.body.data.documentId);
      return result;
    };
    const key = randomUUID();
    const simultaneousRetries = await Promise.all([create(payload, 0, key), create(payload, 0, key)]);
    const created = simultaneousRetries[0];
    assert.equal(simultaneousRetries[1].status, 201);
    assert.equal(simultaneousRetries[1].body.data.documentId, created.body.data.documentId);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.documentId;
    assert.equal(created.body.data.paymentStatus, 'unpaid');
    assert.equal(created.body.data.items[0].quantity, 2);
    assert.equal(created.body.data.shippingAddress.phone, address.phone);
    const history = await request('GET', '/checkout/orders?page=1&pageSize=1');
    assert.equal(history.status, 200, JSON.stringify(history.body));
    assert.equal(history.body.meta.pagination.total, 1);
    assert.equal(history.body.data[0].documentId, id);
    assert.equal(history.body.data[0].totalQuantity, 2);
    assert.equal(history.body.data[0].customerEmail, undefined);
    assert.equal(history.body.data[0].checkoutIdempotencyKey, undefined);
    assert.equal((await request('GET', '/checkout/orders', null, 1)).body.meta.pagination.total, 0);
    assert.ok([401,403].includes((await request('GET', '/checkout/orders', null, null)).status));
    assert.equal((await request('GET', '/checkout/orders?page=0')).status, 400);
    assert.equal((await request('GET', '/checkout/orders?pageSize=51')).status, 400);
    assert.equal((await request('GET', '/checkout/orders?status=invalid')).status, 400);
    assert.equal((await request('GET', '/checkout/orders?page=2&pageSize=1')).body.data.length, 0);
    assert.equal((await request('GET', '/checkout/orders?search=nonexistent')).body.meta.pagination.total, 0);
    assert.equal((await request('GET', `/checkout/orders?search=${encodeURIComponent(created.body.data.orderNumber)}`)).body.meta.pagination.total, 1);
    assert.equal((await request('GET', `/checkout/requests/${key}`)).body.data.documentId, id);
    assert.equal((await request('GET', `/checkout/requests/${key}`, null, 1)).status, 404);
    const replay = await create(payload, 0, key);
    assert.equal(replay.body.data.documentId, id);
    assert.equal((await create({ ...payload, customer: { ...payload.customer, firstName: 'Changed' } }, 0, key)).status, 400);
    assert.equal((await create({ ...payload, expectedTotal: '0.01' })).status, 400);
    assert.equal((await create({ ...payload, shippingAddress: { ...address, province: 'Chonburi' } })).status, 400);
    assert.equal((await create({ ...payload, shippingAddress: { ...address, phone: '' } })).status, 400);
    assert.equal((await request('GET', `/checkout/orders/${id}`, null, 1)).status, 404);
    assert.equal((await request('GET', `/checkout/orders/${id}/receipt`, null, 1)).status, 404);
    assert.equal((await app.documents('api::product-variant.product-variant').findOne({ documentId: variantIds[0] })).stockReserved, 2);
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const receipt = buffer => { const form = new FormData(); form.append('files', new Blob([buffer], { type: 'image/png' }), 'receipt.png'); return form; };
    assert.equal((await request('POST', `/checkout/orders/${id}/receipt`, receipt(Buffer.from('<html>not an image</html>')))).status, 400);
    const receiptRetries = await Promise.all([
      request('POST', `/checkout/orders/${id}/receipt`, receipt(png)),
      request('POST', `/checkout/orders/${id}/receipt`, receipt(png)),
    ]);
    const submitted = receiptRetries[0];
    assert.equal(receiptRetries[1].status, 200, JSON.stringify(receiptRetries[1].body));
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.data.paymentStatus, 'pending_review');
    assert.equal(submitted.body.data.payment.status, 'awaiting_review');
    assert.equal(submitted.body.data.payment.slipStorageKey, undefined);
    assert.equal((await request('GET', '/checkout/orders?status=pending_review')).body.data[0].documentId, id);
    assert.equal((await request('GET', '/checkout/orders?status=pending_payment')).body.meta.pagination.total, 0);
    assert.equal((await request('POST', `/checkout/orders/${id}/receipt`, receipt(png))).status, 200);
    const payment = await app.documents('api::payment.payment').findFirst({ filters: { order: { documentId: id } } });
    storedFiles.push(payment.slipStorageKey);
    assert.ok((await readFile(path.join(slipDir, payment.slipStorageKey))).length > 0);
    assert.equal((await request('GET', `/checkout/orders/${id}/receipt`)).status, 200);
    assert.equal((await request('GET', `/checkout/review/${id}/receipt`)).status, 403);
    reviewerToken = await app.service('admin::api-token-content-api').create({name: marker, type: 'full-access', lifespan: 604800000});
    assert.equal((await fetch(base + `/checkout/review/${id}/receipt`, {headers: {Authorization: `Bearer ${reviewerToken.accessKey}`}})).status, 200);
    assert.equal((await fetch(base.replace('/api','') + '/.private/payment-slips/' + payment.slipStorageKey)).status, 404);
    assert.equal(await app.documents('api::payment-event.payment-event').count({ filters: { payment: { documentId: payment.documentId } } }), 1);
    // Competing buyers must not reserve the same last unit.
    const lastItem = { variantDocumentId: variantIds[1], quantity: 1 };
    const lastQuote = await request('POST', '/checkout/quote', { items: [lastItem] });
    const lastPayload = { ...payload, items: [lastItem], expectedTotal: lastQuote.body.data.grandTotal };
    const competing = await Promise.all([create(lastPayload, 0), create(lastPayload, 1)]);
    assert.deepEqual(competing.map(r => r.status).sort(), [201, 400]);
    // An unpaid expired order releases stock; a submitted receipt remains reserved for review.
    const unpaid = competing.find(r => r.status === 201).body.data.documentId;
    await app.documents('api::order.order').update({ documentId: unpaid, data: { expiresAt: new Date(Date.now()-60000).toISOString() } });
    await app.service('api::checkout.checkout').releaseExpired();
    assert.equal((await app.documents('api::order.order').findOne({ documentId: unpaid })).orderStatus, 'expired');
    assert.equal((await app.documents('api::product-variant.product-variant').findOne({ documentId: variantIds[1] })).stockReserved, 0);
    assert.equal((await app.documents('api::product-variant.product-variant').findOne({ documentId: variantIds[0] })).stockReserved, 2);
    console.log('PASS: authenticated checkout, server totals, validation, idempotency, customer/address/item persistence, concurrent stock reservation, expiry, receipt validation/private storage/ownership, retry and awaiting-review status.');
  } finally {
    if (reviewerToken) await app.service('admin::api-token-content-api').revoke(reviewerToken.id);
    for (const id of orderIds) {
      for (const name of ['payment-event', 'payment', 'stock-reservation', 'order-item']) {
        const filters = name === 'payment-event' ? { payment: { order: { documentId: id } } } : { order: { documentId: id } };
        const rows = await app.documents(`api::${name}.${name}`).findMany({ filters, limit: 100 });
        for (const row of rows) await app.documents(`api::${name}.${name}`).delete({ documentId: row.documentId });
      }
      await app.documents('api::order.order').delete({ documentId: id });
    }
    for (const user of users) {
      const profile = await app.documents('api::customer-profile.customer-profile').findFirst({ filters: { user: { id: user.id } } });
      if (profile) {
        const addresses = await app.documents('api::customer-address.customer-address').findMany({ filters: { customer: { documentId: profile.documentId } } });
        for (const address of addresses) await app.documents('api::customer-address.customer-address').delete({ documentId: address.documentId });
        await app.documents('api::customer-profile.customer-profile').delete({ documentId: profile.documentId });
      }
      await app.db.query('plugin::users-permissions.user').delete({ where: { id: user.id } });
    }
    for (const id of variantIds) await app.documents('api::product-variant.product-variant').delete({ documentId: id });
    for (const id of productIds) await app.documents('api::product.product').delete({ documentId: id });
    for (const file of storedFiles) await rm(path.join(slipDir, file), { force: true });
    await app.destroy();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

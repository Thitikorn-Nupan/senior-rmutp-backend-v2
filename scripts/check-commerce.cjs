'use strict';

// Boots Strapi (and synchronizes schemas), then rolls back all fixture data.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

const transactionTypes = [
  'product-variant', 'customer-profile', 'customer-address', 'order',
  'order-item', 'payment', 'payment-event', 'stock-reservation',
  'inventory-movement', 'province', 'district', 'subdistrict', 'store-setting',
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Run this integration check against a development/test database.');
  }

  const app = createStrapi(await compileStrapi());
  try {
    await app.load();
    const doc = (name) => app.documents(`api::${name}.${name}`);
    for (const name of transactionTypes) {
      assert.equal(app.contentType(`api::${name}.${name}`).options.draftAndPublish, false);
    }

    const marker = `schema-check-${randomUUID()}`;
    const rollback = new Error('ROLL_BACK_COMMERCE_FIXTURES');
    const address = {
      recipientName: 'Schema Check', phone: '0000000000',
      addressLine1: 'Test address', subdistrict: 'Test subdistrict',
      district: 'Test district', province: 'Test province', postalCode: '10150',
      countryCode: 'TH',
    };

    await assert.rejects(app.db.transaction(async () => {
      const product = await doc('product').create({
        status: 'published', data: { name: marker, slug: marker, gender: 'unisex' },
      });
      const variant = await doc('product-variant').create({ data: {
        product: product.documentId, sku: marker, price: '999.01', stockOnHand: 10,
      } });
      const customer = await doc('customer-profile').create({
        data: { firstName: 'Schema', lastName: 'Check' },
      });
      const savedAddress = await doc('customer-address').create({ data: {
        customer: customer.documentId, address,
      } });
      const order = await doc('order').create({ data: {
        orderNumber: marker, customer: customer.documentId,
        customerName: 'Schema Check', customerEmail: 'schema-check@example.invalid',
        shippingAddress: address, billingAddress: address,
        subtotal: '1998.02', grandTotal: '1998.02', placedAt: new Date().toISOString(),
      } });
      await doc('order-item').create({ data: {
        order: order.documentId, variant: variant.documentId,
        productNameSnapshot: marker, skuSnapshot: marker,
        unitPrice: '999.01', quantity: 2, lineTotal: '1998.02',
      } });
      const payment = await doc('payment').create({ data: {
        order: order.documentId, paymentReference: marker, amount: '1998.02', method: 'stripe',
      } });
      await doc('payment-event').create({ data: {
        providerEventId: marker, eventType: 'test.schema', payment: payment.documentId,
        receivedAt: new Date().toISOString(),
      } });
      await doc('stock-reservation').create({ data: {
        reservationKey: marker, order: order.documentId, variant: variant.documentId,
        quantity: 2, expiresAt: new Date(Date.now() + 60000).toISOString(),
      } });
      await doc('inventory-movement').create({ data: {
        movementKey: marker, variant: variant.documentId,
        movementType: 'adjustment', quantityChange: -2, occurredAt: new Date().toISOString(),
      } });

      // Later catalog/address edits must not rewrite historical order data.
      await doc('product-variant').update({ documentId: variant.documentId, data: { price: '1200.00' } });
      await doc('customer-address').update({ documentId: savedAddress.documentId,
        data: { address: { ...address, addressLine1: 'Changed address' } } });
      const history = await doc('order').findOne({ documentId: order.documentId,
        populate: { items: true, shippingAddress: true, payments: true } });
      assert.equal(history.shippingAddress.addressLine1, 'Test address');
      assert.equal(Number(history.items[0].unitPrice), 999.01);
      assert.equal(history.payments[0].documentId, payment.documentId);
      assert.equal(Number(history.grandTotal), 1998.02);

      await assert.rejects(doc('order-item').create({ data: {
        order: order.documentId, productNameSnapshot: marker, skuSnapshot: marker,
        unitPrice: '1.00', quantity: 0, lineTotal: '0.00',
      } }));
      await assert.rejects(doc('product-variant').create({ data: {
        product: product.documentId, sku: marker, price: '1.00',
      } }));
      await assert.rejects(doc('payment-event').create({ data: {
        providerEventId: marker, eventType: 'test.duplicate', receivedAt: new Date().toISOString(),
      } }));

      if (app.db.dialect.client === 'mysql') {
        const [columns] = await app.db.connection.raw(
          'SELECT NUMERIC_PRECISION AS p, NUMERIC_SCALE AS s FROM information_schema.columns ' +
          'WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
          ['shop_orders', 'grand_total']
        );
        assert.equal(Number(columns[0].p), 15);
        assert.equal(Number(columns[0].s), 2);
      }
      throw rollback;
    }), (error) => error === rollback);

    assert.equal(await doc('order').count({ filters: { orderNumber: marker } }), 0);
    assert.equal(await doc('product-variant').count({ filters: { sku: marker } }), 0);
    assert.equal(await doc('payment-event').count({ filters: { providerEventId: marker } }), 0);
    console.log('Commerce schema checks passed: relations, snapshots, money, validation, uniqueness, rollback.');
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

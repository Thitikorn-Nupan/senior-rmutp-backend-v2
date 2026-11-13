'use strict';

const assert = require('node:assert/strict');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const samples = require('../data/commerce-products.json');

async function main() {
  const app = createStrapi(await compileStrapi());
  try {
    await app.load();
    const doc = (name) => app.documents(`api::${name}.${name}`);
    const created = { categories: 0, products: 0, variants: 0 };

    // Reuse published records; never overwrite an existing edited draft.
    async function findOrCreatePublished(type, slug, data) {
      const published = await doc(type).findFirst({ status: 'published', filters: { slug } });
      if (published) return { entry: published, created: false };
      const draft = await doc(type).findFirst({ status: 'draft', filters: { slug } });
      if (draft) throw new Error(`Existing unpublished ${type} "${slug}": publish or rename it before seeding.`);
      return { entry: await doc(type).create({ status: 'published', data }), created: true };
    }

    await app.db.transaction(async () => {
      const categories = new Map();
      for (const category of samples.categories) {
        const result = await findOrCreatePublished('product-category', category.slug, {
          ...category, isActive: true,
        });
        categories.set(category.slug, result.entry.documentId);
        if (result.created) created.categories++;
      }

      for (const sample of samples.products) {
        const result = await findOrCreatePublished('product', sample.slug, {
          name: sample.name, slug: sample.slug, description: sample.description,
          gender: sample.gender, isActive: true, categories: [categories.get(sample.gender)],
        });
        if (result.created) created.products++;

        const existingVariant = await doc('product-variant').findFirst({
          filters: { sku: sample.sku }, populate: { product: true },
        });
        if (existingVariant) {
          assert.equal(existingVariant.product?.documentId, result.entry.documentId,
            `SKU ${sample.sku} is already assigned to another product.`);
          continue;
        }

        const variant = await doc('product-variant').create({ data: {
          product: result.entry.documentId, sku: sample.sku,
          label: `${sample.sizeMl} ml ${sample.concentration.toUpperCase()}`,
          sizeMl: sample.sizeMl, concentration: sample.concentration,
          price: sample.price, currency: 'THB', stockOnHand: sample.stock,
          stockReserved: 0, isActive: true,
        } });
        await doc('inventory-movement').create({ data: {
          movementKey: `demo-opening-${sample.sku}`, variant: variant.documentId,
          movementType: 'opening', quantityChange: sample.stock,
          reason: 'Opening stock for demo perfume catalog', occurredAt: new Date().toISOString(),
        } });
        created.variants++;
      }

      const products = await doc('product').findMany({
        status: 'published', filters: { slug: { $in: samples.products.map((p) => p.slug) } },
        populate: { categories: true, variants: true }, limit: 100,
      });
      assert.equal(products.length, 10);
      for (const [gender, expected] of [['unisex', 3], ['male', 3], ['female', 4]]) {
        assert.equal(products.filter((p) => p.gender === gender).length, expected);
      }
      for (const sample of samples.products) {
        const product = products.find((p) => p.slug === sample.slug);
        assert.ok(product.categories.some((c) => c.documentId === categories.get(sample.gender)),
          `Missing category for ${sample.name}`);
        assert.ok(product.variants.some((v) => v.sku === sample.sku),
          `Missing variant for ${sample.name}`);
      }
    });

    console.log(JSON.stringify({ created, verified: { products: 10, unisex: 3, male: 3, female: 4 } }, null, 2));
    console.log('Demo products are published. Existing products, prices and stock were preserved.');
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

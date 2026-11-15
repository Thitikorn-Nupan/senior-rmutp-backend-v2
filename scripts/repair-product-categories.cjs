'use strict';
const {compileStrapi, createStrapi} = require('@strapi/strapi');

async function main() {
  const app = createStrapi(await compileStrapi());
  try {
    await app.load();
    const categories = await app.documents('api::product-category.product-category').findMany({
      status: 'published', filters: {slug: {$in: ['male', 'female', 'unisex']}, isActive: true},
    });
    const byGroup = new Map(categories.map(category => [category.slug, category]));
    for (const group of ['male', 'female', 'unisex']) if (!byGroup.has(group)) throw new Error(`Missing category: ${group}`);
    const repaired = new Set();
    await app.db.transaction(async ({trx}) => {
      const uid = 'api::product.product';
      await trx(app.db.metadata.get(uid).tableName).whereNull('archived_at').orderBy('id').forUpdate().select('id');
      const products = await app.db.query(uid).findMany({where: {archivedAt: {$null: true}}, populate: ['categories']});
      for (const product of products) {
        if (product.categories?.length || !byGroup.has(product.gender)) continue;
        // Repair each existing version's relation only. Do not publish drafts,
        // copy draft fields to published entries, or touch prices and inventory.
        await app.db.query(uid).update({where: {id: product.id}, data: {categories: [byGroup.get(product.gender).id]}});
        repaired.add(product.documentId);
      }
    });
    console.log(`Repaired missing fragrance categories for ${repaired.size} products (draft/published relations preserved).`);
  } finally { await app.destroy(); }
}
main().catch(error => {console.error(error); process.exitCode = 1;});

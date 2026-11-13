import type { Context } from 'koa';
import type { Modules } from '@strapi/types';

// Fixed fields/populates: callers cannot expose stock history or order relations.
const productQuery: Modules.Documents.Params.Pick<'api::product.product', 'fields' | 'populate' | 'status'> = {
  status: 'published' as const,
  fields: ['name', 'description', 'slug', 'gender'],
  populate: {
    images: { fields: ['url', 'alternativeText'] },
    categories: {
      filters: { isActive: true, publishedAt: { $notNull: true } },
      fields: ['name', 'slug'],
    },
    variants: {
      filters: { isActive: true },
      fields: ['sku', 'label', 'sizeMl', 'concentration', 'price', 'currency', 'stockOnHand', 'stockReserved'],
      sort: ['price:asc', 'sku:asc'],
      populate: { image: { fields: ['url', 'alternativeText'] } },
    },
  },
};

export default {
  async products(ctx: Context) {
    const { category, search } = ctx.query;
    if (category !== undefined && (typeof category !== 'string' || !/^[1-9]\d*$/.test(category))) {
      return ctx.badRequest('Invalid category');
    }
    if (search !== undefined && (typeof search !== 'string' || search.length > 255)) {
      return ctx.badRequest('Invalid search');
    }
    const page = Number(ctx.query.page ?? 1);
    const pageSize = Number(ctx.query.pageSize ?? 100);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return ctx.badRequest('Invalid pagination');
    }
    const filters = {
      isActive: true,
      ...(category ? { categories: { id: Number(category), isActive: true, publishedAt: { $notNull: true } } } : {}),
      ...(search ? { name: { $containsi: String(search).trim() } } : {}),
    };
    const documents = strapi.documents('api::product.product');
    const [data, total] = await Promise.all([
      documents.findMany({ ...productQuery, filters, sort: [{ name: 'asc' }, { slug: 'asc' }], start: (page - 1) * pageSize, limit: pageSize }),
      documents.count({ status: 'published', filters }),
    ]);
    ctx.body = { data, meta: { pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } } };
  },

  async product(ctx: Context) {
    const data = await strapi.documents('api::product.product').findOne({
      ...productQuery, documentId: ctx.params.documentId, filters: { isActive: true },
    });
    if (!data) return ctx.notFound('Product not found');
    ctx.body = { data };
  },

  async categories(ctx: Context) {
    const data = await strapi.documents('api::product-category.product-category').findMany({
      status: 'published', filters: { isActive: true }, fields: ['name', 'slug'], sort: ['sortOrder:asc', 'name:asc'],
    });
    ctx.body = { data };
  },
};

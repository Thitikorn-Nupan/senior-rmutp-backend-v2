import type {Core} from '@strapi/strapi';
import {errors} from '@strapi/utils';
import {randomUUID} from 'node:crypto';
import type {Modules} from '@strapi/types';

function invalid(message: string): never {
    throw new errors.ValidationError(message);
}

function record(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Invalid product data');
    return value as Record<string, any>;
}

function text(value: unknown, label: string, max: number, required = true): string {
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) invalid(`Invalid ${label}`);
    return value.trim();
}

export default ({strapi}: { strapi: Core.Strapi }) => {
    const products = strapi.documents('api::product.product');
    const variants = strapi.documents('api::product-variant.product-variant');
    const table = (uid: string) => strapi.db.metadata.get(uid).tableName;
    const populate: Modules.Documents.Params.Pick<'api::product.product', 'populate'>['populate'] = {
        images: {fields: ['url', 'alternativeText']},
        categories: {fields: ['name']},
        variants: {
            fields: ['sku', 'label', 'sizeMl', 'concentration', 'price', 'stockOnHand', 'stockReserved', 'isActive'],
            sort: ['sku:asc']
        },
    };
    return {
        async list(query: Record<string, unknown>) {
            const page = Number(query.page ?? 1), pageSize = 12;
            if (!Number.isSafeInteger(page) || page < 1) invalid('Invalid page');
            const search = query.search === undefined ? '' : text(query.search, 'search', 255, false);
            if (query.category !== undefined && (typeof query.category !== 'string' || !/^[a-z0-9]+$/i.test(query.category))) invalid('Invalid category');
            if (query.active !== undefined && !['true', 'false'].includes(String(query.active))) invalid('Invalid product status');
            const filters = {
                archivedAt: {$null: true},
                ...(search ? {$or: [{name: {$containsi: search}}, {variants: {sku: {$containsi: search}}}]} : {}),
                ...(query.category ? {categories: {documentId: String(query.category)}} : {}),
                ...(query.active !== undefined ? {isActive: query.active === 'true'} : {}),
            };
            const [data, total, categories] = await Promise.all([
                products.findMany({
                    status: 'draft',
                    filters,
                    populate,
                    sort: [{createdAt: 'desc'}, {slug: 'asc'}],
                    start: (page - 1) * pageSize,
                    limit: pageSize
                }),
                products.count({status: 'draft', filters}),
                strapi.documents('api::product-category.product-category').findMany({
                    status: 'published',
                    filters: {isActive: true},
                    fields: ['name'],
                    sort: ['sortOrder:asc', 'name:asc'],
                    limit: 500
                }),
            ]);
            return {
                data,
                categories,
                meta: {pagination: {page, pageSize, total, pageCount: Math.ceil(total / pageSize)}}
            };
        },

        async save(documentId: string | undefined, input: unknown) {
            const data = record(input);
            const name = text(data.name, 'name', 255);
            const description = text(data.description ?? '', 'description', 20000, false);
            if (!['male', 'female', 'unisex'].includes(data.gender) || typeof data.isActive !== 'boolean') invalid('Invalid product status or gender');
            if (!Array.isArray(data.variants) || !data.variants.length || data.variants.length > 30) invalid('Please provide 1–30 variants');
            if (!Array.isArray(data.images) || data.images.length > 10 || data.images.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1)) invalid('Invalid images');
            const skus = new Set<string>();
            const validated = data.variants.map((raw: unknown) => {
                const variant = record(raw);
                const sku = text(variant.sku, 'SKU', 90);
                if (skus.has(sku.toLowerCase())) invalid('Duplicate SKU in this product');
                skus.add(sku.toLowerCase());
                if (!/^\d+(\.\d{1,2})?$/.test(String(variant.price)) || Number(variant.price) > 999999999 || Number(variant.price) < 0) invalid('Invalid price (maximum two decimal places)');
                if (!Number.isSafeInteger(variant.stockOnHand) || variant.stockOnHand < 0 || variant.stockOnHand > 2147483647) invalid('Invalid stock quantity');
                if (typeof variant.isActive !== 'boolean') invalid('Invalid variant status');
                const label = text(variant.label ?? '', 'variant label', 180, false);
                return {
                    documentId: variant.documentId ? text(variant.documentId, 'variant id', 100) : undefined,
                    expectedStockOnHand: variant.expectedStockOnHand,
                    sku,
                    label,
                    price: Number(variant.price).toFixed(2),
                    stockOnHand: variant.stockOnHand,
                    isActive: variant.isActive
                };
            });
            return strapi.db.transaction(async ({trx}) => {
                let previous: any;
                if (documentId) {
                    await trx(table('api::product.product')).where({document_id: documentId}).orderBy('id').forUpdate().select('id');
                    previous = await products.findOne({
                        documentId,
                        status: 'draft',
                        populate: {variants: true},
                        filters: {archivedAt: {$null: true}}
                    });
                    if (!previous) throw new errors.NotFoundError('Product not found');
                    if (!data.expectedUpdatedAt || new Date(previous.updatedAt).toISOString() !== data.expectedUpdatedAt) invalid('This product has changed. Close the editor and refresh the list before saving.');
                }
                const existing: any[] = previous?.variants ?? [];
                // Preserve all historical variants. Disable a variant instead of removing it.
                if (existing.some(v => !validated.some((input: any) => input.documentId === v.documentId))) invalid('Existing variants cannot be removed; disable them instead');
                if (validated.some((v: any) => v.documentId && !existing.some(row => row.documentId === v.documentId))) invalid('Variant does not belong to this product');
                const ids = existing.map(v => v.documentId);
                const submittedIds = validated.map((v: any) => v.documentId).filter(Boolean);
                if (new Set(submittedIds).size !== submittedIds.length) invalid('Duplicate variant id');
                const locked = ids.length ? await trx(table('api::product-variant.product-variant')).whereIn('document_id', ids).orderBy('id').forUpdate().select('*') : [];
                for (const variant of validated) {
                    const current = locked.find((row: any) => row.document_id === variant.documentId);
                    if (current && variant.stockOnHand < current.stock_reserved) invalid('Stock cannot be lower than the quantity reserved by orders');
                    if (current && variant.expectedStockOnHand !== current.stock_on_hand) invalid('Stock has changed since this form was opened. Close the editor and refresh the list.');
                    const duplicate = await variants.findFirst({filters: {sku: {$eqi: variant.sku}, ...(variant.documentId ? {documentId: {$ne: variant.documentId}} : {})}});
                    if (duplicate) invalid(`SKU already exists: ${variant.sku}`);
                }
                // The fragrance group is the category. Ignore legacy category payloads
                // so create/edit cannot save a missing or contradictory relationship.
                const category = await strapi.documents('api::product-category.product-category').findFirst({
                    status: 'published', filters: {slug: data.gender, isActive: true},
                });
                if (!category) invalid('The selected fragrance category is unavailable. Please contact the shop administrator.');
                for (const id of data.images) {
                    const image = await strapi.db.query('plugin::upload.file').findOne({where: {id}, select: ['mime']});
                    if (!image?.mime?.startsWith('image/') || image.mime === 'image/svg+xml') invalid('Invalid product image');
                }
                const productData = {
                    name,
                    description,
                    gender: data.gender,
                    isActive: data.isActive,
                    categories: [category.documentId],
                    images: data.images
                };
                const product = documentId
                    ? await products.update({documentId, data: productData})
                    : await products.create({data: {...productData, slug: `perfume-${randomUUID()}`}});
                if (!product) throw new Error('Unable to save product');
                for (const variant of validated) {
                    const current = locked.find((row: any) => row.document_id === variant.documentId);
                    const {documentId: variantId, expectedStockOnHand: _expected, ...values} = variant;
                    const saved = variantId ? await variants.update({documentId: variantId, data: values})
                        : await variants.create({
                            data: {
                                ...values,
                                product: product.documentId,
                                currency: 'THB',
                                concentration: 'unspecified',
                                stockReserved: 0
                            }
                        });
                    const delta = variant.stockOnHand - Number(current?.stock_on_hand ?? 0);
                    if (delta && saved) await strapi.documents('api::inventory-movement.inventory-movement').create({
                        data: {
                            movementKey: `admin-${randomUUID()}`, variant: saved.documentId,
                            movementType: current ? 'adjustment' : 'opening', quantityChange: delta,
                            reason: 'Product management stock adjustment', occurredAt: new Date().toISOString(),
                        }
                    });
                }
                await products.publish({documentId: product.documentId});
                return products.findOne({documentId: product.documentId, status: 'draft', populate});
            });
        },

        async remove(documentId: string) {
            return strapi.db.transaction(async ({trx}) => {
                await trx(table('api::product.product')).where({document_id: documentId}).orderBy('id').forUpdate().select('id');
                const product = await products.findOne({
                    documentId,
                    status: 'draft',
                    populate: {variants: true},
                    filters: {archivedAt: {$null: true}}
                });
                if (!product) throw new errors.NotFoundError('Product not found');
                const ids = product.variants?.map(v => v.documentId) ?? [];
                const locked = ids.length ? await trx(table('api::product-variant.product-variant')).whereIn('document_id', ids).orderBy('id').forUpdate().select('*') : [];
                if (locked.some((row: any) => row.stock_reserved > 0)) invalid('This product has reserved stock. Complete or cancel those orders before deleting it.');
                for (const variant of product.variants ?? []) await variants.update({
                    documentId: variant.documentId,
                    data: {isActive: false}
                });
                await products.update({documentId, data: {archivedAt: new Date().toISOString(), isActive: false}});
                await products.unpublish({documentId});
            });
        },
    };
};

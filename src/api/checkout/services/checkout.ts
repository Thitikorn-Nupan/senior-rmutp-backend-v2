import type {Core} from '@strapi/strapi';
import type {Context} from 'koa';
import {errors} from '@strapi/utils';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MAX_SLIP_BYTES = 5 * 1024 * 1024;
type ItemInput = { variantDocumentId: string; quantity: number };
type LockedVariant = {
    document_id: string;
    stock_on_hand: number;
    stock_reserved: number;
    price: string;
    currency: string;
    is_active: boolean
};
type AddressInput = {
    recipientName: string;
    phone: string;
    addressLine1: string;
    subdistrict: string;
    district: string;
    province: string;
    postalCode: string;
    countryCode: 'TH'
};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function invalid(message: string, code = 'INVALID_CHECKOUT'): never {
    throw new errors.ValidationError(message, {code});
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Invalid checkout data');
    return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid(`Please enter a valid ${label}`);
    return (value as string).trim();
}

function cents(value: unknown): number {
    if (!/^\d+(\.\d{1,2})?$/.test(String(value))) invalid('Invalid amount');
    const [whole, fraction = ''] = String(value).split('.');
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(amount) || amount < 0) invalid('Amount is too large');
    return amount;
}

const money = (value: number) => (value / 100).toFixed(2);

function items(value: unknown): ItemInput[] {
    if (!Array.isArray(value) || !value.length || value.length > 30) invalid('Please select between 1 and 30 products');
    const seen = new Set<string>();
    return (value as unknown[]).map(raw => {
        const row = record(raw);
        const variantDocumentId = text(row.variantDocumentId, 'product variant', 64);
        if (!/^[a-z0-9]+$/i.test(variantDocumentId) || seen.has(variantDocumentId)) invalid('Invalid or duplicate product variant');
        seen.add(variantDocumentId);
        if (!Number.isSafeInteger(row.quantity) || Number(row.quantity) < 1 || Number(row.quantity) > 99) invalid('Quantity must be between 1 and 99');
        return {variantDocumentId, quantity: Number(row.quantity)};
    }).sort((a, b) => a.variantDocumentId.localeCompare(b.variantDocumentId));
}

function address(value: unknown): AddressInput {
    const row = record(value);
    const phone = text(row.phone, 'phone number', 30);
    const postalCode = text(row.postalCode, 'postal code', 5);
    if (!/^[+\d][\d\s()-]{6,29}$/.test(phone) || !/^\d{5}$/.test(postalCode)) invalid('Please check the phone number and postal code');
    if (row.countryCode && row.countryCode !== 'TH') invalid('Only Thai shipping addresses are supported');
    return {
        recipientName: text(row.recipientName, 'recipient name', 180),
        phone,
        addressLine1: text(row.addressLine1, 'street address', 255),
        subdistrict: text(row.subdistrict, 'subdistrict', 100),
        district: text(row.district, 'district', 100),
        province: text(row.province, 'province', 100),
        postalCode,
        countryCode: 'TH'
    };
}

export default ({strapi}: { strapi: Core.Strapi }) => {
    const orders = strapi.documents('api::order.order');
    const payments = strapi.documents('api::payment.payment');
    const variants = strapi.documents('api::product-variant.product-variant');
    const reservations = strapi.documents('api::stock-reservation.stock-reservation');
    const table = (uid: string) => strapi.db.metadata.get(uid).tableName;
    const slipDirectory = () => {
        const directory = path.resolve(strapi.dirs.app.root, strapi.config.get<string>('commerce.slipDirectory', '.private/payment-slips'));
        const relative = path.relative(path.resolve(strapi.dirs.static.public), directory);
        if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
            throw new Error('PAYMENT_SLIP_DIR must be outside the public directory');
        }
        return directory;
    };

    async function calculate(input: ItemInput[], locked: LockedVariant[] = []) {
        const rows = await variants.findMany({
            filters: {documentId: {$in: input.map(item => item.variantDocumentId)}, isActive: true},
            populate: {product: {populate: {images: true}}, image: true}, limit: 30,
        });
        let subtotal = 0;
        const lines = await Promise.all(input.map(async item => {
            const variant = rows.find(row => row.documentId === item.variantDocumentId);
            if (!variant || !variant.product || variant.currency !== 'THB') invalid('A product is no longer available', 'UNAVAILABLE_PRODUCT');
            const product = await strapi.documents('api::product.product').findOne({
                documentId: variant.product.documentId,
                status: 'published', filters: {isActive: true}, populate: {images: true}
            });
            if (!product) invalid('A product is no longer available', 'UNAVAILABLE_PRODUCT');
            const current = locked.find(row => row.document_id === variant.documentId);
            if (current && (!current.is_active || current.currency !== 'THB')) invalid('A product is no longer available', 'UNAVAILABLE_PRODUCT');
            const stockOnHand = Number(current?.stock_on_hand ?? variant.stockOnHand ?? 0),
                stockReserved = Number(current?.stock_reserved ?? variant.stockReserved ?? 0);
            if (stockOnHand - stockReserved < item.quantity) invalid(`Not enough stock for ${product.name}`, 'OUT_OF_STOCK');
            const unit = cents(current?.price ?? variant.price);
            const lineTotal = unit * item.quantity;
            subtotal += lineTotal;
            if (!Number.isSafeInteger(subtotal)) invalid('Order total is too large');
            return {
                variant: {
                    ...variant, stockOnHand, stockReserved, sku: text(variant.sku, 'SKU', 90),
                    product: {...product, name: text(product.name, 'product name', 255)}
                },
                quantity: item.quantity, unitPrice: money(unit), lineTotal: money(lineTotal)
            };
        }));
        const setting = await strapi.documents('api::store-setting.store-setting').findFirst();
        const threshold = setting?.freeShippingThreshold == null ? null : cents(setting.freeShippingThreshold);
        const shipping = threshold !== null && subtotal >= threshold ? 0 : cents(setting?.flatShippingFee ?? 0);
        const total = subtotal + shipping;
        if (!Number.isSafeInteger(total) || total <= 0) invalid('The order total must be greater than zero');
        return {
            lines, subtotal: money(subtotal), shippingTotal: money(shipping), grandTotal: money(total), currency: 'THB',
            totalQuantity: input.reduce((sum, item) => sum + item.quantity, 0)
        };
    }

    async function validateLocation(value: AddressInput) {
        const province = await strapi.documents('api::province.province').findFirst({
            filters: {isCheckoutEnabled: true, $or: [{nameEn: value.province}, {nameTh: value.province}]},
        });
        if (!province) invalid('Please select a valid province');
        const district = await strapi.documents('api::district.district').findFirst({
            filters: {
                isCheckoutEnabled: true,
                province: {documentId: province.documentId},
                $or: [{nameEn: value.district}, {nameTh: value.district}]
            },
        });
        if (!district) invalid('The district does not belong to the selected province');
    }

    async function ownedOrder(user: number | undefined, documentId: string) {
        const order = await orders.findOne({
            documentId, populate: {
                customer: {populate: {user: true}},
                shippingAddress: true,
                billingAddress: true,
                items: true,
                payments: true,
            }
        });
        if (!order || (user !== undefined && order.customer?.user?.id !== user)) throw new errors.NotFoundError('Order not found');
        return order;
    }

    async function getOrder(user: number | undefined, documentId: string) {
        const order = await ownedOrder(user, documentId);
        const payment = order.payments?.find(row => row.method === 'bank_transfer');
        return {
            documentId: order.documentId,
            orderNumber: order.orderNumber,
            orderStatus: order.orderStatus,
            paymentStatus: order.paymentStatus,
            subtotal: order.subtotal,
            shippingTotal: order.shippingTotal,
            discountTotal: order.discountTotal,
            taxTotal: order.taxTotal,
            grandTotal: order.grandTotal,
            currency: order.currency,
            placedAt: order.placedAt,
            expiresAt: order.expiresAt,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerPhone: order.customerPhone,
            shippingAddress: order.shippingAddress,
            billingAddress: order.billingAddress,
            carrier: order.carrier,
            shippingTrackingNumber: order.shippingTrackingNumber,
            shippedAt: order.shippedAt,
            items: order.items?.map(item => ({
                name: item.productNameSnapshot, sku: item.skuSnapshot, quantity: item.quantity,
                unitPrice: item.unitPrice, lineTotal: item.lineTotal, image: item.imageSnapshot
            })),
            payment: payment ? {
                reference: payment.paymentReference, method: payment.method, status: payment.paymentStatus,
                receiptSubmitted: Boolean(payment.submittedAt), submittedAt: payment.submittedAt
            } : null
        };
    }

    async function releaseExpired() {
        const stale = await orders.findMany({
            filters: {
                orderStatus: 'pending_payment',
                paymentStatus: 'unpaid',
                expiresAt: {$lt: new Date().toISOString()}
            }, limit: 100
        });
        for (const candidate of stale) {
            await strapi.db.transaction(async ({trx}) => {
                await trx(table('api::order.order')).where({id: candidate.id}).forUpdate().first();
                const order = await orders.findOne({documentId: candidate.documentId});
                if (!order || order.orderStatus !== 'pending_payment' || order.paymentStatus !== 'unpaid' || !order.expiresAt || Date.parse(String(order.expiresAt)) > Date.now()) return;
                const active = await reservations.findMany({
                    filters: {
                        order: {documentId: order.documentId},
                        reservationStatus: 'active'
                    }, populate: {variant: true}, limit: 100
                });
                active.sort((a, b) => Number(a.variant?.id) - Number(b.variant?.id));
                for (const reservation of active) {
                    if (!reservation.variant || !reservation.quantity) throw new Error('Invalid stock reservation');
                    const current = await trx(table('api::product-variant.product-variant')).where({id: reservation.variant.id}).forUpdate().first();
                    if (!current || Number(current.stock_reserved) < reservation.quantity) throw new Error('Invalid reservation stock balance');
                    await variants.update({
                        documentId: reservation.variant.documentId,
                        data: {stockReserved: Number(current.stock_reserved) - reservation.quantity}
                    });
                    await reservations.update({
                        documentId: reservation.documentId,
                        data: {reservationStatus: 'expired', releasedAt: new Date().toISOString()}
                    });
                }
                const pending = await payments.findMany({
                    filters: {
                        order: {documentId: order.documentId},
                        paymentStatus: 'pending'
                    }
                });
                for (const payment of pending) await payments.update({
                    documentId: payment.documentId,
                    data: {paymentStatus: 'cancelled'}
                });
                await orders.update({documentId: order.documentId, data: {orderStatus: 'expired'}});
            });
        }
    }

    return {
        getOrder,
        releaseExpired,
        async adminHistory(query: Record<string, unknown>) {
            const page = Math.max(1, Number(query.page ?? 1));
            const pageSize = Math.min(50, Math.max(1, Number(query.pageSize ?? 12)));
            if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize)) invalid('Invalid pagination');
            const search = typeof query.search === 'string' ? query.search.trim() : '';
            const status = typeof query.status === 'string' ? query.status : '';
            const filters: Record<string, unknown> = {};
            if (search) filters.orderNumber = {$containsi: search};
            if (status === 'pending_review') filters.paymentStatus = 'pending_review';
            else if (status) filters.orderStatus = status;
            const [total, rows, summaryRows] = await Promise.all([
                orders.count({filters}),
                orders.findMany({
                filters, sort: ['placedAt:desc', 'id:desc'], start: (page - 1) * pageSize, limit: pageSize,
                populate: {items: true, payments: true}
                }),
                orders.findMany({fields: ['grandTotal', 'paymentStatus'], limit: 100000})
            ]);
            const billTotal = summaryRows.reduce((sum, order) => sum + Number(order.grandTotal ?? 0), 0);
            const verifiedRevenue = summaryRows
                .filter(order => order.paymentStatus === 'paid')
                .reduce((sum, order) => sum + Number(order.grandTotal ?? 0), 0);
            return {
                data: rows.map(order => ({
                    documentId: order.documentId, orderNumber: order.orderNumber,
                    orderStatus: order.orderStatus, paymentStatus: order.paymentStatus,
                    customerName: order.customerName, customerEmail: order.customerEmail,
                    customerPhone: order.customerPhone, placedAt: order.placedAt,
                    grandTotal: order.grandTotal, currency: order.currency,
                    items: order.items?.map(item => ({
                        name: item.productNameSnapshot, sku: item.skuSnapshot,
                        quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal,
                        image: item.imageSnapshot
                    })) ?? [],
                    payment: order.payments?.find(payment => payment.method === 'bank_transfer') ? {
                        status: order.payments.find(payment => payment.method === 'bank_transfer')?.paymentStatus,
                        reference: order.payments.find(payment => payment.method === 'bank_transfer')?.paymentReference,
                        submittedAt: order.payments.find(payment => payment.method === 'bank_transfer')?.submittedAt
                    } : null
                })),
                meta: {pagination: {page, pageSize, total, pageCount: Math.ceil(total / pageSize)}},
                summary: {
                    billTotal: billTotal.toFixed(2),
                    verifiedRevenue: verifiedRevenue.toFixed(2),
                    currency: 'THB'
                }
            };
        },
        async approvePayment(documentId: string) {
            return strapi.db.transaction(async ({trx}) => {
                const lockedOrder = await trx(table('api::order.order')).where({document_id: documentId}).forUpdate().first();
                if (!lockedOrder) throw new errors.NotFoundError('Order not found');
                const order = await orders.findOne({
                    documentId, populate: {items: true, payments: true, reservations: {populate: {variant: true}}}
                });
                const payment = order?.payments?.find(row => row.method === 'bank_transfer');
                if (!order || !payment) throw new errors.NotFoundError('Payment not found');
                if (order.paymentStatus !== 'pending_review' || payment.paymentStatus !== 'awaiting_review') {
                    throw new errors.ValidationError('Only payments awaiting review can be approved');
                }
                const orderReservations = order.reservations ?? [];
                for (const reservation of orderReservations) {
                    if (reservation.reservationStatus !== 'active' || !reservation.variant) continue;
                    const variantRow = await trx(table('api::product-variant.product-variant'))
                        .where({id: reservation.variant.id}).forUpdate().first();
                    if (!variantRow || Number(variantRow.stock_reserved) < Number(reservation.quantity) ||
                        Number(variantRow.stock_on_hand) < Number(reservation.quantity)) {
                        throw new errors.ValidationError('Insufficient reserved stock for this order');
                    }
                    await variants.update({
                        documentId: reservation.variant.documentId,
                        data: {
                            stockOnHand: Number(variantRow.stock_on_hand) - Number(reservation.quantity),
                            stockReserved: Number(variantRow.stock_reserved) - Number(reservation.quantity)
                        }
                    });
                    await reservations.update({
                        documentId: reservation.documentId,
                        data: {reservationStatus: 'consumed', consumedAt: new Date().toISOString()}
                    });
                    await strapi.documents('api::inventory-movement.inventory-movement').create({
                        data: {
                            movementKey: `sale-${order.documentId}-${reservation.variant.documentId}`,
                            variant: reservation.variant.documentId, order: order.documentId,
                            movementType: 'sale', quantityChange: -Number(reservation.quantity),
                            reason: 'Payment approved', occurredAt: new Date().toISOString()
                        }
                    });
                }
                const reviewedAt = new Date().toISOString();
                await payments.update({
                    documentId: payment.documentId,
                    data: {paymentStatus: 'succeeded', paidAt: reviewedAt, reviewedAt}
                });
                await orders.update({
                    documentId: order.documentId,
                    data: {paymentStatus: 'paid', orderStatus: 'confirmed', paidAt: reviewedAt}
                });
                return getOrder(undefined, order.documentId);
            });
        },
        async history(user: number, query: Record<string, unknown>) {
            const page = Number(query.page ?? 1);
            const pageSize = Number(query.pageSize ?? 10);
            if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
                !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) invalid('Invalid pagination');
            const search = query.search ?? '';
            const status = query.status ?? '';
            if (typeof search !== 'string' || search.length > 64 || typeof status !== 'string') invalid('Invalid history filter');
            const filters: any = {customer: {user: {id: user}}};
            if (search.trim()) filters.orderNumber = {$containsi: search.trim()};
            if (status === 'pending_review') filters.paymentStatus = 'pending_review';
            else if (status === 'pending_payment') Object.assign(filters, {
                orderStatus: 'pending_payment',
                paymentStatus: 'unpaid'
            });
            else if (status) {
                if (!['confirmed', 'processing', 'shipped', 'completed', 'cancelled', 'expired', 'legacy_review'].includes(status)) invalid('Invalid history status');
                filters.orderStatus = status;
            }
            await releaseExpired();
            const total = await orders.count({filters});
            const rows = await orders.findMany({
                filters, sort: ['placedAt:desc', 'id:desc'],
                start: (page - 1) * pageSize, limit: pageSize, populate: {items: true}
            });
            return {
                data: rows.map(order => ({
                    documentId: order.documentId, orderNumber: order.orderNumber,
                    orderStatus: order.orderStatus, paymentStatus: order.paymentStatus,
                    grandTotal: order.grandTotal, currency: order.currency, placedAt: order.placedAt,
                    expiresAt: order.expiresAt,
                    totalQuantity: order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0,
                    items: order.items?.map(item => ({
                        name: item.productNameSnapshot,
                        image: item.imageSnapshot
                    })) ?? [],
                })),
                meta: {pagination: {page, pageSize, total, pageCount: Math.ceil(total / pageSize)}},
            };
        },
        async findRequest(user: number, key: string) {
            if (!/^[a-z0-9-]{16,80}$/i.test(key)) throw new errors.NotFoundError('Order not found');
            const order = await orders.findFirst({filters: {checkoutIdempotencyKey: `${user}:${key}`}});
            if (!order) throw new errors.NotFoundError('Order not found');
            return getOrder(user, order.documentId);
        },
        async quote(raw: unknown) {
            await releaseExpired();
            const result = await calculate(items(record(raw).items));
            return {
                subtotal: result.subtotal, shippingTotal: result.shippingTotal, grandTotal: result.grandTotal,
                currency: result.currency, totalQuantity: result.totalQuantity,
                items: result.lines.map(line => ({
                    variantDocumentId: line.variant.documentId, name: line.variant.product.name,
                    quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal
                }))
            };
        },

        async createOrder(user: number, raw: unknown, key: unknown) {
            if (typeof key !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(key)) invalid('A valid checkout request key is required');
            const data = record(raw), customer = record(data.customer);
            const firstName = text(customer.firstName, 'first name', 90),
                lastName = text(customer.lastName, 'last name', 89);
            const email = text(customer.email, 'email', 254);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('Please enter a valid email address');
            const shippingAddress = address(data.shippingAddress), billingAddress = address(data.billingAddress);
            const input = items(data.items);
            const payloadHash = hash(JSON.stringify({
                firstName,
                lastName,
                email,
                shippingAddress,
                billingAddress,
                input
            }));
            const requestKey = `${user}:${key}`;
            await releaseExpired();
            const documentId = await strapi.db.transaction(async ({trx}) => {
                // A customer lock serializes retries/profile creation. Variant locks serialize
                // purchases across customers; all locks use deterministic variant ID order.
                await trx(table('plugin::users-permissions.user')).where({id: user}).forUpdate().first();
                const previous = await orders.findFirst({filters: {checkoutIdempotencyKey: requestKey}});
                if (previous) {
                    if (previous.checkoutPayloadHash !== payloadHash) invalid('This checkout request already contains different details', 'REQUEST_CHANGED');
                    return previous.documentId;
                }
                // MySQL's locking SELECT reads the current committed balance even when
                // the transaction already has a repeatable-read snapshot.
                const locked: LockedVariant[] = await trx(table('api::product-variant.product-variant')).whereIn('document_id', input.map(item => item.variantDocumentId)).orderBy('id').forUpdate().select('*');
                const result = await calculate(input, locked);
                if (cents(data.expectedTotal) !== cents(result.grandTotal)) invalid('Prices have changed. Please refresh your order total.', 'PRICE_CHANGED');
                await validateLocation(shippingAddress);
                await validateLocation(billingAddress);
                const profiles = strapi.documents('api::customer-profile.customer-profile');
                let profile = await profiles.findFirst({filters: {user: {id: user}}});
                const profileData = {firstName, lastName, phone: shippingAddress.phone};
                profile = profile ? await profiles.update({documentId: profile.documentId, data: profileData})
                    : await profiles.create({data: {...profileData, user}});
                if (!profile) throw new Error('Unable to save customer profile');
                const now = new Date().toISOString();
                const minutes = Math.max(1, strapi.config.get<number>('commerce.paymentWindowMinutes', 30));
                const expiresAt = new Date(Date.now() + minutes * 60000).toISOString();
                const order = await orders.create({
                    data: {
                        orderNumber: `PS-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
                        customer: profile.documentId,
                        customerName: `${firstName} ${lastName}`,
                        customerEmail: email,
                        customerPhone: shippingAddress.phone,
                        shippingAddress,
                        billingAddress,
                        subtotal: result.subtotal,
                        shippingTotal: result.shippingTotal,
                        grandTotal: result.grandTotal,
                        discountTotal: 0,
                        taxTotal: 0,
                        currency: 'THB',
                        placedAt: now,
                        expiresAt,
                        orderStatus: 'pending_payment',
                        paymentStatus: 'unpaid',
                        checkoutIdempotencyKey: requestKey,
                        checkoutPayloadHash: payloadHash,
                    }
                });
                for (const line of result.lines) {
                    const variant = line.variant;
                    await strapi.documents('api::order-item.order-item').create({
                        data: {
                            order: order.documentId,
                            variant: variant.documentId,
                            productNameSnapshot: variant.product.name,
                            skuSnapshot: variant.sku,
                            variantSnapshot: {
                                sizeMl: variant.sizeMl,
                                concentration: variant.concentration,
                                label: variant.label
                            },
                            imageSnapshot: variant.image?.url ?? variant.product.images?.[0]?.url ?? '',
                            quantity: line.quantity,
                            unitPrice: line.unitPrice,
                            lineTotal: line.lineTotal,
                            discountTotal: 0,
                            taxTotal: 0,
                        }
                    });
                    await variants.update({
                        documentId: variant.documentId,
                        data: {stockReserved: variant.stockReserved + line.quantity}
                    });
                    await reservations.create({
                        data: {
                            reservationKey: `checkout-${order.documentId}-${variant.documentId}`,
                            order: order.documentId,
                            variant: variant.documentId,
                            quantity: line.quantity,
                            reservationStatus: 'active',
                            expiresAt
                        }
                    });
                }
                await payments.create({
                    data: {
                        order: order.documentId,
                        paymentReference: `TRANSFER-${randomUUID()}`,
                        method: 'bank_transfer',
                        paymentStatus: 'pending',
                        amount: result.grandTotal,
                        currency: 'THB',
                        idempotencyKey: requestKey
                    }
                });
                const addresses = strapi.documents('api::customer-address.customer-address');
                for (const [label, snapshot] of [['Checkout shipping', shippingAddress], ['Checkout billing', billingAddress]] as const) {
                    const existing = await addresses.findFirst({
                        filters: {
                            customer: {documentId: profile.documentId},
                            label
                        }
                    });
                    if (existing) await addresses.update({documentId: existing.documentId, data: {address: snapshot}});
                    else await addresses.create({
                        data: {
                            customer: profile.documentId,
                            label,
                            address: snapshot,
                            isDefaultShipping: false,
                            isDefaultBilling: false
                        }
                    });
                }
                return order.documentId;
            });
            return getOrder(user, documentId);
        },

        async submitReceipt(user: number, documentId: string, file: unknown) {
            // Check ownership before reading, decoding or retaining an uploaded receipt.
            const initialOrder = await ownedOrder(user, documentId);
            if (!file || Array.isArray(file)) invalid('Please attach exactly one receipt image');
            const upload = record(file);
            if (typeof upload.filepath !== 'string' || !Number.isSafeInteger(upload.size) || Number(upload.size) < 1 || Number(upload.size) > MAX_SLIP_BYTES) invalid('Receipt images must be no larger than 5 MB');
            const buffer = await readFile(upload.filepath as string);
            if (buffer.length > MAX_SLIP_BYTES) invalid('Receipt images must be no larger than 5 MB');
            let image: Buffer;
            try {
                const decoder = sharp(buffer, {limitInputPixels: 25000000, failOn: 'error'});
                const meta = await decoder.metadata();
                if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) invalid('Please use a JPG, PNG or WebP receipt image');
                // Re-encode the image to validate its contents and remove embedded metadata.
                image = await decoder.rotate().png().toBuffer();
                if (image.length > 20 * 1024 * 1024) invalid('Receipt image dimensions are too large');
            } catch {
                invalid('Please attach a valid JPG, PNG or WebP receipt image');
            }
            const fingerprint = hash(buffer);
            let written: string | undefined;
            try {
                await strapi.db.transaction(async ({trx}) => {
                    await trx(table('api::order.order')).where({id: initialOrder.id}).forUpdate().first();
                    const order = await ownedOrder(user, documentId);
                    const payment = order.payments?.find(row => row.method === 'bank_transfer');
                    if (!payment) invalid('Transfer payment not found');
                    if (order.paymentStatus === 'pending_review' && payment.slipSha256 === fingerprint) return;
                    if (order.orderStatus !== 'pending_payment' || order.paymentStatus !== 'unpaid' || !order.expiresAt || Date.parse(String(order.expiresAt)) <= Date.now()) invalid('This order cannot accept a receipt. Refresh the order status.', 'ORDER_NOT_PAYABLE');
                    const key = `${randomUUID()}.png`;
                    await mkdir(slipDirectory(), {recursive: true});
                    written = path.join(slipDirectory(), key);
                    await writeFile(written, image, {flag: 'wx', mode: 0o600});
                    const now = new Date().toISOString();
                    await payments.update({
                        documentId: payment.documentId, data: {
                            slipStorageKey: key,
                            slipOriginalName: path.basename(String(upload.originalFilename || 'receipt')).slice(0, 255),
                            slipMimeType: 'image/png',
                            slipSha256: fingerprint,
                            paymentStatus: 'awaiting_review',
                            submittedAt: now,
                        }
                    });
                    await orders.update({documentId, data: {paymentStatus: 'pending_review'}});
                    await strapi.documents('api::payment-event.payment-event').create({
                        data: {
                            payment: payment.documentId,
                            provider: 'manual',
                            providerEventId: `receipt-${payment.documentId}`,
                            eventType: 'receipt.submitted',
                            processingStatus: 'processed',
                            attemptCount: 1,
                            receivedAt: now,
                            processedAt: now
                        }
                    });
                });
            } catch (error) {
                if (written) await unlink(written).catch(() => {
                });
                throw error;
            }
            return getOrder(user, documentId);
        },

        async downloadReceipt(ctx: Context, documentId: string, user?: number) {
            const order = await ownedOrder(user, documentId);
            const payment = order.payments?.find(row => row.method === 'bank_transfer');
            const key = payment?.slipStorageKey;
            if (!key || !/^[a-f0-9-]{36}\.png$/.test(key)) throw new errors.NotFoundError('Receipt not found');
            ctx.set('Cache-Control', 'private, no-store');
            ctx.set('X-Content-Type-Options', 'nosniff');
            ctx.type = 'image/png';
            ctx.attachment(`receipt-${order.orderNumber}.png`);
            ctx.body = createReadStream(path.join(slipDirectory(), key));
        },
    };
};

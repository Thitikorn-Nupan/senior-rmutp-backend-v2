import {factories} from '@strapi/strapi';
import {errors} from '@strapi/utils';
import sharp from 'sharp';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const uid = 'api::customer-profile.customer-profile';
const {ValidationError} = errors;
const invalid = (message: string): never => {
    throw new ValidationError(message);
};
const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object');
    return value as Record<string, unknown>;
};
const text = (value: unknown, name: string, max: number): string => {
    if (typeof value !== 'string' || value.trim().length > max) invalid(`Invalid ${name}`);
    return (value as string).trim();
};
const populate = {avatar: true, shippingAddress: true};

export default factories.createCoreService(uid, ({strapi}) => ({
    async ensureForUser(userId: number) {
        return strapi.db.transaction(async ({trx}) => {
            const table = strapi.db.metadata.get('plugin::users-permissions.user').tableName;
            const user = await trx(table).where({id: userId}).forUpdate().first();
            if (!user) throw new errors.NotFoundError('User not found');
            const profiles = strapi.documents(uid);
            return await profiles.findFirst({filters: {user: {id: userId}}})
                ?? await profiles.create({data: {user: userId, firstName: '', lastName: '', displayName: ''} as any});
        });
    },

    async readForUser(userId: number) {
        const profile = await this.ensureForUser(userId);
        const row: any = await strapi.documents(uid).findOne({
            documentId: profile.documentId,
            populate: populate as any
        });
        const user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: {id: userId},
            select: ['email', 'username']
        });
        // Explicitly expose the owner's editable data, never user roles, orders or tokens.
        return {
            documentId: row.documentId,
            email: user.email,
            username: user.username,
            firstName: row.firstName ?? '',
            lastName: row.lastName ?? '',
            displayName: row.displayName ?? '',
            phone: row.phone ?? '',
            avatar: row.avatar ? {id: row.avatar.id, url: row.avatar.url} : null,
            shippingAddress: row.shippingAddress ? Object.fromEntries(
                ['addressLine1', 'addressLine2', 'subdistrict', 'district', 'province', 'postalCode', 'countryCode']
                    .map(key => [key, row.shippingAddress[key] ?? ''])) : null,
        };
    },

    async saveForUser(userId: number, input: unknown) {
        const data = object(input);
        const allowed = ['firstName', 'lastName', 'displayName', 'phone', 'shippingAddress'];
        if (Object.keys(data).some(key => !allowed.includes(key))) invalid('Unknown profile field');
        const values: Record<string, unknown> = {};
        for (const key of ['firstName', 'lastName', 'displayName', 'phone']) {
            values[key] = text(data[key], key, key === 'phone' ? 30 : 90);
        }
        if (!values.firstName || !values.lastName) invalid('First and last name are required');
        if (values.phone && !/^[+\d() .-]{6,30}$/.test(values.phone as string)) invalid('Invalid phone number');
        const address = object(data.shippingAddress);
        const lengths: Record<string, number> = {
            addressLine1: 255,
            addressLine2: 255,
            subdistrict: 100,
            district: 100,
            province: 100,
            postalCode: 5,
            countryCode: 2
        };
        if (Object.keys(address).some(key => !(key in lengths))) invalid('Unknown address field');
        const clean: Record<string, string> = {};
        for (const [key, length] of Object.entries(lengths)) clean[key] = text(address[key] ?? (key === 'countryCode' ? 'TH' : ''), key, length);
        if (clean.postalCode && !/^\d{5}$/.test(clean.postalCode)) invalid('Postal code must contain 5 digits');
        if (clean.countryCode !== 'TH') invalid('Only Thai contact addresses are supported');
        values.shippingAddress = clean;
        await strapi.db.transaction(async () => {
            const profile = await this.ensureForUser(userId);
            await strapi.documents(uid).update({documentId: profile.documentId, data: values as any});
        });
        return this.readForUser(userId);
    },

    async uploadAvatar(userId: number, input: unknown) {
        const file = object(input);
        if (typeof file.filepath !== 'string' || typeof file.size !== 'number' || file.size < 1 || file.size > 5 * 1024 * 1024) {
            invalid('Choose one JPG, PNG or WebP image no larger than 5 MB');
        }
        let encoded: Buffer;
        try {
            const decoder = sharp(await readFile(file.filepath as string), {
                limitInputPixels: 25000000,
                failOn: 'error'
            });
            const metadata = await decoder.metadata();
            if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Unsupported image');
            encoded = await decoder.rotate().resize(512, 512, {
                fit: 'cover',
                withoutEnlargement: true
            }).webp({quality: 85}).toBuffer();
        } catch {
            return invalid('Choose a valid JPG, PNG or WebP image (up to 25 megapixels)');
        }
        const directory = await mkdtemp(path.join(tmpdir(), 'profile-avatar-'));
        let uploaded: any;
        try {
            const filepath = path.join(directory, 'avatar.webp');
            await writeFile(filepath, encoded);
            [uploaded] = await strapi.plugin('upload').service('upload').upload({
                data: {fileInfo: {name: 'Profile avatar', alternativeText: 'Profile avatar'}},
                files: {filepath, originalFilename: 'avatar.webp', mimetype: 'image/webp', size: encoded.length},
            });
            await strapi.db.transaction(async () => {
                const profile = await this.ensureForUser(userId);
                await strapi.documents(uid).update({
                    documentId: profile.documentId,
                    data: {avatar: uploaded.id} as any
                });
            });
        } catch (error) {
            if (uploaded) await strapi.plugin('upload').service('upload').remove(uploaded);
            throw error;
        } finally {
            await rm(directory, {recursive: true, force: true});
        }
        return this.readForUser(userId);
    },

    async deleteAvatar(userId: number) {
        await strapi.db.transaction(async () => {
            const profile = await this.ensureForUser(userId);
            await strapi.documents(uid).update({documentId: profile.documentId, data: {avatar: null} as any});
        });
        return this.readForUser(userId);
    },
}));

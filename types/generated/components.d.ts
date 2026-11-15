import type { Schema, Struct } from '@strapi/strapi';

export interface CommerceAddress extends Struct.ComponentSchema {
  collectionName: 'components_commerce_addresss';
  info: {
    displayName: 'Address snapshot';
  };
  attributes: {
    addressLine1: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
    addressLine2: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
    countryCode: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2;
        minLength: 2;
      }> &
      Schema.Attribute.DefaultTo<'TH'>;
    district: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
    phone: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 30;
      }>;
    postalCode: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 5;
        minLength: 5;
      }>;
    province: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
    recipientName: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    subdistrict: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
  };
}

export interface CommerceBankAccount extends Struct.ComponentSchema {
  collectionName: 'components_commerce_bank_accounts';
  info: {
    displayName: 'Bank account snapshot';
  };
  attributes: {
    accountName: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    accountNumber: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    bankName: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
    branch: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
    instructions: Schema.Attribute.Text;
  };
}

export interface CommerceVariantSnapshot extends Struct.ComponentSchema {
  collectionName: 'components_commerce_variant_snapshots';
  info: {
    displayName: 'Variant snapshot';
  };
  attributes: {
    concentration: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    label: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    sizeMl: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          min: 0.01;
        },
        number
      >;
  };
}

export interface ProfileContactAddress extends Struct.ComponentSchema {
  collectionName: 'components_profile_contact_addresses';
  info: {
    displayName: 'Profile contact address';
  };
  attributes: {
    addressLine1: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
    addressLine2: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
    countryCode: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2;
      }> &
      Schema.Attribute.DefaultTo<'TH'>;
    district: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
    postalCode: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 5;
      }>;
    province: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
    subdistrict: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'commerce.address': CommerceAddress;
      'commerce.bank-account': CommerceBankAccount;
      'commerce.variant-snapshot': CommerceVariantSnapshot;
      'profile.contact-address': ProfileContactAddress;
    }
  }
}

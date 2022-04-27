import { DbSchemeConfig } from 'services/d';

export const schemeConfig: DbSchemeConfig = {
  Sales: {
    properties: {
      DateTime: true,
      Id: true,
    },
  },
  Boxes: {
    properties: {
      Id: true,
      IsFull: true,
    },
  },
  BoxSale: {
    properties: {
      BoxesId: true,
      SalesId: true,
    },
  },
  Products: {
    properties: {
      BoxId: true,
      Id: true,
      ProductType: true,
      SaleId: true,
      Title: true,
    },
  },
};

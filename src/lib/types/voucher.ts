export type PosVoucherRewardType =
  | "DISCOUNT_PERCENT"
  | "FREE_TICKET"
  | "FREE_ITEM";

export interface PosVoucherResolution {
  code: string;
  campaignId: string;
  campaignName: string;
  rewardType: PosVoucherRewardType;
  rewardValue: number;
  product: {
    goodsId: string;
    goodsName: string;
    price: number;
    quantity: number;
    ticketsPerUnit?: number;
  };
}

export interface PosOrderVoucherSnapshot extends PosVoucherResolution {
  discountAmount: number;
}

export interface PosVoucherCodeFormat {
  prefix: string;
  suffixes: string[];
}

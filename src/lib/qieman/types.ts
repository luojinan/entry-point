/**
 * 且慢 PMDJ API 类型定义
 */

// ============ 长赢投资方案 ============

export interface LongWinPlanResponse {
  establishDate: number;
  tradeLimit: {
    minUnitAmount: number;
    maxUnitAmount: number;
  };
  composition: CompositionItem[];
}

export interface CompositionItem {
  className: string;
  classCode: string;
  unit: number;
  profitRate: number | null;
  accProfitRate: number;
  percent: number;
  isCash: boolean;
  compList: CompListItem[];
}

export interface CompListItem {
  fund: FundInfo;
  shareType: string;
  variety: string;
  nav: number;
  navDate: number;
  dailyReturn: number;
  planUnit: number;
  strategyType: string;
  unitValue: number;
  percent: number;
  isCash: boolean;
  accProfit: number;
}

export interface FundInfo {
  fundCode: string;
  fundName: string;
  fundInvestType: string;
  isQdii: boolean;
  canBuy: boolean;
  canRedeem: boolean;
  onSale: boolean;
  nav: string;
  navDate: string;
  personalHighestBuyAmount: number | null;
  cannotBuyReason: string | null;
}

export interface HoldingAsset {
  fundCode: string;
  fundName: string;
  shares: number;
  nav: number;
  navDate: string;
  marketValue: number;
  cost: number;
  profit: number;
  profitRate: number;
  dailyProfit: number;
  dailyReturn: number;
  variety: string;
  classCode: string;
  className: string;
}

export interface CashAsset {
  fundCode: string;
  fundName: string;
  shares: number;
  nav: number;
  marketValue: number;
}

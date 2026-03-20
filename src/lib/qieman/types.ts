/**
 * 且慢 PMDJ API 类型定义
 */

// ============ 长赢计划主信息 ============

export interface LongWinResponse {
	id: number;
	userPropertyId: number;
	userId: number;
	type: string;
	investType: string;
	unitAmount: number;
	savings: number;
	monthBalance: number | null;
	baselineAdviceFirstShowAt: number;
	extUnitInfoAddAt: number;
	firstOrderInfo: {
		txnDay: number;
		orderId: string;
	};
	adjustmentPushEnabled: boolean;
	dividendMethodArEnabled: boolean;
	capitalAccountId: string;
	status: string;
	followedAdjustments: Array<{
		orderId: string;
		adjustmentId: number;
	}>;
	coverAdvicePushEnabled: boolean;
	introRead: boolean;
	extUnitInfo: Array<{
		classCode: string;
		className: string;
		unit: number;
		compList: Array<{
			fundCode: string;
			unit: number;
			variety: string;
		}>;
	}>;
	createdAt: number;
	updatedAt: number;
	isAREnabled: boolean;
	umaId: number;
	modifyUnitsEnabled: boolean;
	advicePhase: string;
	prodCode: string;
}

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

// ============ 长赢资产汇总 ============

export interface LongWinAssetsResponse {
	totalAssets: number;
	totalProfit: number;
	totalProfitRate: number;
	yesterdayProfit: number;
	totalInvest: number;
	holdingAssets: HoldingAsset[];
	cashAssets: CashAsset[];
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

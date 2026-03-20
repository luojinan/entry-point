export interface FundData {
  // 基金代码
  code: string;
  // 基金名称
  name: string;
  // 基金类型
  type: string;
  // 当前基金单位净值
  netWorth: number;
  // 当前基金单位净值估算
  expectWorth: number;
  // 当前基金累计净值
  totalWorth: number;
  // 当前基金单位净值估算日涨幅,单位为百分比
  expectGrowth: string;
  // 单位净值日涨幅,单位为百分比
  dayGrowth: string;
  // 单位净值周涨幅,单位为百分比
  lastWeekGrowth: string;
  // 单位净值月涨幅,单位为百分比
  lastMonthGrowth: string;
  // 单位净值三月涨幅,单位为百分比
  lastThreeMonthsGrowth: string;
  // 单位净值六月涨幅,单位为百分比
  lastSixMonthsGrowth: string;
  // 单位净值年涨幅,单位为百分比
  lastYearGrowth: string;
  // 起购额度
  buyMin: number;
  // 原始买入费率,单位为百分比
  buySourceRate: number;
  // 当前买入费率,单位为百分比
  buyRate: number;
  // 基金经理
  manager: string;
  // 基金规模及日期,日期为最后一次规模变动的日期
  fundScale: string;
  // 净值更新日期,日期格式为yy-MM-dd HH:mm.2019-06-27 15:00代表当天下午3点
  worthDate: string;
  // 净值估算更新日期,,日期格式为yy-MM-dd HH:mm.2019-06-27 15:00代表当天下午3点
  expectWorthDate: string;
  // 每万分收益(货币基金)
  millionCopiesIncome: number;
  // 七日年化收益更新日期(货币基金)
  millionCopiesIncomeDate: string;
  // 七日年化收益(货币基金)
  sevenDaysYearIncome: number;
}

/**
 * 表示一个基金或投资组合的基本信息。
 */
export interface FundInfo {
  /**
   * 基金成立的时间戳（毫秒）。
   */
  establishDate: number;

  /**
   * 交易限制信息。
   */
  tradeLimit: {
    /**
     * 最小交易单位金额。
     */
    minUnitAmount: number;
    /**
     * 最大交易单位金额。
     */
    maxUnitAmount: number;
  };

  /**
   * 投资组合的构成详情。
   */
  composition: Composition[];

  /**
   * 风险等级（数字表示）。
   */
  risk5Level: number;

  /**
   * 风险等级的文字描述。
   */
  risk5LevelName: string;

  /**
   * 已投资的单位数。
   */
  investedUnit: number;

  /**
   * 年化复合收益率。
   */
  annualCompoundedReturn: number;

  /**
   * 净值。
   */
  nav: number;

  /**
   * 净值日期的时间戳（毫秒）。
   */
  navDate: number;

  /**
   * 日收益率。
   */
  dailyReturn: number;

  /**
   * 自成立以来的收益率。
   */
  fromSetupReturn: number;

  /**
   * 最大回撤。
   */
  maxDrawdown: number;

  /**
   * 波动率。
   */
  volatility: number;

  /**
   * 夏普比率。
   */
  sharpe: number;

  /**
   * 调整次数。
   */
  adjustedCount: number;

  /**
   * 参与人数。
   */
  joinedCount: number;

  /**
   * 投资的年复合增长率。
   */
  investedACR: number;

  /**
   * 投资的年复合增长率的日期时间戳（毫秒）。
   */
  investedACRDate: number;

  /**
   * 净值基准指标列表。
   */
  navBenchMarks: NavBenchmark[];

  /**
   * 产品概要列表。
   */
  prodSummaries: ProdSummary[];

  /**
   * 基金类型A事件列表。
   */
  fundTypeAEvents: any[];
}

/**
 * 投资组合的构成详情。
 */
interface Composition {
  /**
   * 资产类别的名称。
   */
  className: string;

  /**
   * 资产类别的编码。
   */
  classCode: string;

  /**
   * 单位数量。
   */
  unit: number;

  /**
   * 利润率（可能为null）。
   */
  profitRate: number | null;

  /**
   * 累计利润率。
   */
  accProfitRate: number;

  /**
   * 在整个组合中的百分比。
   */
  percent: number;

  /**
   * 是否为现金资产。
   */
  isCash: boolean;

  /**
   * 该资产类别下的具体组成项列表。
   */
  compList: CompListItem[];
}

/**
 * 资产类别下的具体组成项。
 */
export interface CompListItem {
  /**
   * 基金信息。
   */
  fund?: {
    /**
     * 基金代码。
     */
    fundCode: string;
    /**
     * 基金名称。
     */
    fundName: string;
    /**
     * 投资类型。
     */
    fundInvestType: string;
    /**
     * 是否为QDII基金。
     */
    isQdii: boolean;
    /**
     * 是否可购买。
     */
    canBuy: boolean;
    /**
     * 是否可赎回。
     */
    canRedeem: boolean;
    /**
     * 是否在售。
     */
    onSale: boolean;
    /**
     * 净值。
     */
    nav: string;
    /**
     * 净值日期。
     */
    navDate: string;
    /**
     * 个人最高购买金额（可能为null）。
     */
    personalHighestBuyAmount: number | null;
    /**
     * 无法购买的原因（可能为null）。
     */
    cannotBuyReason: string | null;
  };

  /**
   * 股份类型。
   */
  shareType: string;

  /**
   * 品种。
   */
  variety: string;

  /**
   * 净值。
   */
  nav: number;

  /**
   * 净值日期的时间戳（毫秒）。
   */
  navDate: number;

  /**
   * 日收益率。
   */
  dailyReturn: number;

  /**
   * 计划单位。
   */
  planUnit: number;

  /**
   * 策略类型。
   */
  strategyType: string;

  /**
   * 单位价值。
   */
  unitValue: number;

  /**
   * 在该资产类别中的占比。
   */
  percent: number;

  /**
   * 是否为现金资产。
   */
  isCash: boolean;

  /**
   * 累计收益。
   */
  accProfit: number;
}

/**
 * 净值基准指标。
 */
interface NavBenchmark {
  /**
   * 基准代码。
   */
  code: string;

  /**
   * 基准名称。
   */
  name: string;
}

/**
 * 产品概要。
 */
interface ProdSummary {
  /**
   * 概要ID。
   */
  id: string;

  /**
   * 基金代码。
   */
  fundCode: string;

  /**
   * 概要名称。
   */
  name: string;

  /**
   * 概要文件的URL链接。
   */
  url: string;
}

/**
 * 且慢 API 通用响应包装。
 */
export interface QiemanResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface WeiboMessage {
  id: string;
  content: string;
  sender_id: string;
  sender_name: string;
  time: number;
}

export interface WeiboResponse {
  messages: WeiboMessage[];
  ok: number;
}

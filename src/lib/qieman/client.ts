/**
 * 且慢 API 客户端
 * 支持 Mock 和真实 API 切换
 */

export interface QiemanConfig {
	baseUrl: string;
	token?: string;
	useMock: boolean;
}

export class QiemanClient {
	private config: QiemanConfig;

	constructor(config: QiemanConfig) {
		this.config = config;
	}

	/**
	 * 生成 x-sign 签名
	 * 使用固定签名值（来自真实抓包数据 req.txt）
	 * 从测试结果看，签名验证不是强制的，使用固定签名即可稳定工作
	 */
	private generateSign(timestamp: number, path: string): string {
		// 使用 req.txt 中的有效签名
		return "177339402090673EAC1F009ABBC0B1C35705E58F15ED6";
	}

	/**
	 * 发起请求
	 */
	async request<T>(path: string, params?: Record<string, string>): Promise<T> {
		const url = new URL(path, this.config.baseUrl);
		if (params) {
			Object.entries(params).forEach(([key, value]) => {
				url.searchParams.set(key, value);
			});
		}

		const timestamp = Date.now();
		const headers: Record<string, string> = {
			Accept: "application/json",
			"Accept-Encoding": "gzip, br",
			"Accept-Language": "zh-CN,zh-Hans;q=0.9",
			"User-Agent":
				"Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003030) NetType/WIFI Language/zh_CN",
			"Cache-Control": "no-store",
			Connection: "keep-alive",
			Referer: "https://qieman.com/properties/1679634/longwin/asset",
		};

		if (this.config.token) {
			headers.Authorization = `Bearer ${this.config.token}`;
			headers["x-sign"] = this.generateSign(timestamp, path);
			headers["sensors-anonymous-id"] =
				"19ce05057edd25-03652742a6bbcdc-6f4d760a-304500-19ce05057ee16ab";
			headers["x-request-id"] = `albus.${Math.random().toString(36).substring(2, 15).toUpperCase()}`;
		}

		const response = await fetch(url.toString(), { headers });

		// Debug: log response details
		const contentType = response.headers.get("content-type");
		const contentLength = response.headers.get("content-length");
		console.log(
			`[QiemanClient] ${path} -> status=${response.status}, content-type=${contentType}, content-length=${contentLength}`,
		);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Qieman API error: ${response.status} ${response.statusText} - ${errorText}`,
			);
		}

		// Workers/wrangler fetch automatically decompresses gzip, so use text() directly
		const text = await response.text();
		console.log(`[QiemanClient] response text length=${text.length}`);

		if (!text || text.length === 0) {
			throw new Error(
				`Qieman API returned empty response for ${path} (status: ${response.status}). The API may be blocking requests or the token may have expired. Set QIEMAN_USE_MOCK=true to use mock data.`,
			);
		}

		return JSON.parse(text);
	}

	/**
	 * 获取长赢计划信息
	 */
	async getLongWin(userPropertyId: string) {
		return this.request("/pmdj/v2/long-win", {
			userPropertyId,
			extClassify: "true",
		});
	}

	/**
	 * 获取长赢投资方案
	 */
	async getLongWinPlan(prodCode: string) {
		return this.request("/pmdj/v2/long-win/plan", { prodCode });
	}

	/**
	 * 获取长赢资产汇总
	 */
	async getLongWinAssets(capitalAccountId: string, classify = true) {
		return this.request("/pmdj/v2/long-win/ca/assets-summary", {
			capitalAccountId,
			useV2OrderApi: "true",
			classify: classify.toString(),
		});
	}
}

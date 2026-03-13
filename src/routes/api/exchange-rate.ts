import { createFileRoute } from "@tanstack/react-router";
import {
	jsonResponse,
	errorResponse,
	handleCorsPreflightRequest,
} from "@/lib/api-utils";

interface CIBRow {
	cell: string[];
	id: string;
}

interface CIBResponse {
	page: string;
	records: string;
	total: string;
	rows: CIBRow[];
}

interface ExchangeRate {
	currencyName: string;
	currencyCode: string;
	unit: number;
	fxBuyingRate: number;
	fxSellingRate: number;
	cashBuyingRate: number;
	cashSellingRate: number;
}

function extractCookies(response: Response): string {
	const cookies: string[] = [];
	response.headers.forEach((value, key) => {
		if (key.toLowerCase() === "set-cookie") {
			const cookiePart = value.split(";")[0];
			cookies.push(cookiePart);
		}
	});
	return cookies.join("; ");
}

async function fetchExchangeRates(): Promise<ExchangeRate[]> {
	// Step 1: Visit the page to obtain session cookies
	const pageRes = await fetch(
		"https://personalbank.cib.com.cn/pers/main/pubinfo/ifxQuotationQuery.do",
		{ redirect: "follow" },
	);
	const cookies = extractCookies(pageRes);
	// Consume the body to free resources
	await pageRes.text();

	// Step 2: Query the API with the session cookies
	const url = new URL(
		"https://personalbank.cib.com.cn/pers/main/pubinfo/ifxQuotationQuery/list",
	);
	url.searchParams.set("_search", "false");
	url.searchParams.set("dataSet.nd", String(Date.now()));
	url.searchParams.set("dataSet.rows", "80");
	url.searchParams.set("dataSet.page", "1");
	url.searchParams.set("dataSet.sidx", "");
	url.searchParams.set("dataSet.sord", "asc");

	const res = await fetch(url.toString(), {
		method: "GET",
		headers: {
			Accept: "application/json, text/javascript, */*; q=0.01",
			"X-Requested-With": "XMLHttpRequest",
			Referer:
				"https://personalbank.cib.com.cn/pers/main/pubinfo/ifxQuotationQuery.do",
			Cookie: cookies,
		},
	});

	if (!res.ok) {
		throw new Error(`CIB API responded with status ${res.status}`);
	}

	const data = (await res.json()) as CIBResponse;

	return data.rows.map((row) => ({
		currencyName: row.cell[0],
		currencyCode: row.cell[1],
		unit: Number.parseFloat(row.cell[2]),
		fxBuyingRate: Number.parseFloat(row.cell[3]),
		fxSellingRate: Number.parseFloat(row.cell[4]),
		cashBuyingRate: Number.parseFloat(row.cell[5]),
		cashSellingRate: Number.parseFloat(row.cell[6]),
	}));
}

export const Route = createFileRoute("/api/exchange-rate")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

			GET: async ({ request }) => {
				const url = new URL(request.url);
				const currency = url.searchParams.get("currency")?.toUpperCase();

				try {
					const rates = await fetchExchangeRates();
					const queryTime = new Date().toLocaleString("zh-CN", {
						timeZone: "Asia/Shanghai",
						hour12: false,
					});

					if (currency) {
						const found = rates.find((r) => r.currencyCode === currency);
						if (!found) {
							return errorResponse(
								`Currency not found: ${currency}`,
								404,
							);
						}
						return jsonResponse({ ...found, queryTime });
					}

					return jsonResponse({ rates, queryTime });
				} catch (error) {
					console.error("Exchange rate fetch error:", error);
					return errorResponse(
						error instanceof Error
							? error.message
							: "Failed to fetch exchange rates",
						500,
					);
				}
			},
		},
	},
});

import type { LongWinPlanResponse } from "./types";

interface QiemanApiResponse<T> {
  code?: number;
  message?: string;
  data?: T | null;
}

export class QiemanPlanFetchError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "QiemanPlanFetchError";
    this.status = status;
  }
}

async function createSign(): Promise<string> {
  const ts = Date.now();
  const value = Math.floor(1.01 * ts).toString();
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return `${ts}${hash.substring(0, 32)}`;
}

function isLongWinPlanResponse(value: unknown): value is LongWinPlanResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<LongWinPlanResponse>;

  return (
    typeof candidate.establishDate === "number" &&
    !!candidate.tradeLimit &&
    typeof candidate.tradeLimit === "object" &&
    typeof candidate.tradeLimit.minUnitAmount === "number" &&
    typeof candidate.tradeLimit.maxUnitAmount === "number" &&
    Array.isArray(candidate.composition)
  );
}

function extractLongWinPlanData(payload: unknown): LongWinPlanResponse {
  if (isLongWinPlanResponse(payload)) {
    return payload;
  }

  const wrappedData =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as QiemanApiResponse<unknown>).data
      : undefined;

  if (isLongWinPlanResponse(wrappedData)) {
    return wrappedData;
  }

  const message =
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof (payload as QiemanApiResponse<unknown>).message === "string"
      ? (payload as QiemanApiResponse<unknown>).message
      : "Qieman API response is missing long-win plan data";
  const code =
    payload &&
    typeof payload === "object" &&
    "code" in payload &&
    typeof (payload as QiemanApiResponse<unknown>).code === "number"
      ? (payload as QiemanApiResponse<unknown>).code
      : 502;

  throw new QiemanPlanFetchError(`Qieman API error: ${code} - ${message}`, 502);
}

export async function loadLongWinPlan(
  prodCode: string,
): Promise<LongWinPlanResponse> {
  if (!prodCode) {
    throw new QiemanPlanFetchError("Missing required parameter: prodCode", 400);
  }

  const xSign = await createSign();
  const apiUrl = `https://qieman.com/pmdj/v2/long-win/plan?prodCode=${encodeURIComponent(prodCode)}`;
  const response = await fetch(apiUrl, {
    headers: {
      "x-sign": xSign,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new QiemanPlanFetchError(
      `Qieman API error: ${response.status} - ${errorText}`,
      response.status,
    );
  }

  const payload = (await response.json()) as
    | QiemanApiResponse<LongWinPlanResponse>
    | LongWinPlanResponse;

  return extractLongWinPlanData(payload);
}

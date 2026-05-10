function formatPercent(val: number | null | undefined): string {
  if (val == null) {
    return "-";
  }
  return `${(val * 100).toFixed(2)}%`;
}

function formatProfit(val: number | null | undefined): string {
  if (val == null) {
    return "-";
  }
  const sign = val >= 0 ? "+" : "";
  return `${sign}${(val * 100).toFixed(2)}%`;
}

function formatDailyReturn(val: number | null | undefined): string {
  if (val == null) {
    return "-";
  }
  const sign = val >= 0 ? "+" : "";
  return `${sign}${(val * 100).toFixed(2)}%`;
}

function formatEstablishDate(ts: number | null | undefined): string {
  if (!ts) {
    return "-";
  }
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderFundFull(comp: any): string {
  const fund = comp.fund || {};
  const fundName = fund.fundName || "-";
  const fundCode = fund.fundCode || "-";
  const nav = comp.nav != null ? comp.nav.toFixed(4) : "-";
  const daily = formatDailyReturn(comp.dailyReturn);
  const planUnit = comp.planUnit != null ? comp.planUnit : "-";
  const percent = formatPercent(comp.percent);
  const accProfit = formatProfit(comp.accProfit);

  let line = `【${fundCode}】${fundName}\n`;
  line += `净值: ${nav} | 日涨跌: ${daily}\n`;
  line += `份数: ${planUnit} (占${percent}) 累计收益: ${accProfit}`;

  return line;
}

function renderFundBrief(comp: any): string {
  const fund = comp.fund || {};
  const fundName = fund.fundName || "-";
  const fundCode = fund.fundCode || "-";
  return `【${fundCode}】${fundName}`;
}

export function transform(data: any): string {
  const lines: string[] = [];

  lines.push("长赢150份");

  const info = data.data || {};

  const compositions = info.composition || [];

  const zeroUnitFunds: any[] = [];

  for (const cls of compositions) {
    if (cls.isCash) {
      continue;
    }

    const className = cls.className || "其他";
    const compList = cls.compList || [];
    const hasUnit = compList.filter((c: any) => c.planUnit > 0);
    const noUnit = compList.filter((c: any) => c.planUnit === 0);

    if (noUnit.length > 0) {
      for (const comp of noUnit) {
        zeroUnitFunds.push(comp);
      }
    }

    if (hasUnit.length === 0) {
      continue;
    }

    const totalUnit = hasUnit.reduce(
      (s: number, c: any) => s + (c.planUnit || 0),
      0,
    );
    const classPercent = formatPercent(cls.percent);

    lines.push("");
    lines.push(
      `【${className}】共${hasUnit.length}只 ${totalUnit}份(占${classPercent})`,
    );
    lines.push("─".repeat(10));

    for (const comp of hasUnit) {
      lines.push(renderFundFull(comp));
      lines.push("");
    }
  }

  if (zeroUnitFunds.length > 0) {
    lines.push("");
    lines.push(`【已清仓】共${zeroUnitFunds.length}只`);
    lines.push("─".repeat(10));
    for (const comp of zeroUnitFunds) {
      lines.push(renderFundBrief(comp));
    }
  }

  return lines.join("\n");
}

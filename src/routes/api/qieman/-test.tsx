import { Action, ActionPanel, Color, List } from "@raycast/api";
import CryptoJS from "crypto-js";
import fetch from "node-fetch";
import { useEffect, useState } from "react";
import QiemanDetail from "./QiemanDetail";
import type { CompListItem, FundInfo } from "./types";

export default function Command() {
  const [fundList, setFundList] = useState<CompListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const getTagList = (fundItem: CompListItem) => {
    return [
      {
        tag: {
          value: `${(fundItem.dailyReturn * 100).toFixed(2)}%`,
          color: fundItem.dailyReturn < 0 ? Color.Green : Color.Red,
        },
      },
    ];
  };

  // 定义 createSign 函数
  function createSign() {
    // 获取当前时间戳
    const ts = Date.now();
    // 计算一个基于时间戳的值，乘以1.01并向下取整，然后转换为字符串
    const value = Math.floor(1.01 * ts).toString();
    // 使用 SHA256 算法生成哈希值
    const hash = CryptoJS.SHA256(value)
      .toString(CryptoJS.enc.Hex)
      .toUpperCase();
    // 返回时间戳和哈希值的前32个字符的组合
    return `${ts}${hash.substring(0, 32)}`;
  }

  // https://qieman.com/pmdj/v1/funds/001064/nav-history?start=2015-07-01&end=2024-10-10 TODO: 曲线数据 使用ai设计算法
  const test = (xSign: string) => {
    return fetch("https://qieman.com/pmdj/v2/long-win/plan?prodCode=LONG_WIN", {
      headers: {
        "x-sign": xSign,
      },
    })
      .then((res) => res.json())
      .then((data: FundInfo): CompListItem[] => {
        return data.composition.reduce((acc, cur) => {
          return [...acc, ...cur.compList];
        }, []);
      });
  };

  useEffect(() => {
    (async () => {
      const res = createSign();
      const list = await test(res); // TODO: 取缓存
      // const list = await getFundListWithCache();
      setFundList(
        list
          .filter((a) => a.planUnit > 0)
          .sort((a, b) => b.dailyReturn - a.dailyReturn),
      );
      setIsLoading(false);
    })();
  }, []);

  return (
    <List isLoading={isLoading}>
      {fundList.map((fundItem, index) => (
        <List.Item
          key={index}
          title={fundItem.fund?.fundName?.slice(2) || ""}
          // 1.昨日净值涨幅 2.今日估值涨幅 3.买入后涨幅(使用估值计算)
          accessories={getTagList(fundItem)}
          subtitle={`${fundItem.fund?.fundCode}(${fundItem.fund?.navDate?.slice(5)})`}
          actions={
            <ActionPanel>
              <Action.Push
                title="Detail Info"
                target={<QiemanDetail fundData={fundItem} />}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { allPlugins, pluginMap } from "../src/searchplugins/index.ts";
import type {
  BasePluginInterface,
  SearchResult,
} from "../src/searchplugins/types.ts";

const DEFAULT_KEYWORD = "凡人修仙传";
const DEFAULT_OUTPUT_DIR = "tmp/plugin-quark-audit";
const DEFAULT_CONCURRENCY = 1;

interface CliOptions {
  keyword: string;
  outputDir: string;
  concurrency: number;
  pluginNames: string[];
}

interface PluginSummary {
  totalResults: number;
  resultsWithQuark: number;
  totalLinks: number;
  quarkLinks: number;
  quarkResultRatio: number;
  quarkLinkRatio: number;
}

interface DerivedResult {
  uniqueId: string;
  title: string;
  datetime: string;
  channel?: string;
  hasQuark: boolean;
  quarkLinkCount: number;
  quarkLinks: SearchResult["links"];
  totalLinkCount: number;
}

interface PluginAuditRecord {
  pluginName: string;
  keyword: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  success: boolean;
  error: null | {
    name: string;
    message: string;
    stack?: string;
  };
  summary: PluginSummary;
  derivedResults: DerivedResult[];
  results: SearchResult[];
}

interface IndexRecord {
  runStartedAt: string;
  runFinishedAt: string;
  keyword: string;
  outputDir: string;
  concurrency: number;
  pluginCount: number;
  plugins: Array<{
    pluginName: string;
    success: boolean;
    durationMs: number;
    outputFile: string;
    summary: PluginSummary;
    error: PluginAuditRecord["error"];
  }>;
  rankings: {
    byQuarkLinks: string[];
    byQuarkResultRatio: string[];
    byDurationMs: string[];
  };
}

function printHelp(): void {
  console.log(`Usage: pnpm audit:plugin-quark [options]

Options:
  --keyword <text>       Search keyword. Default: ${DEFAULT_KEYWORD}
  --plugin <names>       Comma-separated plugin names. Can be passed multiple times.
  --output-dir <path>    Output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --concurrency <number> Max concurrent plugin executions. Default: ${DEFAULT_CONCURRENCY}
  --help                 Show this help message
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    keyword: DEFAULT_KEYWORD,
    outputDir: DEFAULT_OUTPUT_DIR,
    concurrency: DEFAULT_CONCURRENCY,
    pluginNames: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--keyword") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --keyword");
      }
      options.keyword = value;
      index += 1;
      continue;
    }

    if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --output-dir");
      }
      options.outputDir = value;
      index += 1;
      continue;
    }

    if (arg === "--concurrency") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("Invalid value for --concurrency");
      }
      options.concurrency = value;
      index += 1;
      continue;
    }

    if (arg === "--plugin") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --plugin");
      }
      options.pluginNames.push(
        ...value
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      );
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function getSelectedPlugins(pluginNames: string[]): BasePluginInterface[] {
  if (pluginNames.length === 0) {
    return [...allPlugins];
  }

  const unknownNames = pluginNames.filter((name) => !(name in pluginMap));
  if (unknownNames.length > 0) {
    throw new Error(`Unknown plugins: ${unknownNames.join(", ")}`);
  }

  return pluginNames.map((name) => pluginMap[name]);
}

function summarizeResults(results: SearchResult[]): PluginSummary {
  const totalResults = results.length;
  const totalLinks = results.reduce(
    (sum, result) => sum + result.links.length,
    0,
  );
  const resultsWithQuark = results.filter((result) =>
    result.links.some((link) => link.type === "quark"),
  ).length;
  const quarkLinks = results.reduce(
    (sum, result) =>
      sum + result.links.filter((link) => link.type === "quark").length,
    0,
  );

  return {
    totalResults,
    resultsWithQuark,
    totalLinks,
    quarkLinks,
    quarkResultRatio: totalResults === 0 ? 0 : resultsWithQuark / totalResults,
    quarkLinkRatio: totalLinks === 0 ? 0 : quarkLinks / totalLinks,
  };
}

function buildDerivedResults(results: SearchResult[]): DerivedResult[] {
  return results.map((result) => {
    const quarkLinks = result.links.filter((link) => link.type === "quark");
    return {
      uniqueId: result.uniqueId,
      title: result.title,
      datetime: result.datetime,
      channel: result.channel,
      hasQuark: quarkLinks.length > 0,
      quarkLinkCount: quarkLinks.length,
      quarkLinks,
      totalLinkCount: result.links.length,
    };
  });
}

function normalizeError(error: unknown): PluginAuditRecord["error"] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  async function consume(): Promise<void> {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      await worker(items[currentIndex]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await consume();
    }),
  );
}

function toOutputFileName(pluginName: string): string {
  return `${pluginName}.json`;
}

async function auditPlugin(
  plugin: BasePluginInterface,
  keyword: string,
  outputDir: string,
): Promise<{
  pluginName: string;
  outputFile: string;
  record: PluginAuditRecord;
}> {
  const startedAt = new Date();
  console.log(`[audit] start ${plugin.name}`);

  let results: SearchResult[] = [];
  let success = true;
  let error: PluginAuditRecord["error"] = null;

  try {
    results = await plugin.search(keyword, {});
  } catch (caughtError) {
    success = false;
    error = normalizeError(caughtError);
  }

  const finishedAt = new Date();
  const record: PluginAuditRecord = {
    pluginName: plugin.name,
    keyword,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    success,
    error,
    summary: summarizeResults(results),
    derivedResults: buildDerivedResults(results),
    results,
  };

  const outputFile = toOutputFileName(plugin.name);
  await writeFile(
    path.join(outputDir, outputFile),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `[audit] done ${plugin.name} success=${success} quarkLinks=${record.summary.quarkLinks} totalResults=${record.summary.totalResults}`,
  );

  return {
    pluginName: plugin.name,
    outputFile,
    record,
  };
}

function buildIndex(
  runStartedAt: string,
  keyword: string,
  outputDir: string,
  concurrency: number,
  pluginRecords: Array<{
    pluginName: string;
    outputFile: string;
    record: PluginAuditRecord;
  }>,
): IndexRecord {
  const plugins = pluginRecords.map(({ pluginName, outputFile, record }) => ({
    pluginName,
    success: record.success,
    durationMs: record.durationMs,
    outputFile,
    summary: record.summary,
    error: record.error,
  }));

  const byQuarkLinks = [...plugins]
    .sort((left, right) => right.summary.quarkLinks - left.summary.quarkLinks)
    .map((item) => item.pluginName);

  const byQuarkResultRatio = [...plugins]
    .sort(
      (left, right) =>
        right.summary.quarkResultRatio - left.summary.quarkResultRatio,
    )
    .map((item) => item.pluginName);

  const byDurationMs = [...plugins]
    .sort((left, right) => left.durationMs - right.durationMs)
    .map((item) => item.pluginName);

  return {
    runStartedAt,
    runFinishedAt: new Date().toISOString(),
    keyword,
    outputDir,
    concurrency,
    pluginCount: plugins.length,
    plugins,
    rankings: {
      byQuarkLinks,
      byQuarkResultRatio,
      byDurationMs,
    },
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const selectedPlugins = getSelectedPlugins(options.pluginNames);
  const outputDir = path.resolve(process.cwd(), options.outputDir);
  const runStartedAt = new Date().toISOString();

  await mkdir(outputDir, { recursive: true });

  console.log(
    `[audit] keyword="${options.keyword}" plugins=${selectedPlugins.length} concurrency=${options.concurrency}`,
  );
  console.log(`[audit] outputDir=${outputDir}`);

  const pluginRecords: Array<{
    pluginName: string;
    outputFile: string;
    record: PluginAuditRecord;
  }> = [];

  await runWithConcurrency(
    selectedPlugins,
    options.concurrency,
    async (plugin) => {
      const result = await auditPlugin(plugin, options.keyword, outputDir);
      pluginRecords.push(result);
    },
  );

  pluginRecords.sort((left, right) =>
    left.pluginName.localeCompare(right.pluginName),
  );

  const indexRecord = buildIndex(
    runStartedAt,
    options.keyword,
    outputDir,
    options.concurrency,
    pluginRecords,
  );

  await writeFile(
    path.join(outputDir, "index.json"),
    `${JSON.stringify(indexRecord, null, 2)}\n`,
    "utf8",
  );

  console.log("[audit] index written");
}

const entryArg = process.argv[1];

if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  main().catch((error) => {
    console.error("[audit] fatal error", error);
    process.exitCode = 1;
  });
}

/**
 * 插件索引文件
 * 导出所有插件和 searchAll 函数
 */

// Import all plugins
import Aikanzy from "./aikanzy";
import Ash from "./ash";
import Bixin from "./bixin";
import Cldi from "./cldi";
import Clmao from "./clmao";
import Clxiong from "./clxiong";
import Cyg from "./cyg";
import Daishudj from "./daishudj";
import Ddys from "./ddys";
import Discourse from "./discourse";
import Djgou from "./djgou";
import Duoduo from "./duoduo";
import Dyyj from "./dyyj";
import Erxiao from "./erxiao";
import Feikuai from "./feikuai";
import Fox4k from "./fox4k";
import Gying from "./gying";
import Hdr4k from "./hdr4k";
import Huban from "./huban";
import Hunhepan from "./hunhepan";
import Javdb from "./javdb";
import Jutoushe from "./jutoushe";
import Kkv from "./kkv";
import Labi from "./labi";
import Libvio from "./libvio";
import Lou1 from "./lou1";
import Mikuclub from "./mikuclub";
import Muou from "./muou";
import Nyaa from "./nyaa";
import Ouge from "./ouge";
import Pan666 from "./pan666";
import Pansearch from "./pansearch";
import Panta from "./panta";
import Panwiki from "./panwiki";
import Panyq from "./panyq";
import Qingying from "./qingying";
import Qqpd from "./qqpd";
import Quark4k from "./quark4k";
import Quarksoo from "./quarksoo";
import Qupanshe from "./qupanshe";
import Sdso from "./sdso";
import { searchAll } from "./searchAll";
import Shandian from "./shandian";
import Susu from "./susu";
import Thepiratebay from "./thepiratebay";
import type { BasePluginInterface } from "./types";
import U3c3 from "./u3c3";
import Wanou from "./wanou";
import Weibo from "./weibo";
import Wuji from "./wuji";
import Xb6v from "./xb6v";
import Xinjuc from "./xinjuc";
import Xuexizhinan from "./xuexizhinan";
import Ypfxw from "./ypfxw";
import Yuhuage from "./yuhuage";
import Zhizhen from "./zhizhen";
import Zxzj from "./zxzj";

const pluginMap: Record<string, BasePluginInterface> = {
  aikanzy: new Aikanzy(),
  ash: new Ash(),
  bixin: new Bixin(),
  cldi: new Cldi(),
  clmao: new Clmao(),
  clxiong: new Clxiong(),
  cyg: new Cyg(),
  daishudj: new Daishudj(),
  ddys: new Ddys(),
  discourse: new Discourse(),
  djgou: new Djgou(),
  duoduo: new Duoduo(),
  dyyj: new Dyyj(),
  erxiao: new Erxiao(),
  feikuai: new Feikuai(),
  fox4k: new Fox4k(),
  gying: new Gying(),
  hdr4k: new Hdr4k(),
  huban: new Huban(),
  hunhepan: new Hunhepan(),
  javdb: new Javdb(),
  jutoushe: new Jutoushe(),
  kkv: new Kkv(),
  labi: new Labi(),
  libvio: new Libvio(),
  lou1: new Lou1(),
  mikuclub: new Mikuclub(),
  muou: new Muou(),
  nyaa: new Nyaa(),
  ouge: new Ouge(),
  pan666: new Pan666(),
  pansearch: new Pansearch(),
  panta: new Panta(),
  panwiki: new Panwiki(),
  panyq: new Panyq(),
  qingying: new Qingying(),
  qqpd: new Qqpd(),
  quark4k: new Quark4k(),
  quarksoo: new Quarksoo(),
  qupanshe: new Qupanshe(),
  sdso: new Sdso(),
  shandian: new Shandian(),
  susu: new Susu(),
  thepiratebay: new Thepiratebay(),
  u3c3: new U3c3(),
  wanou: new Wanou(),
  weibo: new Weibo(),
  wuji: new Wuji(),
  xb6v: new Xb6v(),
  xinjuc: new Xinjuc(),
  xuexizhinan: new Xuexizhinan(),
  ypfxw: new Ypfxw(),
  yuhuage: new Yuhuage(),
  zhizhen: new Zhizhen(),
  zxzj: new Zxzj(),
};

const allPlugins: BasePluginInterface[] = Object.values(pluginMap);

export { searchAll, pluginMap, allPlugins };

/**
 * 插件索引文件
 * 导出所有插件和 searchAll 函数
 */

// Import all plugins
import Ahhhhfs from "./ahhhhfs";
import Aikanzy from "./aikanzy";
import Alupan from "./alupan";
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
import Haisou from "./haisou";
import Hdmoli from "./hdmoli";
import Hdr4k from "./hdr4k";
import Huban from "./huban";
import Hunhepan from "./hunhepan";
import Javdb from "./javdb";
import Jikepan from "./jikepan";
import Jsnoteclub from "./jsnoteclub";
import Jutoushe from "./jutoushe";
import Kkmao from "./kkmao";
import Kkv from "./kkv";
import Labi from "./labi";
import Leijing from "./leijing";
import Libvio from "./libvio";
import Lou1 from "./lou1";
import Meitizy from "./meitizy";
import Miaoso from "./miaoso";
import Mikuclub from "./mikuclub";
import Mizixing from "./mizixing";
import Muou from "./muou";
import Nsgame from "./nsgame";
import Nyaa from "./nyaa";
import Ouge from "./ouge";
import Pan666 from "./pan666";
import Pansearch from "./pansearch";
import Panta from "./panta";
import Panwiki from "./panwiki";
import Panyq from "./panyq";
import Pianku from "./pianku";
import Qingying from "./qingying";
import Qqpd from "./qqpd";
import Quark4k from "./quark4k";
import Quarksoo from "./quarksoo";
import Qupanshe from "./qupanshe";
import Qupansou from "./qupansou";
import Sdso from "./sdso";
import { searchAll } from "./searchAll";
import Shandian from "./shandian";
import Sousou from "./sousou";
import Susu from "./susu";
import Thepiratebay from "./thepiratebay";
import type { BasePluginInterface } from "./types";
import U3c3 from "./u3c3";
import Wanou from "./wanou";
import Weibo from "./weibo";
import Wuji from "./wuji";
import Xb6v from "./xb6v";
import Xdpan from "./xdpan";
import Xdyh from "./xdyh";
import Xiaoji from "./xiaoji";
import Xiaozhang from "./xiaozhang";
import Xinjuc from "./xinjuc";
import Xuexizhinan from "./xuexizhinan";
import Xys from "./xys";
import Yiove from "./yiove";
import Ypfxw from "./ypfxw";
import Yuhuage from "./yuhuage";
import Yunsou from "./yunsou";
import Zhizhen from "./zhizhen";
import Zxzj from "./zxzj";

const pluginMap: Record<string, BasePluginInterface> = {
  ahhhhfs: new Ahhhhfs(),
  aikanzy: new Aikanzy(),
  alupan: new Alupan(),
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
  haisou: new Haisou(),
  hdmoli: new Hdmoli(),
  hdr4k: new Hdr4k(),
  huban: new Huban(),
  hunhepan: new Hunhepan(),
  javdb: new Javdb(),
  jikepan: new Jikepan(),
  jsnoteclub: new Jsnoteclub(),
  jutoushe: new Jutoushe(),
  kkmao: new Kkmao(),
  kkv: new Kkv(),
  labi: new Labi(),
  leijing: new Leijing(),
  libvio: new Libvio(),
  lou1: new Lou1(),
  meitizy: new Meitizy(),
  miaoso: new Miaoso(),
  mikuclub: new Mikuclub(),
  mizixing: new Mizixing(),
  muou: new Muou(),
  nsgame: new Nsgame(),
  nyaa: new Nyaa(),
  ouge: new Ouge(),
  pan666: new Pan666(),
  pansearch: new Pansearch(),
  panta: new Panta(),
  panwiki: new Panwiki(),
  panyq: new Panyq(),
  pianku: new Pianku(),
  qingying: new Qingying(),
  qqpd: new Qqpd(),
  quark4k: new Quark4k(),
  quarksoo: new Quarksoo(),
  qupanshe: new Qupanshe(),
  qupansou: new Qupansou(),
  sdso: new Sdso(),
  shandian: new Shandian(),
  sousou: new Sousou(),
  susu: new Susu(),
  thepiratebay: new Thepiratebay(),
  u3c3: new U3c3(),
  wanou: new Wanou(),
  weibo: new Weibo(),
  wuji: new Wuji(),
  xb6v: new Xb6v(),
  xdpan: new Xdpan(),
  xdyh: new Xdyh(),
  xiaoji: new Xiaoji(),
  xiaozhang: new Xiaozhang(),
  xinjuc: new Xinjuc(),
  xuexizhinan: new Xuexizhinan(),
  xys: new Xys(),
  yiove: new Yiove(),
  ypfxw: new Ypfxw(),
  yuhuage: new Yuhuage(),
  yunsou: new Yunsou(),
  zhizhen: new Zhizhen(),
  zxzj: new Zxzj(),
};

const allPlugins: BasePluginInterface[] = Object.values(pluginMap);

export { searchAll, pluginMap, allPlugins };

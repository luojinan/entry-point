/**
 * 插件索引文件
 * 导出所有插件和 searchAll 函数
 */

const { searchAll } = require('./searchAll');

// Import all plugins
const Ahhhhfs = require('./ahhhhfs');
const Aikanzy = require('./aikanzy');
const Alupan = require('./alupan');
const Ash = require('./ash');
const Bixin = require('./bixin');
const Cldi = require('./cldi');
const Clmao = require('./clmao');
const Clxiong = require('./clxiong');
const Cyg = require('./cyg');
const Daishudj = require('./daishudj');
const Ddys = require('./ddys');
const Discourse = require('./discourse');
const Djgou = require('./djgou');
const Duoduo = require('./duoduo');
const Dyyj = require('./dyyj');
const Erxiao = require('./erxiao');
const Feikuai = require('./feikuai');
const Fox4k = require('./fox4k');
const Gying = require('./gying');
const Haisou = require('./haisou');
const Hdmoli = require('./hdmoli');
const Hdr4k = require('./hdr4k');
const Huban = require('./huban');
const Hunhepan = require('./hunhepan');
const Javdb = require('./javdb');
const Jikepan = require('./jikepan');
const Jsnoteclub = require('./jsnoteclub');
const Jutoushe = require('./jutoushe');
const Kkmao = require('./kkmao');
const Kkv = require('./kkv');
const Labi = require('./labi');
const Leijing = require('./leijing');
const Libvio = require('./libvio');
const Lou1 = require('./lou1');
const Meitizy = require('./meitizy');
const Miaoso = require('./miaoso');
const Mikuclub = require('./mikuclub');
const Mizixing = require('./mizixing');
const Muou = require('./muou');
const Nsgame = require('./nsgame');
const Nyaa = require('./nyaa');
const Ouge = require('./ouge');
const Pan666 = require('./pan666');
const Pansearch = require('./pansearch');
const Panta = require('./panta');
const Panwiki = require('./panwiki');
const Panyq = require('./panyq');
const Pianku = require('./pianku');
const Qingying = require('./qingying');
const Qqpd = require('./qqpd');
const Quark4k = require('./quark4k');
const Quarksoo = require('./quarksoo');
const Qupanshe = require('./qupanshe');
const Qupansou = require('./qupansou');
const Sdso = require('./sdso');
const Shandian = require('./shandian');
const Sousou = require('./sousou');
const Susu = require('./susu');
const Thepiratebay = require('./thepiratebay');
const U3c3 = require('./u3c3');
const Wanou = require('./wanou');
const Weibo = require('./weibo');
const Wuji = require('./wuji');
const Xb6v = require('./xb6v');
const Xdpan = require('./xdpan');
const Xdyh = require('./xdyh');
const Xiaoji = require('./xiaoji');
const Xiaozhang = require('./xiaozhang');
const Xinjuc = require('./xinjuc');
const Xuexizhinan = require('./xuexizhinan');
const Xys = require('./xys');
const Yiove = require('./yiove');
const Ypfxw = require('./ypfxw');
const Yuhuage = require('./yuhuage');
const Yunsou = require('./yunsou');
const Zhizhen = require('./zhizhen');
const Zxzj = require('./zxzj');

const pluginMap = {
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

const allPlugins = Object.values(pluginMap);

module.exports = { searchAll, pluginMap, allPlugins };

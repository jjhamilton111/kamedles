// Series order, home-page groups, and per-series accent colors. Character data lives in data/<slug>.js.
window.DLE = window.DLE || {};
window.DLE.series = window.DLE.series || {};
window.DLE.groups = [
  { label: "Anime", ids: ["onepiece", "naruto", "aot", "jjk", "mha", "hxh", "dragonball", "blackclover", "csm", "frieren"] },
  { label: "Cartoons & live-action", ids: ["avatar", "korra", "spongebob", "powerrangers", "teennick", "got"] }
];
window.DLE.order = window.DLE.groups.flatMap(g => g.ids);
window.DLE.meta = {
  onepiece:     { accent: "#ff6b3d" },
  naruto:       { accent: "#ffa51f" },
  dragonball:   { accent: "#ffd23f" },
  aot:          { accent: "#a4bd5f" },
  hxh:          { accent: "#5ad48c" },
  frieren:      { accent: "#7fe0d0" },
  mha:          { accent: "#4f8dff" },
  jjk:          { accent: "#8f84ff" },
  blackclover:  { accent: "#c78bff" },
  csm:          { accent: "#ff4d4d" },
  avatar:       { accent: "#5cc8ff" },
  korra:        { accent: "#9ad0ff" },
  spongebob:    { accent: "#e8f25a" },
  powerrangers: { accent: "#ff5fa2" },
  teennick:     { accent: "#8ee04e" },
  got:          { accent: "#d9b36c" }
};

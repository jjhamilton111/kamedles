#!/usr/bin/env node
// Bundles the multi-file site into single-file builds:
//   dist/index.html      — standalone page (open directly or host anywhere)
//   dist/artifact.html   — same content without the document skeleton, for publishing as a claude.ai artifact
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");

let html = read("index.html");
html = html.replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>\n${read("css/style.css")}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${read(src)}\n</script>`);
if (html.includes("</script>\n</script>")) throw new Error("nested script end tag");

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist/index.html"), html);

const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta[^>]*>\s*/g, "");
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
fs.writeFileSync(path.join(root, "dist/artifact.html"), head.trim() + "\n" + body.trim() + "\n");
console.log("built dist/index.html (%d KB) and dist/artifact.html", Math.round(html.length / 1024));

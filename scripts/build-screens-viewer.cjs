/* eslint-disable @typescript-eslint/no-require-imports */
// Builds a role-separated screen viewer (single HTML) from artifacts/figma/screens.html. Usage: node scripts/build-screens-viewer.cjs
const fs = require("fs");
const src = fs.readFileSync("artifacts/figma/screens.html", "utf8");
const css = /<style>([\s\S]*?)\n\.sq-screen\{/.exec(src)[1];
const screens = [...src.matchAll(/<section class="sq-screen" data-name="([^"]+)">([\s\S]*?)<\/section>\n/g)].map((m) => {
  const [role, path] = m[1].split(" ");
  return { role, path, html: m[2] };
});
const data = JSON.stringify({ css, screens }).replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
const page = fs.readFileSync("scripts/screens-viewer.template.html", "utf8").replace("/*DATA*/", () => data);
fs.writeFileSync("artifacts/figma/viewer.html", page);
console.log(screens.length, "screens,", (page.length / 1024).toFixed(0), "KB");

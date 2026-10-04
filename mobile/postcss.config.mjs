import fs from "node:fs";
import path from "node:path";

// ../app/globals.css starts with `@import "tailwindcss"`, which can't resolve
// from the parent folder (Tailwind is installed here). Inline the file without
// that line; src/dom/havenos.css imports Tailwind itself.
const inlineSharedGlobals = () => ({
  postcssPlugin: "havenos-inline-shared-globals",
  Once(root, { parse }) {
    root.walkAtRules("import", (rule) => {
      const m = /^["'](.+\/app\/globals\.css)["']$/.exec(rule.params.trim());
      if (!m || !root.source?.input.file) return;
      const file = path.resolve(path.dirname(root.source.input.file), m[1]);
      const css = fs.readFileSync(file, "utf8").replace(/@import\s+["']tailwindcss["'];?/, "");
      rule.replaceWith(parse(css, { from: file }).nodes);
    });
  },
});
inlineSharedGlobals.postcss = true;

export default {
  plugins: [inlineSharedGlobals, "@tailwindcss/postcss"],
};

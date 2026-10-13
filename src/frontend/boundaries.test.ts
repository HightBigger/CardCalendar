import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
const root = path.resolve("src");
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap((item) => item.isDirectory() ? files(path.join(dir, item.name)) : !item.name.startsWith("._") && /\.(ts|tsx)$/.test(item.name) && !item.name.includes(".test.") ? [path.join(dir, item.name)] : []); }
it("enforces frontend/feature/model/shared import boundaries and UI request ownership", () => {
  const violations: string[] = [];
  for (const file of [...files(path.join(root, "frontend")), ...files(path.join(root, "contracts"))]) {
    const relative = path.relative(root, file); const text = readFileSync(file, "utf8"); const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    source.forEachChild((node) => {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
      const specifier = node.moduleSpecifier; if (!specifier || !ts.isStringLiteral(specifier)) return;
      const imported = specifier.text; const target = imported.startsWith(".") ? path.relative(root, path.resolve(path.dirname(file), imported)) : imported;
      if (/^frontend/.test(relative) && /^modules\//.test(target)) violations.push(relative + " imports server: " + target);
      if (/^(frontend\/shared|contracts)/.test(relative) && /^(frontend\/features|modules\/|frontend\/dev)/.test(target) && !file.includes(".test.")) violations.push(relative + " reverses dependency: " + target);
      const own = relative.match(/^frontend\/features\/([^/]+)\//)?.[1]; const other = target.match(/^frontend\/features\/([^/]+)(.*)$/);
      if (own && other && own !== other[1] && other[2] !== "" && other[2] !== "/index") violations.push(relative + " imports feature internals: " + target);
      if (own && /\/(model)\//.test(relative) && (/react|http|\/api\//.test(target))) violations.push(relative + " impure model: " + target);
      if (own && /\/ui\//.test(relative) && /\/api\/|\/shared\/http/.test(target)) violations.push(relative + " UI imports transport: " + target);
    });
    if (/^frontend\/features\/[^/]+\/ui\//.test(relative) && /\b(fetch|apiJson|apiCommand)\s*\(/.test(text)) violations.push(relative + " UI sends request");
  }
  expect(violations).toEqual([]);
});

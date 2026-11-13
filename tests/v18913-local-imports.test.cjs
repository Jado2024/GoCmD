/* Vérifie les imports locaux, pour éviter un build incomplet lors d'une livraison. */
"use strict"
const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")

const root = path.resolve(__dirname, "..")
const source = path.join(root, "src")
const files = []
const errors = []
const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".json"]

function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(absolute)
    else if (/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(entry.name)) files.push(absolute)
  }
}

function verify(from, specifier) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return
  const target = specifier.startsWith("@/")
    ? path.join(source, specifier.slice(2))
    : path.resolve(path.dirname(from), specifier)
  const candidates = [
    ...extensions.map(ext => target + ext),
    ...extensions.slice(1).map(ext => path.join(target, "index" + ext)),
  ]
  if (!candidates.some(p => fs.existsSync(p) && fs.statSync(p).isFile())) {
    errors.push(`${path.relative(root, from)} -> ${specifier}`)
  }
}

collect(source)
for (const file of files) {
  const contents = fs.readFileSync(file, "utf8")
  const parsed = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true)
  if (parsed.parseDiagnostics.length) {
    errors.push(`Syntaxe invalide : ${path.relative(root, file)}`)
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      verify(file, node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
         (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        ts.isStringLiteral(node.arguments[0])) {
      verify(file, node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
}
if (errors.length) {
  console.error(`ÉCHEC : ${errors.length} import(s) ou fichier(s) problématique(s) :`)
  for (const err of errors) console.error(`  ${err}`)
  process.exit(1)
}
console.log(`PASS : ${files.length} fichiers source contrôlés, aucun import local manquant`)

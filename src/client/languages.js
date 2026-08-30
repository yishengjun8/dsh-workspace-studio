import { Prec } from '@codemirror/state'
import { Decoration, ViewPlugin } from '@codemirror/view'
import { HighlightStyle, StreamLanguage, syntaxTree } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { rust } from '@codemirror/lang-rust'
import { php } from '@codemirror/lang-php'
import { go } from '@codemirror/lang-go'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { clike } from '@codemirror/legacy-modes/mode/clike'
export const tokenHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--shiki-token-comment)' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--shiki-token-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--shiki-token-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--shiki-token-constant)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.typeName, tags.className, tags.namespace], color: 'var(--shiki-token-function)' },
  // Name-definition tokens (declaration position) ride the type color;
  // StreamLanguage emits them as `variableName.definition`, which the bare
  // variableName rule above misses.
  { tag: [tags.definition(tags.variableName), tags.definition(tags.typeName), tags.definition(tags.propertyName)], color: 'var(--shiki-token-function)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--shiki-token-parameter)' },
  { tag: [tags.heading, tags.link, tags.url], color: 'var(--shiki-token-link)' },
  // Preprocessor directives: purple via the directive variable. NOTE: tags.meta
  // must not reappear in any LATER rule — a later rule wins per tag and would
  // strip the directive color from C# #region/#if and C preprocessor lines.
  { tag: tags.meta, color: 'var(--dsh-ws-token-directive, #8e44ad)' },
  { tag: tags.inserted, color: 'var(--shiki-token-string-expression)' },
  { tag: tags.punctuation, color: 'var(--shiki-token-punctuation)' },
  // Markup tokens: angleBracket was unstyled, character already rides the
  // string color; fallbacks preserve that unless a markup preset (e.g. VS Code
  // XML) sets the override variables.
  { tag: tags.angleBracket, color: 'var(--dsh-ws-token-xml-punctuation, inherit)' },
  { tag: tags.character, color: 'var(--dsh-ws-token-xml-entity, var(--shiki-token-string))' },
  { tag: [tags.invalid, tags.deleted], color: 'var(--dsw-alias-state-error-primary)' },
])

/* Python import-module highlighting: the module-path names inside import
   statements AND later usages of plain-import bindings (`import os` makes
   every `os` that resolves to that binding a module). lezer-python trees
   are flat inside ImportStatement (dottedName/importedNames elided at
   grammar compile time), so styleTags selectors cannot tell modules from
   variables. A ViewPlugin walks the tree with a scope stack modelled from
   the syntax nodes:
   - binding scope: `import X`, `import a.b.c` → X/a; alias `import X as Y`
     → Y. `from X import Y` names are NOT tracked (unresolvable without
     semantics) — only the from-module path is coloured in-statement;
   - shadowing: params, assignment/for/with/except targets, def/class
     names, lambda params, comprehension targets, walrus targets and match
     captures define a name in their scope; a usage resolves to the NEAREST
     binding on the scope chain, so a local definition hides every outer
     binding (Python compile-time scoping);
   - class scopes are skipped by lookups from nested functions (LEGB: a
     method does not see class attributes).
   Correctness requirements, both mirroring the official TreeHighlighter:
   1. Prec.highest — mark decorations nest by facet precedence and the text
      renders inside the INNERMOST span. The syntax-highlight plugin is
      Prec.high, so without an even higher precedence my mark wraps the
      highlight span and its color is overridden — the decoration exists
      but is invisible.
   2. Rebuild on tree identity change, not just docChanged: the Lezer parse
      advances in background chunks (Language.setState transactions with
      stateChanged but no docChanged), so a docChanged-only rebuild misses
      imports beyond the synchronously parsed prefix. */
export const pythonModuleMark = Decoration.mark({ class: 'dsh-ws-token-module' })
export const pythonImportModules = Prec.highest(ViewPlugin.fromClass(class {
  constructor(view) { this.tree = syntaxTree(view.state); this.decorations = this.build(view) }
  update(update) {
    const tree = syntaxTree(update.state)
    if (tree !== this.tree) {
      this.tree = tree
      this.decorations = this.build(update.view)
    }
  }
  build(view) {
    const tree = syntaxTree(view.state)
    const state = view.state
    const ranges = []
    const mark = (from, to) => ranges.push(pythonModuleMark.range(from, to))
    const text = (node) => state.sliceDoc(node.from, node.to)
    // Scope stack; index 0 is the module scope. isClass scopes are skipped
    // by lookups from nested functions (LEGB).
    const scopes = [{ isClass: false, defined: new Set(), imports: new Map() }]
    const cur = () => scopes[scopes.length - 1]
    const def = (name) => cur().defined.add(name)
    const bind = (name, kind) => cur().imports.set(name, kind)
    // A name usage resolves to the nearest binding on the scope chain; a
    // local definition of the name shadows every outer binding.
    const usage = (node) => {
      const name = text(node)
      for (let i = scopes.length - 1; i >= 0; i--) {
        const scope = scopes[i]
        if (scope.isClass && i !== scopes.length - 1) continue
        if (scope.defined.has(name)) return
        const kind = scope.imports.get(name)
        if (kind === 'module') { mark(node.from, node.to); return }
        if (kind !== undefined) return
      }
    }
    // Register every direct VariableName target of an assignment-like node;
    // MemberExpression roots stay usages (`obj.attr = 1`).
    const defTargets = (node) => {
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name === 'VariableName') def(text(ch))
        else if (ch.name === 'MemberExpression') walk(ch)
        else if (ch.name === 'TupleExpression' || ch.name === 'ParenthesizedExpression') defTargets(ch)
        else if (ch.name === 'TypeDef') walk(ch)
      }
    }
    const typeParams = (node) => {
      for (let tp = node.firstChild; tp; tp = tp.nextSibling) {
        if (tp.name === 'TypeParam') {
          for (let v = tp.firstChild; v; v = v.nextSibling) {
            if (v.name === 'VariableName') def(text(v))
          }
        }
      }
    }
    const walk = (node) => {
      switch (node.name) {
        case 'VariableName': usage(node); return
        case 'ImportStatement': return importStatement(node)
        case 'FunctionDefinition': return functionDefinition(node)
        case 'ClassDefinition': return classDefinition(node)
        case 'LambdaExpression': return lambdaExpression(node)
        case 'ArrayComprehensionExpression':
        case 'SetComprehensionExpression':
        case 'DictionaryComprehensionExpression':
        case 'ComprehensionExpression': return comprehension(node)
        case 'AssignStatement': {
          let lastAssign = null
          for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
            if (ch.name === 'AssignOp') lastAssign = ch
          }
          for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
            // LHS targets precede the last `=`; RHS/annotations follow it.
            if (lastAssign !== null && ch.from >= lastAssign.from) { walk(ch); continue }
            if (ch.name === 'VariableName') def(text(ch))
            else if (ch.name === 'TupleExpression' || ch.name === 'ParenthesizedExpression') defTargets(ch)
            else if (ch.name === 'MemberExpression') walk(ch) // `obj.attr = ...`: root stays a usage
            else if (ch.name === 'TypeDef') walk(ch) // annotation on the LHS
          }
          return
        }
        case 'UpdateStatement': defTargets(node); return
        case 'ForStatement': {
          let inKw = null
          for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
            if (ch.name === 'in') inKw = ch
          }
          for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
            if (inKw !== null && ch.from >= inKw.from) walk(ch)
            else if (ch.name === 'VariableName') def(text(ch))
            else if (ch.name === 'TupleExpression' || ch.name === 'ParenthesizedExpression') defTargets(ch)
          }
          return
        }
        case 'WithStatement':
        case 'TryStatement': {
          // `with x as y` / `except E as e`: the name right after `as` binds.
          for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
            if (ch.name === 'VariableName' && ch.prevSibling !== null && ch.prevSibling.name === 'as') def(text(ch))
            else walk(ch)
          }
          return
        }
        case 'NamedExpression': {
          // Walrus `(x := ...)`: the first VariableName is the target.
          for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
            if (ch.name === 'VariableName') { def(text(ch)); continue }
            walk(ch)
          }
          return
        }
        case 'CapturePattern': {
          // Match patterns bind their captured names.
          for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
            if (ch.name === 'VariableName') def(text(ch))
          }
          return
        }
        default:
          for (let ch = node.firstChild; ch; ch = ch.nextSibling) walk(ch)
      }
    }
    const importStatement = (node) => {
      let importKw = null
      let fromKw = null
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name === 'import') importKw = ch
        else if (ch.name === 'from') fromKw = ch
      }
      if (fromKw !== null) {
        // from-imports: only the module path (before `import`) is coloured;
        // imported names stay ordinary variables (unresolvable statically).
        for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
          if (ch.name === 'VariableName' && importKw !== null && ch.from < importKw.from) mark(ch.from, ch.to)
        }
        return
      }
      // Plain imports: module-path parts AND aliases are coloured. The
      // binding of each comma group is its root (`import X` / `import a.b.c`
      // → X/a), unless the group has an alias (`import X as Y` → Y).
      let root = null
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name === 'VariableName') {
          mark(ch.from, ch.to)
          const prev = ch.prevSibling
          if (prev === null || prev.name === 'import' || prev.name === ',') {
            root = ch
          } else if (prev.name === 'as') {
            bind(text(ch), 'module')
            root = null
          }
        } else if (ch.name === ',') {
          if (root !== null) {
            bind(text(root), 'module')
            root = null
          }
        }
      }
      if (root !== null) bind(text(root), 'module')
    }
    const functionDefinition = (node) => {
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name === 'VariableName') { def(text(ch)); break }
      }
      scopes.push({ isClass: false, defined: new Set(), imports: new Map() })
      const funcScope = scopes[scopes.length - 1]
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name === 'VariableName') continue // def name, already registered
        if (ch.name === 'ParamList') {
          // Direct param names bind in the function scope; defaults and
          // annotations evaluate in the enclosing scope.
          for (let pch = ch.firstChild; pch; pch = pch.nextSibling) {
            if (pch.name === 'VariableName') def(text(pch))
            else {
              scopes.pop()
              walk(pch)
              scopes.push(funcScope)
            }
          }
        } else if (ch.name === 'TypeParamList') {
          typeParams(ch)
        } else {
          walk(ch) // Body, return TypeDef, async/def keywords
        }
      }
      scopes.pop()
    }
    const classDefinition = (node) => {
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name === 'VariableName') { def(text(ch)); break }
      }
      scopes.push({ isClass: true, defined: new Set(), imports: new Map() })
      const classScope = scopes[scopes.length - 1]
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name === 'VariableName') continue // class name, already registered
        if (ch.name === 'ArgList') {
          // Base classes evaluate in the enclosing scope.
          scopes.pop()
          walk(ch)
          scopes.push(classScope)
        } else if (ch.name === 'TypeParamList') {
          typeParams(ch)
        } else {
          walk(ch) // Body, class keyword
        }
      }
      scopes.pop()
    }
    const lambdaExpression = (node) => {
      scopes.push({ isClass: false, defined: new Set(), imports: new Map() })
      const lambdaScope = scopes[scopes.length - 1]
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name === 'ParamList') {
          for (let pch = ch.firstChild; pch; pch = pch.nextSibling) {
            if (pch.name === 'VariableName') def(text(pch))
            else {
              scopes.pop()
              walk(pch)
              scopes.push(lambdaScope)
            }
          }
        } else {
          walk(ch) // lambda keyword, body
        }
      }
      scopes.pop()
    }
    const comprehension = (node) => {
      scopes.push({ isClass: false, defined: new Set(), imports: new Map() })
      // Register the `for` targets first so body usages before the `for`
      // keyword already see them (Python compile-time scoping).
      let targeting = false
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name === 'for') targeting = true
        else if (ch.name === 'in') targeting = false
        else if (targeting && ch.name === 'VariableName') def(text(ch))
        else if (targeting && (ch.name === 'TupleExpression' || ch.name === 'ParenthesizedExpression')) defTargets(ch)
      }
      let afterFor = false
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.name === 'for') { afterFor = true; continue }
        if (ch.name === 'in') { afterFor = false; continue }
        if (afterFor) continue // targets already registered
        walk(ch) // body, iterables, if clauses (nested comps open their own scope)
      }
      scopes.pop()
    }
    walk(tree.topNode)
    return Decoration.set(ranges, true)
  }
}, { decorations: (v) => v.decorations }))

export const PLAIN_LANGUAGE = Object.freeze({ label: 'text', extension: [] })
export const language = (label, extension) => Object.freeze({ label, extension })
export const JS_LANGUAGE = language('js', javascript())
export const JSX_LANGUAGE = language('jsx', javascript({ jsx: true }))
export const TS_LANGUAGE = language('ts', javascript({ typescript: true }))
export const TSX_LANGUAGE = language('tsx', javascript({ typescript: true, jsx: true }))
export const JSON_LANGUAGE = language('json', json())
export const HTML_LANGUAGE = language('html', html())
export const CSS_LANGUAGE = language('css', css())
export const MARKDOWN_LANGUAGE = language('md', markdown())
export const PYTHON_LANGUAGE = language('py', [python(), pythonImportModules])
export const SQL_LANGUAGE = language('sql', sql())
export const XML_LANGUAGE = language('xml', xml())
export const YAML_LANGUAGE = language('yaml', yaml())
export const C_LANGUAGE = language('c', cpp())
export const CPP_LANGUAGE = language('c++', cpp())
export const JAVA_LANGUAGE = language('java', java())
export const RUST_LANGUAGE = language('rust', rust())
export const PHP_LANGUAGE = language('php', php())
export const GO_LANGUAGE = language('go', go())
export const SHELL_LANGUAGE = language('sh', StreamLanguage.define(shell))
export const POWERSHELL_LANGUAGE = language('powershell', StreamLanguage.define(powerShell))
export const RUBY_LANGUAGE = language('ruby', StreamLanguage.define(ruby))
export const TOML_LANGUAGE = language('toml', StreamLanguage.define(toml))
export const DOCKER_LANGUAGE = language('docker', StreamLanguage.define(dockerFile))
export const MAKE_LANGUAGE = language('make', [])
export const TEXT_LANGUAGE = language('text', [])
export const SCSS_LANGUAGE = language('scss', CSS_LANGUAGE.extension)
export const LESS_LANGUAGE = language('less', CSS_LANGUAGE.extension)
export const MDX_LANGUAGE = language('mdx', MARKDOWN_LANGUAGE.extension)
export const INI_LANGUAGE = language('ini', [])
/* C# legacy mode: replicates the clike `csharp` export (keywords, types,
   @"..." verbatim-string hook) plus a C/C++-style '#' preprocessor hook so
   #if/#define/#region render as directives (the shipped csharp export has no
   '#' hook). */
const csharpWords = (str) => {
  const obj = {}
  for (const word of str.split(' ')) obj[word] = true
  return obj
}
const csharpDirectiveHook = (stream, state) => {
  if (!state.startOfLine) return false
  let next = null
  for (let ch; (ch = stream.peek());) {
    if (ch === '\\' && stream.match(/^.$/)) { next = csharpDirectiveHook; break }
    if (ch === '/' && stream.match(/^\/[\/\*]/, false)) break
    stream.next()
  }
  state.tokenize = next
  return 'meta'
}
const csharpVerbatimString = (stream, state) => {
  let next
  while ((next = stream.next()) != null) {
    if (next === '"' && !stream.eat('"')) { state.tokenize = null; break }
  }
  return 'string'
}
export const CSHARP_MODE = clike({
  name: 'csharp',
  keywords: csharpWords('abstract as async await base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in init interface internal is lock namespace new operator out override params private protected public readonly record ref required return sealed sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using virtual void volatile while add alias ascending descending dynamic from get global group into join let orderby partial remove select set value var yield'),
  types: csharpWords('Action Boolean Byte Char DateTime DateTimeOffset Decimal Double Func Guid Int16 Int32 Int64 Object SByte Single String Task TimeSpan UInt16 UInt32 UInt64 bool byte char decimal double short int long object sbyte float string ushort uint ulong'),
  blockKeywords: csharpWords('catch class do else finally for foreach if struct switch try while'),
  defKeywords: csharpWords('class interface namespace record struct var'),
  typeFirstDefinitions: true,
  atoms: csharpWords('true false null'),
  hooks: {
    '@': (stream, state) => {
      if (stream.eat('"')) {
        state.tokenize = csharpVerbatimString
        return csharpVerbatimString(stream, state)
      }
      stream.eatWhile(/[\w$_]/)
      return 'meta'
    },
    '#': csharpDirectiveHook,
  },
})
export const CS_LANGUAGE = language('cs', StreamLanguage.define(CSHARP_MODE))

export const EXACT_LANGUAGES = Object.freeze({
  dockerfile: DOCKER_LANGUAGE,
  'dockerfile.dev': DOCKER_LANGUAGE,
  'dockerfile.prod': DOCKER_LANGUAGE,
  'dockerfile.test': DOCKER_LANGUAGE,
  makefile: MAKE_LANGUAGE,
  'package.json': JSON_LANGUAGE,
  'tsconfig.json': JSON_LANGUAGE,
  '.gitignore': TEXT_LANGUAGE,
  '.env': INI_LANGUAGE,
  license: TEXT_LANGUAGE,
})
export const EXTENSION_LANGUAGES = Object.freeze({
  js: JS_LANGUAGE, mjs: JS_LANGUAGE, cjs: JS_LANGUAGE, jsx: JSX_LANGUAGE,
  ts: TS_LANGUAGE, mts: TS_LANGUAGE, cts: TS_LANGUAGE, tsx: TSX_LANGUAGE,
  json: JSON_LANGUAGE, jsonc: JS_LANGUAGE, html: HTML_LANGUAGE, htm: HTML_LANGUAGE,
  css: CSS_LANGUAGE, scss: SCSS_LANGUAGE, less: LESS_LANGUAGE,
  md: MARKDOWN_LANGUAGE, markdown: MARKDOWN_LANGUAGE, mdx: MDX_LANGUAGE,
  py: PYTHON_LANGUAGE, sql: SQL_LANGUAGE, xml: XML_LANGUAGE, svg: XML_LANGUAGE,
  yaml: YAML_LANGUAGE, yml: YAML_LANGUAGE,
  c: C_LANGUAGE, h: C_LANGUAGE, cc: CPP_LANGUAGE, cpp: CPP_LANGUAGE, cxx: CPP_LANGUAGE, hpp: CPP_LANGUAGE,
  java: JAVA_LANGUAGE, rs: RUST_LANGUAGE, php: PHP_LANGUAGE, go: GO_LANGUAGE,
  cs: CS_LANGUAGE, csx: CS_LANGUAGE,
  sh: SHELL_LANGUAGE, bash: SHELL_LANGUAGE, zsh: SHELL_LANGUAGE,
  ps1: POWERSHELL_LANGUAGE, psm1: POWERSHELL_LANGUAGE,
  rb: RUBY_LANGUAGE, toml: TOML_LANGUAGE, ini: INI_LANGUAGE, cfg: INI_LANGUAGE,
})

export function languageFor(name) {
  const lower = name.toLowerCase()
  const exact = EXACT_LANGUAGES[lower]
  if (exact !== undefined) return exact
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return EXTENSION_LANGUAGES[extension] ?? PLAIN_LANGUAGE
}
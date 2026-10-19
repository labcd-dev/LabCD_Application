import { highlight, languages } from 'prismjs'

export type HighlightLanguage = 'python' | 'bash' | 'json'

/** Register Python grammar without Prism UMD component scripts. */
function ensurePython() {
  if (languages.python) return
  languages.python = {
    comment: {
      pattern: /(^|[^\\])#.*/,
      lookbehind: true,
      greedy: true,
    },
    'string-interpolation': {
      pattern: /(?:f|fr|rf)(?:("""|''')[\s\S]*?\1|("|')(?:\\.|(?!\2)[^\\\r\n])*\2)/i,
      greedy: true,
      inside: {
        interpolation: {
          pattern:
            /((?:^|[^{])(?:\{\{)*)\{(?!\{)(?:[^{}]|\{(?!\{)(?:[^{}]|\{(?!\{)(?:[^{}])+\})+\})+\}/,
          lookbehind: true,
          inside: {
            'format-spec': {
              pattern: /(:)[^:(){}]+(?=\}$)/,
              lookbehind: true,
            },
            'conversion-option': {
              pattern: /![sra](?=[:]$)/,
              alias: 'punctuation',
            },
            rest: null,
          },
        },
        string: /[\s\S]+/,
      },
    },
    'triple-quoted-string': {
      pattern: /(?:[rub]|br|rb)?("""|''')[\s\S]*?\1/i,
      greedy: true,
      alias: 'string',
    },
    string: {
      pattern: /(?:[rub]|br|rb)?("|')(?:\\.|(?!\1)[^\\\r\n])*\1/i,
      greedy: true,
    },
    function: {
      pattern: /((?:^|\s)def[ \t]+)[a-zA-Z_]\w*(?=\s*\()/g,
      lookbehind: true,
    },
    'class-name': {
      pattern: /(\bclass\s+)\w+/i,
      lookbehind: true,
    },
    decorator: {
      pattern: /(^[\t ]*)@\w+(?:\.\w+)*/m,
      lookbehind: true,
      alias: ['annotation', 'punctuation'],
      inside: {
        punctuation: /\./,
      },
    },
    keyword:
      /\b(?:_(?=\s*:)|and|as|assert|async|await|break|case|class|continue|def|del|elif|else|except|exec|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|print|raise|return|try|while|with|yield)\b/,
    builtin:
      /\b(?:__import__|abs|all|any|apply|ascii|basestring|bin|bool|buffer|bytearray|bytes|callable|chr|classmethod|cmp|coerce|compile|complex|delattr|dict|dir|divmod|enumerate|eval|execfile|file|filter|float|format|frozenset|getattr|globals|hasattr|hash|help|hex|id|input|int|intern|isinstance|issubclass|iter|len|list|locals|long|map|max|memoryview|min|next|object|oct|open|ord|pow|property|range|raw_input|reduce|reload|repr|reversed|round|set|setattr|slice|sorted|staticmethod|str|sum|super|tuple|type|unichr|unicode|vars|xrange|zip)\b/,
    boolean: /\b(?:False|None|True)\b/,
    number:
      /\b0(?:b(?:_?[01])+|o(?:_?[0-7])+|x(?:_?[a-f0-9])+)\b|(?:\b\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\B\.\d+(?:_\d+)*)(?:e[+-]?\d+(?:_\d+)*)?j?(?!\w)/i,
    operator: /[-+%=]=?|!=|:=|\*\*?=?|\/\/?=?|<[<=>]?|>[=>]?|[&|^~]/,
    punctuation: /[{}[\];(),.:]/,
  } as unknown as (typeof languages)[string]
  languages.py = languages.python
}

/** Lightweight shell/curl grammar for command examples. */
function ensureBash() {
  if (languages.bash) return
  languages.bash = {
    comment: {
      pattern: /(^|[^"{\\$])#.*/,
      lookbehind: true,
    },
    string: {
      pattern: /("|')(?:\\[\s\S]|(?!\1)[^\\])*\1/,
      greedy: true,
    },
    function: {
      pattern:
        /(^|[\s;|&]|[<>]\()(?:curl|wget|pip|python|python3|export|echo|cd|cat|jq|http|https)(?=$|[\s;|&])/,
      lookbehind: true,
    },
    keyword: /\b(?:if|then|else|elif|fi|for|while|in|do|done|case|esac|function|return|exit)\b/,
    boolean: /\b(?:true|false)\b/,
    variable: [
      {
        pattern: /\$\{\w+\}|\$\w+/,
      },
      {
        pattern: /(^|[\s=])[-]{1,2}[\w.-]+\b/,
        lookbehind: true,
        alias: 'attr-name',
      },
    ],
    number: /\b(?:0x[\da-f]+|\d+)\b/i,
    operator: /&&|\|\||>>?|<<?|[|;]/,
    punctuation: /[{}[\]()]/,
  } as unknown as (typeof languages)[string]
  languages.shell = languages.bash
}

function ensureJson() {
  if (languages.json) return
  languages.json = {
    property: {
      pattern: /(^|[^\\])"(?:\\.|[^\\"\r\n])*"(?=\s*:)/,
      lookbehind: true,
      greedy: true,
    },
    string: {
      pattern: /(^|[^\\])"(?:\\.|[^\\"\r\n])*"(?!\s*:)/,
      lookbehind: true,
      greedy: true,
    },
    comment: {
      pattern: /\/\/.*|\/\*[\s\S]*?(?:\*\/|$)/,
      greedy: true,
    },
    number: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i,
    punctuation: /[{}[\],:]/,
    operator: /:/,
    boolean: /\b(?:true|false)\b/,
    null: {
      pattern: /\bnull\b/,
      alias: 'keyword',
    },
  } as unknown as (typeof languages)[string]
}

export function highlightSource(code: string, language: HighlightLanguage): string {
  if (language === 'python') {
    ensurePython()
    return highlight(code, languages.python, 'python')
  }
  if (language === 'json') {
    ensureJson()
    return highlight(code, languages.json, 'json')
  }
  ensureBash()
  return highlight(code, languages.bash, 'bash')
}

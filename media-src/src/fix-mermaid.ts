/**
 * Auto-sanitize and patch Mermaid to prevent syntax errors in diagrams.
 *
 * Specifically addresses common syntax traps in Mermaid (v11+):
 * 1. stateDiagram / stateDiagram-v2:
 *    - Transition descriptions: `stateA --> stateB : Description (Direct: Validation PASS)`
 *      The lexer rule for state description is `\s*:[^:\n;]+`. A second colon on the same line
 *      terminates the token and triggers `got 'DESCR'` parse error.
 *      We replace subsequent colons in transition labels with ` — `.
 *    - Arrows inside transition descriptions: `vN -> vN+1` triggers `EDGE_STATE`.
 *      We replace `->` inside descriptions with `→`.
 *    - State definitions with extra colons: `stateA : Desc : More` -> `stateA : Desc — More`.
 */

export function sanitizeMermaidText(text: string): string {
  if (!text || typeof text !== 'string') return text

  // 1. State Diagrams (stateDiagram / stateDiagram-v2)
  if (/^\s*stateDiagram(-v2)?\b/m.test(text)) {
    const lines = text.split('\n')
    const sanitized = lines.map(line => {
      // Transition with description: e.g. "Draft --> Approved : Submit for Approval (Direct: Validation PASS)"
      const transMatch = line.match(/^(\s*[\w*\[\]-]+\s*(?:-->|->|--)\s*[\w*\[\]-]+\s*:\s*)(.*)$/)
      if (transMatch) {
        const prefix = transMatch[1]
        let desc = transMatch[2]
        desc = desc.replace(/:/g, ' —')
        desc = desc.replace(/-->/g, '⟶').replace(/->/g, '→')
        return `${prefix}${desc}`
      }

      // State definition with description: e.g. "state Draft : Some text : with colon" or "Draft : Some text : with colon"
      const stateMatch = line.match(/^(\s*(?:state\s+)?[\w*\[\]-]+\s*:\s*)(.*)$/)
      if (stateMatch) {
        const prefix = stateMatch[1]
        let desc = stateMatch[2]
        desc = desc.replace(/:/g, ' —')
        desc = desc.replace(/-->/g, '⟶').replace(/->/g, '→')
        return `${prefix}${desc}`
      }

      return line
    })
    return sanitized.join('\n')
  }

  return text
}

function patchMermaidInstance(mermaid: any): any {
  if (!mermaid || mermaid.__markpadPatched) return mermaid

  if (typeof mermaid.render === 'function') {
    const origRender = mermaid.render.bind(mermaid)
    mermaid.render = async function(id: string, text: string, ...rest: any[]) {
      const sanitized = sanitizeMermaidText(text)
      try {
        return await origRender(id, sanitized, ...rest)
      } catch (err) {
        if (sanitized !== text) {
          // If sanitized version threw, try original as fallback
          return await origRender(id, text, ...rest)
        }
        throw err
      }
    }
  }

  if (typeof mermaid.parse === 'function') {
    const origParse = mermaid.parse.bind(mermaid)
    mermaid.parse = function(text: string, ...rest: any[]) {
      const sanitized = sanitizeMermaidText(text)
      return origParse(sanitized, ...rest)
    }
  }

  mermaid.__markpadPatched = true
  return mermaid
}

export function fixMermaid() {
  const w = window as any
  if (w.mermaid) {
    patchMermaidInstance(w.mermaid)
    return
  }

  // Intercept assignment of window.mermaid when vditor loads mermaid.min.js
  let value: any
  Object.defineProperty(w, 'mermaid', {
    configurable: true,
    enumerable: true,
    get: () => value,
    set: (v: any) => {
      value = patchMermaidInstance(v)
    },
  })
}


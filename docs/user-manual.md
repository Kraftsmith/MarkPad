# MarkPad — User Manual

MarkPad is a full-featured **visual (WYSIWYG) markdown editor** for VS Code, built on
the Vditor editor and embedded in a webview. You edit your `.md` file as rendered,
formatted content — headings, tables, diagrams, images — while the file on disk stays
plain markdown.

> Tip: open this manual *in MarkPad* (right-click the file → **Open with MarkPad**) to
> see the features described below in action.

---

## 1. Opening a document in MarkPad

MarkPad does not replace the built-in text editor by default — you choose when to use
it. Any of these open the current markdown file in MarkPad:

- **Command Palette** — `Ctrl/Cmd+Shift+P` → **“Open with MarkPad”**.
- **Keyboard shortcut** — `Ctrl+Shift+Alt+M` (Windows/Linux) or `Cmd+Shift+Alt+M` (macOS)
  while a markdown file is focused.
- **Explorer right-click** → **Open with MarkPad**.
- **Editor tab right-click** → **Open with MarkPad**.
- **Open With…** — right-click the file → **Open With…** → **MarkPad**.

### Make MarkPad the default editor for `.md` (optional)

Right-click a markdown file → **Open With…** → **Configure default editor…** → **MarkPad**.
To go back, do the same and pick **Text Editor**.

---

## 2. The editor and its modes

The toolbar runs along the top. The editor supports three modes (switch with the
**edit-mode** toolbar button):

- **Instant rendering (default)** — markdown renders as you type; raw syntax markers
  appear only on the line you’re editing. Best of both worlds.
- **WYSIWYG** — fully rendered, like a word processor.
- **Split preview** — source on the left, rendered preview on the right.

**Open in the native text editor** — the **`< >`** toolbar button (and the right-click
**Open in text editor**) reopens the file in VS Code’s plain text editor, e.g. when you
want to see raw markdown or inline AI/git diffs.

---

## 3. Everyday editing

- **Formatting** — toolbar buttons for headings, **bold**, *italic*, ~~strike~~, links,
  lists, task lists, quotes, horizontal rules, inline `code` and code blocks, and tables.
- **Find** — press `Ctrl+F` to search text inside the editor.
- **Word autocomplete** — as you type, MarkPad suggests words already used in the
  document. Use **↑/↓** to navigate, **Tab**/**Enter** to accept, **Esc** to dismiss.
- **Right-click menu** — Cut / Copy / Paste / Select all, plus **Read aloud**,
  **Bring to Claude**, and **Open in text editor**.
- **Live two-way sync** — edits in MarkPad and edits in VS Code’s text editor stay in
  sync, and external changes (formatters, git, AI agents) appear in MarkPad immediately.
  Saving writes straight back to the file.
- **Theme-aware** — MarkPad matches your active VS Code color theme automatically.

---

## 4. Document variables

Define a value once and reuse it across the document. Update the value and every
reference updates instantly. The file keeps the `{{name}}` references (not the baked
value), so it stays portable and parameterized.

### Define variables

Two equivalent ways:

- **Variables panel** — click the **`{x}`** toolbar button. Add `name` + `value` rows,
  edit values inline, or remove them.
- **Frontmatter** — a `vars:` block at the very top of the file:

  ```markdown
  ---
  vars:
    productName: MarkPad
    version: 0.3.0
  ---
  ```

### Use variables

Type a reference anywhere in the text:

```
Welcome to {{productName}} v{{version}}.
```

The editor renders each reference as a **chip** showing the current value
(e.g. **MarkPad**). The line you’re actively editing shows the raw `{{name}}`; it
re-renders to a chip when you move away.

- **Insert from a dropdown** — type **`{{`** (at the start of a word or after a space)
  to get a list of defined variables; filter by typing, then **↑/↓** + **Enter** (or
  click) to insert.
- **Update everywhere** — change a value in the panel and all chips update at once.
- **Undefined references** are shown with a warning style so you can spot typos.
- **Code is left alone** — `{{name}}` inside inline code or fenced code blocks stays
  literal.

> Design details: see [variables-spec.md](variables-spec.md).

---

## 5. Tables

- **Resize columns** — hover a column’s right edge and drag.
- **Add a column** — hover the table’s right edge and click the **+** button.
- **Add a row** — press **Tab** in the last cell (Word/Excel style); the caret lands in
  the first cell of the new row.

---

## 6. Diagrams, charts & math

Write the appropriate fenced code block and MarkPad renders it live:

- **Mermaid**, **Apache ECharts**, **Graphviz**, **PlantUML**, **flowchart.js**,
  **abc.js** (music notation), **SMILES** (chemical structures), and ECharts-powered
  **mind maps**.
- **Math** — inline and block **KaTeX / MathJax** (`$…$`, `$$…$$`).
- **BPMN** — a ```` ```bpmn ```` block containing BPMN 2.0 XML renders as a process
  diagram in place of the source, including **colored pools, lanes and elements** via
  *BPMN in Color*. The raw XML is shown only while you’re editing that block.

Fenced code blocks (all languages) are syntax-highlighted and show **line numbers**.

---

## 7. Images

- **Paste**, **drag-and-drop**, or **upload** an image and MarkPad saves it next to your
  document and inserts the link.
- The destination folder is controlled by **`markpad.imageSaveFolder`** (default
  `assets`, relative to the file). Use `${projectRoot}/assets` to save to the project
  root instead.

---

## 8. Read aloud (text-to-speech)

Right-click → **Read aloud** to have the document spoken. A control bar appears with:

- **Play / Pause** and **Stop**
- **Language**, **Voice**, and **Speed** selectors (voices come from your OS)
- **Read-along highlighting** — the word currently being spoken is highlighted.

---

## 9. Bring to Claude

Select text, then right-click → **Bring to Claude** (or press **`Ctrl+Alt+C`**). MarkPad
copies the selection and focuses Claude Code’s input so you can paste it into your
session.

---

## 10. Export and copy

From the toolbar’s **`⋯` (more)** menu:

- **Copy markdown** — copy the document’s markdown source to the clipboard.
- **Copy HTML** — copy the rendered HTML.
- **Export HTML** — save a standalone, light-themed `.html` file (diagrams included).
- **Export PDF** — open a print-ready view; choose **Save as PDF** in the print dialog.

---

## 11. Emoji

- **Picker** — click the **emoji** toolbar button to browse the full emoji set.
- **Autocomplete** — type `:` followed by a name (e.g. `:smile`) and pick from the list.

---

## 12. Settings

Configure these in VS Code **Settings** (or `settings.json`):

| Setting | Default | What it does |
|---|---|---|
| `markpad.imageSaveFolder` | `assets` | Folder for pasted/uploaded images (relative to the file; `${projectRoot}/assets` for project root). |
| `markpad.useVscodeThemeColor` | `true` | Use the VS Code theme’s background color for the editor. |
| `markpad.customCss` | `""` | Inject your own CSS to restyle the editor. |

### Custom CSS example

```jsonc
"markpad.customCss": ".vditor-ir pre.vditor-reset { line-height: 32px; font-family: system-ui !important; }"
```

---

## 13. Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open with MarkPad | `Ctrl+Shift+Alt+M` / `Cmd+Shift+Alt+M` |
| Save | `Ctrl+S` / `Cmd+S` |
| Find in document | `Ctrl+F` / `Cmd+F` |
| Bring to Claude | `Ctrl+Alt+C` |
| Accept autocomplete / hint | `Tab` or `Enter` |
| Navigate autocomplete / hint | `↑` / `↓` |
| Dismiss autocomplete | `Esc` |
| Insert a variable | type `{{` |
| Insert an emoji | type `:` |

---

## Troubleshooting

- **Blank editor** — reload the window (`Ctrl/Cmd+R` in the webview, or
  *Developer: Reload Window*). If it persists, check the Webview Developer Tools
  (`⋯` → *devtools*).
- **A change isn’t showing** — MarkPad syncs external edits automatically; if needed,
  close and reopen the file with MarkPad.
- **Images not saving** — verify `markpad.imageSaveFolder` points to a writable folder.

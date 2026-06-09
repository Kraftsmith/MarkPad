# MarkPad — A full-featured Visual markdown editor

[![badge_title](https://vsmarketplacebadges.dev/version-short/Ship-Lab.markpad.png)](https://marketplace.visualstudio.com/items?itemName=Ship-Lab.markpad) [![](https://vsmarketplacebadges.dev/installs-short/Ship-Lab.markpad.png)](https://marketplace.visualstudio.com/items?itemName=Ship-Lab.markpad) [![](https://vsmarketplacebadges.dev/rating-short/Ship-Lab.markpad.png)](https://marketplace.visualstudio.com/items?itemName=Ship-Lab.markpad)

## Features

- **True WYSIWYG editing** with three modes — instant-rendering (default), full WYSIWYG, and split-screen preview.
- **Live two-way sync** with VS Code's native editor: edits on either side stay in sync, and saving writes straight back to the file.
- **Opens like a built-in editor** — via the Command Palette, a keybinding (`Ctrl/Cmd+Shift+Alt+M`), the Explorer or editor-tab context menu, or _Open With…_; can be set as the default editor for `.md` files.
- **Theme-aware** — automatically matches your active VS Code color theme.
- **Copy as Markdown or HTML** straight from the toolbar.
- **Smart image handling** — paste, drag-and-drop, or upload images and have them auto-saved to a configurable assets folder.
- **Word autocomplete** — as you type, suggests words already in the document. ↑/↓ to navigate, **Tab**/**Enter** to accept, **Esc** to dismiss.
- **Source ⇄ preview toggle** — a toolbar button (`< >`) to switch between the rendered editor and the raw markdown source.
- **Diagrams, charts & math** — render fenced code blocks with Mermaid, Apache ECharts, Graphviz, PlantUML, flowchart.js, abc.js (music notation), SMILES (chemical structures), and ECharts-powered mind maps, plus KaTeX / MathJax math.
- **BPMN diagrams** — render `bpmn` fenced blocks (BPMN 2.0 XML) as process diagrams, including colored pools, lanes and elements via _BPMN in Color_.
- **Extended Markdown** — tables, task lists, footnotes, and syntax-highlighted code blocks.
- **Personalizable** — apply your own styling with `markpad.customCss`.

## Install

[https://marketplace.visualstudio.com/items?itemName=Ship-Lab.markpad](https://marketplace.visualstudio.com/items?itemName=Ship-Lab.markpad)

## Usage

### 1. Command mode in markdown file

- open a markdown file
- type `cmd-shift-p` to enter command mode
- type `markpad: Open with MarkPad`

### 2. Key bindings

- open a markdown file
- type `ctrl+shift+alt+m` for win or `cmd+shift+alt+m` for mac

### 3. Explorer Context menu

- right click on markdown file
- then click `Open with MarkPad`

### 4. Editor title context menu

- right click on a opened markdown file's tab title
- then click `Open with MarkPad`

### 5. Open With... and Set Default Editor

- right click on a markdown file in Explorer
- click `Open With...`
- select `MarkPad` to open temporary
- or click `Configure default editor...` and select `MarkPad` to set it as default

### Custom CSS (custom layout and vditor personalization)

Edit your settings.json and add

```
"markpad.customCss": "my custom css rules"

// Eg: "markpad.customCss": ".vditor-ir pre.vditor-reset {line-height: 32px;padding-right: calc(100% - 800px) !important; margin-left: 100px;    font-family: system-ui !important;}"
```

## Release Notes

### 0.2.9
- **External edits sync live** — changes made to the file outside the editor (AI agents, formatters, git) now appear in MarkPad right away, even when it's the focused tab.

### 0.2.8
- **`Ctrl+F` search** — VS Code's find bar now searches text inside the editor.
- **Code line numbers** — fenced code blocks are rendered with line numbers.

### 0.2.7
- **Right-click context menu** — switch between rendered preview and markdown source, with cut / copy / paste / select all.

### 0.2.6
- **Word autocomplete** — as you type, suggests words already in the document. ↑/↓ to navigate, **Tab**/**Enter** to accept, **Esc** to dismiss.
- **Source ⇄ preview toggle** — a toolbar button (`< >`) to switch between the rendered editor and the raw markdown source.

### 0.2.4
- **Export to HTML and PDF** — new options in the toolbar's `⋯` menu. _Export HTML_ saves a standalone, light-themed `.html`; _Export PDF_ opens a print-ready view (choose **Save as PDF**).

### 0.2.3
- **Tab in the last table cell adds a new row** (Word / Excel style), with the caret placed in the first cell.

### 0.2.2
- **Default markdown editor** — MarkPad now opens `.md` files by default (previously opt-in via _Open With…_).
- Open MarkPad from the **editor right-click menu** as well.
- BPMN diagrams render **in place of the source** — the raw XML is hidden and only shown while you're editing the block — with more robust handling of imperfect / auto-generated layouts.

### 0.2.0
- **BPMN diagram support** — render `bpmn` fenced blocks (BPMN 2.0 XML) with colored pools, lanes and elements via _BPMN in Color_.
- New MarkPad icon.

### 0.1.14
- Initial release of MarkPad — a full-featured WYSIWYG markdown editor for VS Code, built on Vditor.

## Acknowledgement

MarkPad is built on the Vditor editor, embedded in a VS Code webview.

## License

MIT

## Support

If you like this extension make sure to star the repo. I am always looking for new ideas and feedback.

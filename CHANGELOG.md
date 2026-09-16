# Changelog

## 0.3.11

### Added

- **Inline "Comment with Gemini" popover.** Select text/table/lines in MarkPad and press `Ctrl+Alt+I`
  (or right-click → "Comment with Gemini") to open an inline comment popover. Enter your prompt/instruction,
  and MarkPad sends the quoted snippet along with your comment directly to Gemini Antigravity chat.

### Fixed

- **Ctrl+F find reliability across keyboard layouts and editor modes.** Switched key detection to layout-independent
  `e.code === 'KeyF'` (fixing failure on non-English/Cyrillic keyboards), connected to the active editor element
  across all modes (IR, WYSIWYG, SV), and registered VS Code workbench command `markpad.find` so `Ctrl+F` routes
  reliably even when focus is on the editor tab header.

## 0.3.10

### Added

- **Bring selection to Gemini Antigravity chat.** Right-clicking any selection in MarkPad
  now includes "Bring to Gemini  (Ctrl+Alt+G)" to send the selected text directly to
  Gemini Antigravity's chat context/input and focus the sidebar panel. Also accessible via
  `Ctrl+Alt+G` or `Ctrl+L` within the editor.

## 0.3.9

### Fixed

- **A resized column no longer briefly forgets its width after you edit inside it.**
  Widths are re-applied when a table is re-rendered, but simply moving the cursor
  out of a table isn't a re-render, so the column you'd just edited kept its default
  width until the next edit anywhere. Widths/handles now refresh on caret-settle
  (keyup / mouseup / focus-out) too, so the column snaps back to its set width as
  soon as you leave the cell. Purely visual — no effect on saved content.

## 0.3.8

### Fixed

- **Editing a resized table no longer wipes the cell or jumps the cursor to the
  top.** Column widths were stored in a `<colgroup>` element inside the table.
  Vditor re-serializes the edited block through Lute on every keystroke, and Lute
  drops any table that contains a `<colgroup>` — so the first character you typed
  in a table you'd resized erased the cell's content and snapped the caret to the
  start of the document. Widths are now applied as inline styles on the header
  cells, which survive that round-trip, so typing in tables is stable again.

## 0.3.7

### Fixed

- **The editor no longer flips to VS Code's plain-text view on its own.** Opening
  a file with "Open with MarkPad" used a standalone webview panel whose underlying
  document VS Code would release after a few minutes (or sooner under memory
  pressure), which tore the panel down and revealed the raw text editor. The
  command now opens MarkPad's custom editor, which binds to the editor tab — so it
  stays put, survives a window reload, and is never expired out from under you.

### Changed

- Consolidated onto a single editor implementation (the custom editor), removing
  the parallel webview-panel code path. Theme changes now update the custom editor
  live.

## 0.3.6

### Fixed

- **Resizing a table column no longer jumps to the top of the document.**
  Grabbing a column-resize handle injected a `<colgroup>` into the table without
  preserving the editor's selection, so the caret and view snapped to the start of
  the document. The resize now keeps the selection intact, and the background
  table refresh is paused for the duration of the drag.

## 0.3.5

### Fixed

- **Editing a table no longer wipes the table or jumps the cursor to the top of
  the document.** The column-resize layer re-applied its column widths and resize
  handles on every re-render — including into the table you were actively editing.
  Injecting those nodes mid-edit knocked the selection out of the editor, so
  Vditor reset the caret to the start of the document and could drop the table
  being serialized. It now leaves the table you're editing untouched and
  re-applies widths/handles once the caret moves out. (One cosmetic effect:
  column-resize handles are hidden while your caret is inside a table and reappear
  when you click out.)

- **Line breaks inside table cells now render.** A `<br>` in a cell (the only way
  to break a line inside a table) — whether typed, pasted, or created by pressing
  Enter in a cell — was shown as an invisible marker, collapsing multi-line cells
  onto one line. Such breaks now display as real line breaks in the editor, and
  the markdown source is unchanged.

- **Tables with hard-wrapped cells no longer break apart.** If a cell's text
  contained a literal line break in the source (invalid GFM — the standard splits
  it into separate rows), the table rendered mangled, with content spilling into
  extra rows. MarkPad now detects this on open and stitches the split lines back
  into their row as `<br>`, so the table renders correctly and is saved back as
  valid markdown. Well-formed tables are left untouched.

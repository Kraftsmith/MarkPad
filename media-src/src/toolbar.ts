import { t } from "./lang"
import { confirm } from "./utils"
import { setEditMode } from "vditor/src/ts/toolbar/EditMode"

// Build a self-rendering HTML document from the current content. Mirrors
// Vditor's own exportHTML template (diagrams re-render from the CDN), but the
// caller routes it to the extension host for saving / printing, because a VS
// Code webview can't trigger browser downloads. `bpmn` blocks export as code —
// MarkPad's BPMN renderer isn't part of this standalone output yet.
function buildExportHtml(autoPrint: boolean): string {
  const v: any = vditor as any
  const opts = (v.vditor && v.vditor.options) || {}
  const cdn = opts.cdn || 'https://cdn.jsdelivr.net/npm/vditor'
  const content = vditor.getHTML()
  const printScript = autoPrint
    ? `\n<script>window.addEventListener('load', function () { setTimeout(function () { window.print() }, 700) })</script>`
    : ''
  // Always export LIGHT: the editor may be in dark mode, but a standalone
  // document / printout should be dark text on a white page. Forcing the light
  // content theme + a light code theme + a white background avoids the washed-out
  // "dark text colors on white" result.
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" type="text/css" href="${cdn}/dist/index.css"/>
<script src="${cdn}/dist/method.min.js"></script>
<style>
  html, body { background: #ffffff; margin: 0; }
  body { padding: 24px; }
  .vditor-reset { max-width: 860px; margin: 0 auto; color: #1f2328; background: #ffffff; }
</style></head>
<body><div class="vditor-reset" id="preview">${content}</div>
<script>
  var el = document.getElementById('preview');
  Vditor.setContentTheme('light', '${cdn}/dist/css/content-theme');
  Vditor.codeRender(el);
  Vditor.highlightRender({ style: 'github' }, el, '${cdn}');
  Vditor.mathRender(el, { cdn: '${cdn}' });
  Vditor.mermaidRender(el, '${cdn}', 'classic');
  Vditor.SMILESRender(el, '${cdn}', 'classic');
  Vditor.markmapRender(el, '${cdn}');
  Vditor.flowchartRender(el, '${cdn}');
  Vditor.graphvizRender(el, '${cdn}');
  Vditor.chartRender(el, '${cdn}', 'classic');
  Vditor.mindmapRender(el, '${cdn}', 'classic');
  Vditor.abcRender(el, '${cdn}');
</script>${printScript}
</body></html>`
}

export const toolbar = [
	{
		hotkey: '⌘s',
		name: 'save',
		tipPosition: 's',
		tip: t('save'),
		className: 'save',
		icon:
			'<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M810.667 938.667H213.333a128 128 0 01-128-128V213.333a128 128 0 01128-128h469.334a42.667 42.667 0 0130.293 12.374L926.293 311.04a42.667 42.667 0 0112.374 30.293v469.334a128 128 0 01-128 128zm-597.334-768a42.667 42.667 0 00-42.666 42.666v597.334a42.667 42.667 0 0042.666 42.666h597.334a42.667 42.667 0 0042.666-42.666v-451.84l-188.16-188.16z"/><path d="M725.333 938.667A42.667 42.667 0 01682.667 896V597.333H341.333V896A42.667 42.667 0 01256 896V554.667A42.667 42.667 0 01298.667 512h426.666A42.667 42.667 0 01768 554.667V896a42.667 42.667 0 01-42.667 42.667zM640 384H298.667A42.667 42.667 0 01256 341.333V128a42.667 42.667 0 0185.333 0v170.667H640A42.667 42.667 0 01640 384z"/></svg>',
		click() {
			vscode.postMessage({
				command: 'save',
				content: vditor.getValue(),
			})
		},
	},

	'emoji',
	'headings',
	'bold',
	'italic',
	'strike',
	'link',
	'|',
	'list',
	'ordered-list',
	'check',
	'outdent',
	'indent',
	'|',
	'quote',
	'line',
	'code',
	'inline-code',
	'insert-before',
	'insert-after',
	'|',
	'upload',
	'table',
	'|',
	'undo',
	'redo',
	'|',
	{
		// One-click toggle between IR (rendered preview) and SV (markdown source).
		name: 'source-toggle',
		tipPosition: 's',
		tip: 'Toggle source / preview',
		icon: '<svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M8.7 15.9 4.8 12l3.9-3.9L7.3 6.7 2 12l5.3 5.3 1.4-1.4zm6.6 0 3.9-3.9-3.9-3.9 1.4-1.4L21 12l-5.3 5.3-1.4-1.4z"/></svg>',
		click() {
			const iv: any = (vditor as any).vditor
			const next = iv.currentMode === 'sv' ? 'ir' : 'sv'
			setEditMode(iv, next, vditor.getValue())
		},
	},
	{ name: 'edit-mode', tipPosition: 'e', },
	{
		name: 'more',
		tipPosition: 'e',
		toolbar: [
			'both',
			'code-theme',
			'content-theme',
			'outline',
			'preview',
			{
				name: 'copy-markdown',
				icon: t('copyMarkdown'),
				async click() {
					try {
						await navigator.clipboard.writeText(vditor.getValue())
						vscode.postMessage({
							command: 'info',
							content: 'Copy Markdown successfully!',
						})
					} catch (error) {
						vscode.postMessage({
							command: 'error',
							content: `Copy Markdown failed! ${error.message}`,
						})
					}
				},
			},
			{
				name: 'copy-html',
				icon: t('copyHtml'),
				async click() {
					try {
						await navigator.clipboard.writeText(vditor.getHTML())
						vscode.postMessage({
							command: 'info',
							content: 'Copy HTML successfully!',
						})
					} catch (error) {
						vscode.postMessage({
							command: 'error',
							content: `Copy HTML failed! ${error.message}`,
						})
					}
				},
			},
			{
				name: 'reset-config',
				icon: t('resetConfig'),
				async click() {
					confirm(t('resetConfirm'), async () => {
						try {
							await vscode.postMessage({
								command: 'reset-config',
							})
							await vscode.postMessage({
								command: 'ready',
							})
							vscode.postMessage({
								command: 'info',
								content: 'Reset config successfully!',
							})
						} catch (error) {
							vscode.postMessage({
								command: 'error',
								content: 'Reset config failed!',
							})
						}
					})
				},
			},
			{
				name: 'export-html',
				icon: 'Export HTML',
				click() {
					try {
						vscode.postMessage({ command: 'export', format: 'html', content: buildExportHtml(false) })
					} catch (error) {
						vscode.postMessage({ command: 'error', content: `Export HTML failed! ${error.message}` })
					}
				},
			},
			{
				name: 'export-pdf',
				icon: 'Export PDF',
				click() {
					try {
						vscode.postMessage({ command: 'export', format: 'pdf', content: buildExportHtml(true) })
					} catch (error) {
						vscode.postMessage({ command: 'error', content: `Export PDF failed! ${error.message}` })
					}
				},
			},
			'devtools',
			{
				// Vditor routes a toolbar item named `info` to its built-in
				// (Chinese-only) Info panel, so we use a custom item to render
				// an English "About" panel instead. Same icon + tooltip.
				name: 'about',
				tipPosition: 'nw',
				tip: 'Info',
				icon: '<svg><use xlink:href="#vditor-icon-info"></use></svg>',
				click() {
					const v = vditor as any
					const luteVersion = (window as any).Lute?.Version || ''
					v.tip.show(
						`<div style="max-width: 520px; font-size: 14px;line-height: 22px;margin-bottom: 14px;">
<p style="text-align: center;margin: 14px 0">
    <em>The next-generation Markdown editor, built for the future</em>
</p>
<div style="display: flex;margin-bottom: 14px;flex-wrap: wrap;align-items: center">
    <img src="https://unpkg.com/vditor/dist/images/logo.png" style="margin: 0 auto;height: 68px"/>
    <div>&nbsp;&nbsp;</div>
    <div style="flex: 1;min-width: 250px">
        Vditor is a browser-based Markdown editor that supports WYSIWYG, instant rendering (similar to Typora) and split-screen preview modes.
        It is implemented in TypeScript and works with vanilla JavaScript as well as frameworks such as Vue, React, Angular and Svelte.
    </div>
</div>
<div style="display: flex;flex-wrap: wrap;">
    <ul style="list-style: none;flex: 1;min-width:148px">
        <li>
        Homepage: <a href="https://b3log.org/vditor" target="_blank">b3log.org/vditor</a>
        </li>
        <li>
        License: MIT
        </li>
    </ul>
    <ul style="list-style: none;margin-right: 18px">
        <li>
        Version: Vditor v${v.version} / Lute v${luteVersion}
        </li>
        <li>
        Sponsor: <a href="https://ld246.com/sponsor" target="_blank">https://ld246.com/sponsor</a>
        </li>
    </ul>
</div>
</div>`,
						0
					)
				},
			},
		],
	},
].map((it: any) => {
	if (typeof it === 'string') {
		it = { name: it }
	}
	it.tipPosition = it.tipPosition || 's'
	return it
})

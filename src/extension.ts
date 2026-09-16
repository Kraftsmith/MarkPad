import * as vscode from 'vscode'
import * as NodePath from 'path'
import * as net from 'net'
import * as os from 'os'
const KeyVditorOptions = 'vditor.options'

function debug(...args: any[]) {
  console.log(...args)
}

function showError(msg: string) {
  vscode.window.showErrorMessage(`[MarkPad] ${msg}`)
}

// Compare document text ignoring line-ending differences, so we can tell the
// webview's own edits from external ones without false mismatches.
function sameText(a: string, b: string) {
  return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')
}

/**
 * Open a link clicked inside the webview. `href` is the raw markdown URL (the
 * unresolved href attribute), and `docFsPath` is the markdown file it lives in.
 * - Scheme URLs (http:, https:, mailto:, file:, ...) are handed to VS Code as-is.
 * - Pure in-document anchors (`#section`) have nothing to open on disk and are
 *   ignored (scrolling to the heading would require matching Vditor's generated
 *   ids — left as a follow-up).
 * - Everything else is treated as a path relative to the markdown file.
 */
function openLink(href: string, docFsPath: string) {
  if (!href) return
  // Absolute URL with a scheme — let VS Code route it (browser, mail client, ...).
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(href))
    return
  }
  if (href.startsWith('#')) return
  // Relative/local path — resolve against the file's folder, dropping any
  // trailing #fragment, and open the target.
  let rel = href.split('#')[0]
  try {
    rel = decodeURIComponent(rel)
  } catch {
    /* keep the raw value if it isn't valid percent-encoding */
  }
  const target = NodePath.resolve(docFsPath, '..', rel)
  vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target))
}

/**
 * Export the webview-rendered HTML. A VS Code webview can't trigger browser
 * downloads, so the document content is sent here:
 * - `html`: prompt with a Save dialog and write the file.
 * - `pdf`: write a temp HTML and open it in the default browser, which
 *   auto-opens the print dialog (the user picks "Save as PDF").
 */
async function handleExport(message: any, fsPath: string) {
  const content: string = message.content || ''
  if (!content) {
    showError('Nothing to export')
    return
  }
  if (message.format === 'html') {
    const base = (fsPath || 'export').replace(/\.(md|markdown)$/i, '')
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${base}.html`),
      filters: { HTML: ['html'] },
    })
    if (!target) return
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'))
    vscode.window.showInformationMessage(`MarkPad: exported HTML → ${target.fsPath}`)
  } else {
    const tmp = vscode.Uri.file(
      NodePath.join(os.tmpdir(), `markpad-export-${Date.now()}.html`)
    )
    await vscode.workspace.fs.writeFile(tmp, Buffer.from(content, 'utf8'))
    await vscode.env.openExternal(tmp)
    vscode.window.showInformationMessage(
      'MarkPad: opening the export in your browser — use Print → Save as PDF.'
    )
  }
}

function getMarkpadConfig() {
  return vscode.workspace.getConfiguration('markpad')
}

/**
 * Resolve the folder that pasted/uploaded images are written to, honoring the
 * `markpad.imageSaveFolder` setting and its `${projectRoot}`/`${file}`/
 * `${dir}`/`${fileBasenameNoExtension}` placeholders.
 */
function getAssetsFolder(uri: vscode.Uri) {
  const imageSaveFolder = (getMarkpadConfig().get<string>('imageSaveFolder') || 'assets')
    .replace(
      '${projectRoot}',
      vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath || ''
    )
    .replace('${file}', uri.fsPath)
    .replace(
      '${fileBasenameNoExtension}',
      NodePath.basename(uri.fsPath, NodePath.extname(uri.fsPath))
    )
    .replace('${dir}', NodePath.dirname(uri.fsPath))
  return NodePath.resolve(NodePath.dirname(uri.fsPath), imageSaveFolder)
}

export function activate(context: vscode.ExtensionContext) {
  // Set default auto-select family attempt timeout to 1000ms.
  // Cast: this Node 18+ API isn't in the pinned @types/node@12.
  const netAny = net as any
  if (typeof netAny.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
    netAny.setDefaultAutoSelectFamilyAttemptTimeout(1000)
  }

  // Register original command (used by context menu/shortcuts). Opens the file in
  // the MarkPad custom editor via vscode.openWith. Routing through the custom
  // editor (rather than a standalone webview panel) binds the document to the
  // editor tab, so VS Code keeps it alive, restores it after a window reload, and
  // never expires it out from under the webview — the standalone panel used to be
  // torn down when VS Code released the unshown document, making the editor revert
  // to plain text on its own.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markpad.openEditor',
      async (uri?: vscode.Uri, ...args) => {
        debug('command', uri, args)
        const target = uri ?? vscode.window.activeTextEditor?.document.uri
        if (!target) {
          showError(`Did not open markdown file!`)
          return
        }
        // Invoked from the palette/keybinding (no uri): the active editor must be
        // markdown. (Explorer/title/editor context menus always pass a uri.)
        if (!uri) {
          const doc = vscode.window.activeTextEditor?.document
          if (doc && doc.languageId !== 'markdown') {
            showError(`Current file language is not markdown, got ${doc.languageId}`)
            return
          }
        }
        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          MarkdownEditorProvider.viewType
        )
      }
    )
  )

  // Register CustomTextEditorProvider (for "Open With" and default editor)
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      MarkdownEditorProvider.viewType,
      new MarkdownEditorProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
          // MarkPad provides its own Ctrl+F find (see media-src/src/find.ts).
          // VS Code's native webview find widget is unreliable over Vditor's
          // contenteditable surface, so it's disabled to avoid two find UIs.
          enableFindWidget: false,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    ),
    vscode.commands.registerCommand('markpad.find', () => {
      MarkdownEditorProvider.activePanel?.webview.postMessage({ command: 'find' })
    }),
    vscode.commands.registerCommand('markpad.commentGemini', () => {
      MarkdownEditorProvider.activePanel?.webview.postMessage({ command: 'comment-gemini' })
    })
  )

  context.globalState.setKeysForSync([KeyVditorOptions])
}

/**
 * MarkdownEditorProvider implements CustomTextEditorProvider interface
 * Supports opening markdown files via "Open With"
 */
class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'markpad.customEditor'
  public static activePanel: vscode.WebviewPanel | undefined

  constructor(private readonly context: vscode.ExtensionContext) { }

  /**
   * Called when user selects Markdown Editor via "Open With"
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    MarkdownEditorProvider.activePanel = webviewPanel

    // Set webview options
    webviewPanel.webview.options = this.getWebviewOptions()

    // Init webview content
    const uri = document.uri
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, uri)
    webviewPanel.title = NodePath.basename(uri.fsPath)

    const disposables: vscode.Disposable[] = []

    webviewPanel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.active) {
          MarkdownEditorProvider.activePanel = e.webviewPanel
        } else if (MarkdownEditorProvider.activePanel === e.webviewPanel) {
          MarkdownEditorProvider.activePanel = undefined
        }
      },
      null,
      disposables
    )

    let isEditing = false

    // Update title to show edit status
    const updateEditTitle = () => {
      const isDirty = document.isDirty
      if (isDirty !== isEditing) {
        isEditing = isDirty
        webviewPanel.title = `${isDirty ? '[edit]' : ''}${NodePath.basename(uri.fsPath)}`
      }
    }

    // Tracks the markdown the webview currently has, so its own edits (skipped —
    // avoids loops) can be told apart from external ones (always synced).
    let lastContent = ''

    // Send update to webview
    const updateWebview = (props: { type?: 'init' | 'update'; options?: any; theme?: 'dark' | 'light' } = {}) => {
      lastContent = document.getText()
      webviewPanel.webview.postMessage({
        command: 'update',
        content: lastContent,
        ...props,
      })
    }

    // No document-close listener: VS Code owns this editor's lifecycle and
    // disposes the webview when its tab closes (handled via onDidDispose below).
    // A workspace onDidCloseTextDocument listener here is both redundant and
    // harmful — it also fires on a languageId change, which would wrongly tear
    // down the editor.

    // Re-init the webview when the VS Code color theme changes, so the rendered
    // document follows light/dark (the initial theme is sent on 'ready').
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      updateWebview({
        type: 'init',
        options: {
          useVscodeThemeColor: getMarkpadConfig().get<boolean>('useVscodeThemeColor'),
          ...this.context.globalState.get(KeyVditorOptions),
        },
        theme: theme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light',
      })
    }, null, disposables)

    // Listen for document changes (sync from external editor to webview)
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.fileName !== document.fileName) {
        return
      }
      // Skip the change the webview itself produced (avoids a loop), but reflect
      // external edits (agent, formatter, git) even while it's active.
      if (sameText(e.document.getText(), lastContent)) {
        return
      }
      updateWebview()
      updateEditTitle()
    }, null, disposables)

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      debug('msg from webview', message, webviewPanel.active)

      const syncToEditor = async () => {
        lastContent = message.content
        const edit = new vscode.WorkspaceEdit()
        edit.replace(
          document.uri,
          new vscode.Range(0, 0, document.lineCount, 0),
          message.content
        )
        await vscode.workspace.applyEdit(edit)
      }

      switch (message.command) {
        case 'ready':
          updateWebview({
            type: 'init',
            options: {
              useVscodeThemeColor: getMarkpadConfig().get<boolean>('useVscodeThemeColor'),
              ...this.context.globalState.get(KeyVditorOptions),
            },
            theme: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light',
          })
          break
        case 'save-options':
          this.context.globalState.update(KeyVditorOptions, message.options)
          break
        case 'info':
          vscode.window.showInformationMessage(message.content)
          break
        case 'error':
          showError(message.content)
          break
        case 'edit':
          if (webviewPanel.active) {
            await syncToEditor()
            updateEditTitle()
          }
          break
        case 'reset-config':
          await this.context.globalState.update(KeyVditorOptions, {})
          break
        case 'save':
          await syncToEditor()
          await document.save()
          updateEditTitle()
          break
        case 'upload': {
          const assetsFolder = getAssetsFolder(uri)
          try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(assetsFolder))
          } catch (error) {
            console.error(error)
            showError(`Invalid image folder: ${assetsFolder}`)
          }
          await Promise.all(
            message.files.map(async (f: any) => {
              const content = Buffer.from(f.base64, 'base64')
              return vscode.workspace.fs.writeFile(
                vscode.Uri.file(NodePath.join(assetsFolder, f.name)),
                content
              )
            })
          )
          const files = message.files.map((f: any) =>
            NodePath.relative(NodePath.dirname(uri.fsPath), NodePath.join(assetsFolder, f.name)).replace(/\\/g, '/')
          )
          webviewPanel.webview.postMessage({
            command: 'uploaded',
            files,
          })
          break
        }
        case 'open-link': {
          openLink(message.href, uri.fsPath)
          break
        }
        case 'bring-to-antigravity': {
          const text = (message.text || '').trim()
          if (text) {
            try {
              await vscode.commands.executeCommand('antigravity.addContext', text)
            } catch {
              try {
                await vscode.commands.executeCommand('antigravity.panel.focus')
              } catch {
                try {
                  await vscode.commands.executeCommand('antigravity.toggleChatFocus', 'focus')
                } catch { }
              }
            }
          } else {
            try {
              await vscode.commands.executeCommand('antigravity.panel.focus')
            } catch {
              try {
                await vscode.commands.executeCommand('antigravity.toggleChatFocus', 'focus')
              } catch { }
            }
          }
          break
        }
        case 'bring-to-claude': {
          try {
            await vscode.commands.executeCommand('claude-vscode.focus')
          } catch { }
          break
        }
        case 'open-source': {
          try {
            await vscode.commands.executeCommand('vscode.openWith', uri, 'default')
          } catch { }
          break
        }
        case 'export': {
          await handleExport(message, uri.fsPath)
          break
        }
      }
    }, null, disposables)

    // Clean up resources
    webviewPanel.onDidDispose(() => {
      if (MarkdownEditorProvider.activePanel === webviewPanel) {
        MarkdownEditorProvider.activePanel = undefined
      }
      disposables.forEach((d) => d.dispose())
    })
  }

  private static getFolders(): vscode.Uri[] {
    const data = []
    for (let i = 65; i <= 90; i++) {
      data.push(vscode.Uri.file(`${String.fromCharCode(i)}:/`))
    }
    return data
  }

  private getWebviewOptions(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file('/'), ...MarkdownEditorProvider.getFolders()],
    }
  }

  private getHtmlForWebview(webview: vscode.Webview, uri: vscode.Uri): string {
    const toUri = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, f))
    const baseHref = NodePath.dirname(webview.asWebviewUri(vscode.Uri.file(uri.fsPath)).toString()) + '/'
    const toMediaPath = (f: string) => `media/dist/${f}`
    const JsFiles = ['main.js'].map(toMediaPath).map(toUri)
    const CssFiles = ['main.css'].map(toMediaPath).map(toUri)

    return (
      `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="
					default-src 'none';
					style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net;
					script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net;
					connect-src ${webview.cspSource} https:;
					font-src * data:;
					img-src * data:;
				">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<base href="${baseHref}" />


				${CssFiles.map((f) => `<link href="${f}" rel="stylesheet">`).join('\n')}

				<title>MarkPad</title>
        <style>` +
      getMarkpadConfig().get<string>('customCss') +
      `</style>
			</head>
			<body>
				<div id="app"></div>


				${JsFiles.map((f) => `<script src="${f}"></script>`).join('\n')}
			</body>
			</html>`
    )
  }
}

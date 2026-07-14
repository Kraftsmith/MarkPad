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

export function activate(context: vscode.ExtensionContext) {
  // Set default auto-select family attempt timeout to 1000ms.
  // Cast: this Node 18+ API isn't in the pinned @types/node@12.
  const netAny = net as any
  if (typeof netAny.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
    netAny.setDefaultAutoSelectFamilyAttemptTimeout(1000)
  }

  // Register original command (used by context menu/shortcuts)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markpad.openEditor',
      (uri?: vscode.Uri, ...args) => {
        debug('command', uri, args)
        EditorPanel.createOrShow(context, uri)
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
    )
  )

  context.globalState.setKeysForSync([KeyVditorOptions])
}

/**
 * Manages cat coding webview panels
 */
class EditorPanel {
  /**
   * Track the currently panel. Only allow a single panel to exist at a time.
   */
  public static currentPanel: EditorPanel | undefined

  public static readonly viewType = 'markpad'

  private _disposables: vscode.Disposable[] = []
  // The markdown the webview currently has — lets us skip its own edits.
  private _lastContent = ''

  public static async createOrShow(
    context: vscode.ExtensionContext,
    uri?: vscode.Uri
  ) {
    const { extensionUri } = context
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined
    if (EditorPanel.currentPanel && uri !== EditorPanel.currentPanel?._uri) {
      EditorPanel.currentPanel.dispose()
    }
    // If we already have a panel, show it.
    if (EditorPanel.currentPanel) {
      EditorPanel.currentPanel._panel.reveal(column)
      return
    }
    if (!vscode.window.activeTextEditor && !uri) {
      showError(`Did not open markdown file!`)
      return
    }
    let doc: undefined | vscode.TextDocument
    // From context menu: Find if there is a markdown editor for the current active TextEditor, if so bind the document
    if (uri) {
      // Open file from context menu: Open document first then enable auto-sync, otherwise cannot save file or sync to opened document
      doc = await vscode.workspace.openTextDocument(uri)
    } else {
      doc = vscode.window.activeTextEditor?.document
      // from command mode
      if (doc && doc.languageId !== 'markdown') {
        showError(
          `Current file language is not markdown, got ${doc.languageId}`
        )
        return
      }
    }

    if (!doc) {
      showError(`Cannot find markdown file!`)
      return
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      EditorPanel.viewType,
      'MarkPad',
      column || vscode.ViewColumn.One,
      EditorPanel.getWebviewOptions(uri)
    )

    EditorPanel.currentPanel = new EditorPanel(
      context,
      panel,
      extensionUri,
      doc,
      uri
    )
  }

  private static getFolders(): vscode.Uri[] {
    const data = []
    for (let i = 65; i <= 90; i++) {
      data.push(vscode.Uri.file(`${String.fromCharCode(i)}:/`))
    }
    return data
  }

  static getWebviewOptions(
    uri?: vscode.Uri
  ): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      // Enable javascript in the webview
      enableScripts: true,

      localResourceRoots: [vscode.Uri.file("/"), ...this.getFolders()],
      retainContextWhenHidden: true,
      enableCommandUris: true,
      // MarkPad provides its own Ctrl+F find (see media-src/src/find.ts); the
      // native webview widget is unreliable over Vditor's contenteditable.
      enableFindWidget: false,
    }
  }
  private get _fsPath() {
    return this._uri.fsPath
  }

  static get config() {
    return vscode.workspace.getConfiguration('markpad')
  }

  private constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    public _document: vscode.TextDocument,
    public _uri = _document.uri // Opened from explorer, only uri exists, no _document
  ) {
    // Set the webview's initial html content

    this._init()

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
    let textEditTimer: NodeJS.Timeout | void
    // close EditorPanel when vsc editor is close
    vscode.workspace.onDidCloseTextDocument((e) => {
      if (e.fileName === this._fsPath) {
        this.dispose()
      }
    }, this._disposables)
    // re-init webview when VS Code theme changes
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      this._update({
        type: 'init',
        options: {
          useVscodeThemeColor: EditorPanel.config.get<boolean>(
            'useVscodeThemeColor'
          ),
          ...this._context.globalState.get(KeyVditorOptions),
        },
        theme: theme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light',
      })
    }, null, this._disposables)
    // update EditorPanel when vsc editor changes
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.fileName !== this._document.fileName) {
        return
      }
      // Skip changes the webview itself produced (avoids a feedback loop), but
      // reflect external edits (agent, formatter, git) even while it's active.
      if (sameText(e.document.getText(), this._lastContent)) {
        return
      }
      textEditTimer && clearTimeout(textEditTimer)
      textEditTimer = setTimeout(() => {
        this._update()
        this._updateEditTitle()
      }, 300)
    }, this._disposables)
    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        debug('msg from webview review', message, this._panel.active)

        const syncToEditor = async () => {
          debug('sync to editor', this._document, this._uri)
          this._lastContent = message.content
          if (this._document) {
            const edit = new vscode.WorkspaceEdit()
            edit.replace(
              this._document.uri,
              new vscode.Range(0, 0, this._document.lineCount, 0),
              message.content
            )
            await vscode.workspace.applyEdit(edit)
          } else if (this._uri) {
            await vscode.workspace.fs.writeFile(this._uri, message.content)
          } else {
            showError(`Cannot find original file to save!`)
          }
        }
        switch (message.command) {
          case 'ready':
            this._update({
              type: 'init',
              options: {
                useVscodeThemeColor: EditorPanel.config.get<boolean>(
                  'useVscodeThemeColor'
                ),
                ...this._context.globalState.get(KeyVditorOptions),
              },
              theme:
                vscode.window.activeColorTheme.kind ===
                  vscode.ColorThemeKind.Dark
                  ? 'dark'
                  : 'light',
            })
            break
          case 'save-options':
            this._context.globalState.update(KeyVditorOptions, message.options)
            break
          case 'info':
            vscode.window.showInformationMessage(message.content)
            break
          case 'error':
            showError(message.content)
            break
          case 'edit': {
            // Only sync to VS Code editor when webview is in edit mode to avoid repeated refresh
            if (this._panel.active) {
              await syncToEditor()
              this._updateEditTitle()
            }
            break
          }
          case 'reset-config': {
            await this._context.globalState.update(KeyVditorOptions, {})
            break
          }
          case 'save': {
            await syncToEditor()
            await this._document.save()
            this._updateEditTitle()
            break
          }
          case 'upload': {
            const assetsFolder = EditorPanel.getAssetsFolder(this._uri)
            try {
              await vscode.workspace.fs.createDirectory(
                vscode.Uri.file(assetsFolder)
              )
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
              NodePath.relative(
                NodePath.dirname(this._fsPath),
                NodePath.join(assetsFolder, f.name)
              ).replace(/\\/g, '/')
            )
            this._panel.webview.postMessage({
              command: 'uploaded',
              files,
            })
            break
          }
          case 'open-link': {
            openLink(message.href, this._fsPath)
            break
          }
          case 'bring-to-claude': {
            // Selection is already on the clipboard; focus Claude Code's input
            // so the user can paste. Best-effort (Claude Code may not be installed).
            try {
              await vscode.commands.executeCommand('claude-vscode.focus')
            } catch { }
            break
          }
          case 'open-source': {
            // Reopen the file in VS Code's native text editor (the default .md editor).
            try {
              await vscode.commands.executeCommand('vscode.openWith', this._uri, 'default')
            } catch { }
            break
          }
          case 'export': {
            await handleExport(message, this._fsPath)
            break
          }
        }
      },
      null,
      this._disposables
    )
  }

  static getAssetsFolder(uri: vscode.Uri) {
    const imageSaveFolder = (
      EditorPanel.config.get<string>('imageSaveFolder') || 'assets'
    )
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
    const assetsFolder = NodePath.resolve(
      NodePath.dirname(uri.fsPath),
      imageSaveFolder
    )
    return assetsFolder
  }

  public dispose() {
    EditorPanel.currentPanel = undefined

    // Clean up our resources
    this._panel.dispose()

    while (this._disposables.length) {
      const x = this._disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }

  private _init() {
    const webview = this._panel.webview

    this._panel.webview.html = this._getHtmlForWebview(webview)
    this._panel.title = NodePath.basename(this._fsPath)
  }
  private _isEdit = false
  private _updateEditTitle() {
    const isEdit = this._document.isDirty
    if (isEdit !== this._isEdit) {
      this._isEdit = isEdit
      this._panel.title = `${isEdit ? `[edit]` : ''}${NodePath.basename(
        this._fsPath
      )}`
    }
  }

  // private fileToWebviewUri = (f: string) => {
  //   return this._panel.webview.asWebviewUri(vscode.Uri.file(f)).toString()
  // }

  private async _update(
    props: {
      type?: 'init' | 'update'
      options?: any
      theme?: 'dark' | 'light'
    } = { options: void 0 }
  ) {
    const md = this._document
      ? this._document.getText()
      : (await vscode.workspace.fs.readFile(this._uri)).toString()
    this._lastContent = md
    this._panel.webview.postMessage({
      command: 'update',
      content: md,
      ...props,
    })
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const toUri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, f))
    const baseHref =
      NodePath.dirname(
        webview.asWebviewUri(vscode.Uri.file(this._fsPath)).toString()
      ) + '/'
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
      EditorPanel.config.get<string>('customCss') +
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

/**
 * MarkdownEditorProvider implements CustomTextEditorProvider interface
 * Supports opening markdown files via "Open With"
 */
class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'markpad.customEditor'

  constructor(private readonly context: vscode.ExtensionContext) { }

  /**
   * Called when user selects Markdown Editor via "Open With"
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Set webview options
    webviewPanel.webview.options = this.getWebviewOptions()

    // Init webview content
    const uri = document.uri
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, uri)
    webviewPanel.title = NodePath.basename(uri.fsPath)

    const disposables: vscode.Disposable[] = []
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

    // Listen for document close
    vscode.workspace.onDidCloseTextDocument((e) => {
      if (e.fileName === uri.fsPath) {
        webviewPanel.dispose()
      }
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
              useVscodeThemeColor: EditorPanel.config.get<boolean>('useVscodeThemeColor'),
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
          const assetsFolder = EditorPanel.getAssetsFolder(uri)
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
      EditorPanel.config.get<string>('customCss') +
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

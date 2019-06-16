import * as vscode from 'vscode';
import * as path from 'path';
import { xacro, getPackages } from '../ros/utils'; 
import { Disposable, window } from 'vscode';

export default class URDFPreview 
{
    private _resource: vscode.Uri;
    private _processing: boolean;
    private  _context: vscode.ExtensionContext;
    private _disposable: Disposable;
    _urdfEditor: vscode.TextEditor;
    _webview: vscode.WebviewPanel;

    public get state() {
        return {
            resource: this.resource.toString()
        };
    }

    public static create(
        context: vscode.ExtensionContext,
        resource: vscode.Uri
        ) : URDFPreview
    {
        // Create and show a new webview
        var editor = vscode.window.createWebviewPanel(
            'urdfPreview', // Identifies the type of the webview. Used internally
            'URDF Preview', // Title of the panel displayed to the user
            vscode.ViewColumn.Two, // Editor column to show the new webview panel in.
            { 
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        return new URDFPreview(editor, context, resource);
    }

    private constructor(
        webview: vscode.WebviewPanel,
        context: vscode.ExtensionContext,
        resource: vscode.Uri
    )
    {
        this._webview = webview;
        this._context = context;
        this._resource = resource;
        this._processing = false;

        let subscriptions: Disposable[] = [];

        const templateFilename = this._context.asAbsolutePath("templates/preview.html");
        vscode.workspace.openTextDocument(templateFilename).then(doc => {
            var previewText = doc.getText();
            this._webview.webview.html = previewText;

            setTimeout(() => this.refresh(), 1000);
        });

        this._webview.onDidChangeViewState(e => {
            if (e.webviewPanel.active) {
                setTimeout(() => this.refresh(), 1000);
            }
            this._onDidChangeViewStateEmitter.fire(e);
        }, this, subscriptions);

        vscode.workspace.onDidSaveTextDocument(event => {

            if (event && this.isPreviewOf(event.uri)) {
                this.refresh();
            }
        }, this, subscriptions);

        this._webview.onDidDispose(() => {
            this.dispose();
        }, null, subscriptions);        

        this._disposable = Disposable.from(...subscriptions);
    }

    public get resource(): vscode.Uri {
        return this._resource;
    }

    public async refresh() {
        if (this._processing == false && vscode.window.activeTextEditor.document.uri.fsPath === this._resource.fsPath) {
            this._processing = true;

            var urdfText;
            let ext = path.extname(vscode.window.activeTextEditor.document.uri.fsPath);
            if (ext == ".xacro") {
                try {
                    urdfText = await xacro(vscode.window.activeTextEditor.document.uri.fsPath);
                } catch (err) {
                    vscode.window.showErrorMessage(err.message);
                }
            } else {
                urdfText = vscode.window.activeTextEditor.document.getText();
            }

            var packageMap = await getPackages();

            // replace package://(x) with fully resolved paths
            var pattern =  /package:\/\/(.*?)\//g;
            var match;
            while (match = pattern.exec(urdfText)) {
                urdfText = urdfText.replace('package://' + match[1], packageMap[match[1]]);
            }

            var previewFile = vscode.window.activeTextEditor.document.uri.toString();

            this._webview.webview.postMessage({ command: 'previewFile', previewFile: previewFile});
            this._webview.webview.postMessage({ command: 'urdf', urdf: urdfText });

            this._processing = false;
        }
    }

    public static async revive(
        webview: vscode.WebviewPanel,
        context: vscode.ExtensionContext,
        state: any,
    ): Promise<URDFPreview> {
        const resource = vscode.Uri.parse(state.previewFile);

        const preview = new URDFPreview(
            webview,
            context,
            resource);

        return preview;
    }    

    public matchesResource(
        otherResource: vscode.Uri
    ): boolean {
        return this.isPreviewOf(otherResource);
    }

    public reveal() {
        this._webview.reveal(vscode.ViewColumn.Two);
    }    

    private isPreviewOf(resource: vscode.Uri): boolean {
        return this._resource.fsPath === resource.fsPath;
    }

    private readonly _onDisposeEmitter = new vscode.EventEmitter<void>();
    public readonly onDispose = this._onDisposeEmitter.event;    
    
    private readonly _onDidChangeViewStateEmitter = new vscode.EventEmitter<vscode.WebviewPanelOnDidChangeViewStateEvent>();
    public readonly onDidChangeViewState = this._onDidChangeViewStateEmitter.event;

    public update(resource: vscode.Uri) {
        const editor = vscode.window.activeTextEditor;

        // If we have changed resources, cancel any pending updates
        const isResourceChange = resource.fsPath !== this._resource.fsPath;
        this._resource = resource;
        // Schedule update if none is pending
        this.refresh();
    }
    
    public dispose() {
        this._disposable.dispose();
        this._onDisposeEmitter.fire();
        this._onDisposeEmitter.dispose();

        this._onDidChangeViewStateEmitter.dispose();
        this._webview.dispose();    
    }
}
  
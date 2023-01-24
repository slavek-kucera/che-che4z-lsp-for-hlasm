/*
 * Copyright (c) 2022 Broadcom.
 * The term "Broadcom" refers to Broadcom Inc. and/or its subsidiaries.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Broadcom, Inc. - initial API and implementation
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as helper from './testHelper';

suite('Completion List Test Suite', () => {
    const workspace_file = 'open';
    let editor: vscode.TextEditor;
    let toDispose: vscode.Disposable[] = [];

    suiteSetup(async function () {
        this.timeout(10000);

        console.log("suiteSetup");
        // open and show the file
        const file = await helper.getWorkspaceFile(workspace_file);
        console.log('File', file);
        let document = await vscode.workspace.openTextDocument(file);
        console.log('Lang Id', document.languageId);
        //if (language_id)
        //    document = await vscode.languages.setTextDocumentLanguage(document, language_id);

        const visible = new Promise<vscode.TextEditor>((resolve) => {
            const listener = vscode.window.onDidChangeActiveTextEditor((e) => {
                if (e) {
                    listener.dispose();
                    resolve(e);
                }
            })
        });
        editor = await vscode.window.showTextDocument(document, { preview: false });
        console.log('Lang Id 2', document.languageId);
        assert.strictEqual(await visible, result.editor);
        console.log('Lang Id 3', document.languageId);
        editor = result.editor;

        toDispose.push(vscode.window.onDidChangeVisibleTextEditors(e => { console.log('onDidChangeVisibleTextEditors', editor, e, new Error().stack); }));
        //toDispose.push(vscode.window.onDidChangeActiveTextEditor(e => { console.log('onDidChangeActiveTextEditor', editor === e, e); }));
        for (let i = 0; i < 10; ++i)
            await helper.sleep(100);

    });

    suiteTeardown(async function () {
        console.log("suiteTeardown");
        toDispose.forEach(d => {
            d.dispose();
        });
        await helper.closeAllEditors();
    });

    // test completion list for instructions
    test('Completion List Instructions test', async () => {
        const diags = helper.waitForDiagnostics(workspace_file);
        const movePosition = await helper.insertString(editor, new vscode.Position(7, 1), 'L');
        await diags;

        const completionList: vscode.CompletionList = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', editor.document.uri, movePosition);

        const result = completionList.items.filter(complItem => complItem.label.toString().startsWith('L'));
        assert.strictEqual(result.length, 343, 'Wrong number of suggestion result.');
    }).timeout(10000).slow(1000);

    // test completion list for variable symbols
    test('Completion List Variable symbols test', async () => {
        // add '&' to simulate start of a variable symbol
        const diags = helper.waitForDiagnostics(workspace_file);
        const movePosition = await helper.insertString(editor, new vscode.Position(8, 0), '&');
        await diags;

        const completionList: vscode.CompletionList = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', editor.document.uri, movePosition);

        const labels = completionList.items.map(x => x.label.toString());
        assert.deepStrictEqual(labels, ['&VAR', '&VAR2'], 'Wrong suggestion result.');
    }).timeout(10000).slow(1000);
});

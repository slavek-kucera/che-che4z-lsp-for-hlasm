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
    let toDispose: vscode.Disposable[] = [];

    suiteSetup(async function () {
        this.timeout(10000);

        console.log("suiteSetup");

        toDispose.push(vscode.window.onDidChangeVisibleTextEditors(e => { console.log('onDidChangeVisibleTextEditors', e); console.trace(); }));
        toDispose.push(vscode.window.onDidChangeActiveTextEditor(e => { console.log('onDidChangeActiveTextEditor', e); console.trace(); }));

        await helper.showDocument(workspace_file);
    });

    suiteTeardown(async function () {
        console.log("suiteTeardown");
        await helper.closeAllEditors();
        toDispose.forEach(d => {
            d.dispose();
        });
    });

    // test completion list for instructions
    test('Completion List Instructions test', async () => {
        const diags = helper.waitForDiagnostics(workspace_file);
        const { editor, document } = await helper.showDocument(workspace_file, undefined, false);
        const movePosition = await helper.insertString(editor, new vscode.Position(7, 1), 'L');
        await diags;

        const completionList: vscode.CompletionList = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, movePosition);

        const result = completionList.items.filter(complItem => complItem.label.toString().startsWith('L'));
        assert.strictEqual(result.length, 343, 'Wrong number of suggestion result.');
    }).timeout(10000).slow(1000);

    // test completion list for variable symbols
    test('Completion List Variable symbols test', async () => {
        // add '&' to simulate start of a variable symbol
        let movePosition: vscode.Position;
        const diags = helper.waitForDiagnostics(workspace_file);
        const { editor, document } = await helper.showDocument(workspace_file, undefined, false);
        try {
            movePosition = await helper.insertString(editor, new vscode.Position(8, 0), '&');
        } catch (e) {
            console.log('excp', e);
            console.log('visibleTextEditors', vscode.window.visibleTextEditors);
            console.log('activeTextEditor', vscode.window.activeTextEditor);
            throw e;
        }
        await diags;

        const completionList: vscode.CompletionList = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, movePosition);

        const labels = completionList.items.map(x => x.label.toString());
        assert.deepStrictEqual(labels, ['&VAR', '&VAR2'], 'Wrong suggestion result.');
    }).timeout(10000).slow(1000);
});

/*
 * Copyright (c) 2019 Broadcom.
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

export async function run(): Promise<void> {
	let stop = false;
	vscode.workspace.onDidOpenTextDocument(e => console.log("onDidOpenTextDocument", e));
	for (let repeat = 0; !stop && repeat < 10; ++repeat) {
		console.log('Round', repeat);
		const files = await vscode.workspace.findFiles('plain.txt');
		const file = files[0]!;

		console.log('File', file);

		let document = await vscode.workspace.openTextDocument(file);

		console.log('Lang Id', document.languageId);
		//document = await vscode.languages.setTextDocumentLanguage(document, 'hlasm');

		const visible = new Promise<vscode.TextEditor>((resolve) => {
			const listener = vscode.window.onDidChangeActiveTextEditor((e) => {
				if (e) {
					listener.dispose();
					resolve(e);
				}
			})
		});
		const editor = await vscode.window.showTextDocument(document, { preview: false });

		console.log('Lang Id 2', document.languageId);

		assert.strictEqual(await visible, editor);

		console.log('Lang Id 3', document.languageId);

		const toDispose = vscode.window.onDidChangeVisibleTextEditors(e => { console.log('onDidChangeVisibleTextEditors', editor, e, new Error().stack); stop = true; });
		//toDispose.push(vscode.window.onDidChangeActiveTextEditor(e => { console.log('onDidChangeActiveTextEditor', editor === e, e); }));

		console.log('Lang Id 4', document.languageId);

		console.log("Editor", editor);

		await editor.edit(edit => {
			console.log("Editor2", editor);
			edit.insert(new vscode.Position(7, 1), 'L');
		});
		console.log("Editor3", editor);

		for (let i = 0; i < 10; ++i)
			await new Promise<void>((resolve) => { setTimeout(resolve, 100); });

		toDispose.dispose();

		await vscode.commands.executeCommand('workbench.action.files.revert');

		const closeAllEditors = new Promise<vscode.TextEditor[]>((resolve) => {
			const dispose = vscode.window.onDidChangeVisibleTextEditors(e => { dispose.dispose(); resolve(e); });
		});
		await vscode.commands.executeCommand('workbench.action.closeAllGroups');
		console.log("closeAllEditors", await closeAllEditors);
	}
}

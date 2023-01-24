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

	for (let repeat = 0; repeat < 1000; ++repeat) {
		const files = await vscode.workspace.findFiles('open');
		const file = files[0]!;

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
		const editor = await vscode.window.showTextDocument(document, { preview: false });

		console.log('Lang Id 2', document.languageId);

		assert.strictEqual(await visible, editor);

		console.log('Lang Id 3', document.languageId);

		const toDispose = vscode.window.onDidChangeVisibleTextEditors(e => { console.log('onDidChangeVisibleTextEditors', editor, e, new Error().stack); });
		//toDispose.push(vscode.window.onDidChangeActiveTextEditor(e => { console.log('onDidChangeActiveTextEditor', editor === e, e); }));
		for (let i = 0; i < 10; ++i)
			await new Promise<void>((resolve) => { setTimeout(resolve, ms); });

		toDispose.dispose();

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	}
}

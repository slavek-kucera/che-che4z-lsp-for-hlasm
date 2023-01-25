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
	let comment = '';
	vscode.window.onDidChangeVisibleTextEditors(e => { console.log(`visible text editors (${comment})`, e); });
	let stop = false;
	vscode.workspace.onDidOpenTextDocument(e => console.log("onDidOpenTextDocument", e));
	for (let repeat = 0; !stop && repeat < 10; ++repeat) {
		console.log('Round', repeat);
		const files = await vscode.workspace.findFiles('plain.txt');
		const file = files[0]!;

		comment = 'pre-open';
		let document = await vscode.workspace.openTextDocument(file);
		comment = 'post-open';

		//const visible = new Promise<vscode.TextEditor>((resolve) => {
		//	const listener = vscode.window.onDidChangeActiveTextEditor((e) => {
		//		if (e) {
		//			listener.dispose();
		//			resolve(e);
		//		}
		//	})
		//});

		comment = 'pre-show';
		const editor = await vscode.window.showTextDocument(document, { preview: false });
		comment = 'post-show';

		//assert.strictEqual(await visible, editor);

		comment = 'pre-edit';
		await editor.edit(edit => {
			comment = 'in-edit';
			edit.insert(new vscode.Position(7, 1), 'L');
		});
		comment = 'post-edit';

		for (let i = 0; i < 50; ++i)
			await new Promise<void>((resolve) => { setTimeout(resolve, 100); });

		comment = 'pre-edit2';
		await editor.edit(edit => {
			comment = 'in-edit';
			edit.insert(new vscode.Position(7, 1), 'L');
		});
		comment = 'post-edit2';

		comment = 'pre-revert';
		await vscode.commands.executeCommand('workbench.action.files.revert');
		comment = 'post-revert';

		comment = 'pre-close';
		await vscode.commands.executeCommand('workbench.action.closeAllGroups');
		comment = 'post-close';
	}
}

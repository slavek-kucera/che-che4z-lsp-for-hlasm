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

import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from 'vscode-test';
import { TestOptions } from 'vscode-test/out/runTest';
import * as process from 'process';

async function main() {
	try {
		// prepare development and tests paths
		const extensionDevelopmentPath = path.join(__dirname, '../../');
		const extensionTestsPath = path.join(__dirname, './suite/index');
		const launchArgs = [path.join(__dirname, './workspace/'), '--disable-extensions', '--disable-workspace-trust'];
		const vscodeExecutablePath = process.argv.length > 2 && process.argv[2] == 'insiders' && await downloadAndUnzipVSCode('insiders') || undefined;

		const filenames = [
			'/Users/runner/work/che-che4z-lsp-for-hlasm/che-che4z-lsp-for-hlasm/clients/vscode-hlasmplugin/.vscode-test/vscode-darwin-insiders/Visual Studio Code - Insiders.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js',
			'/Users/runner/work/che-che4z-lsp-for-hlasm/che-che4z-lsp-for-hlasm/clients/vscode-hlasmplugin/.vscode-test/vscode-darwin-insiders/Visual Studio Code - Insiders.app/Contents/Resources/app/out/vs/workbench/api/worker/extensionHostWorker.js',
		  ];
		  const fs = require('fs')
		  filenames.forEach(filename => fs.readFile(filename, 'utf8', function (err: any, data: string) {
			if (err) {
			  return console.log(err);
			}
			var result = data.replace(/tryHideEditor\(.+?\)\}\}\)\}dispose\(\)\{/g, '$&console.trace();');
		
			fs.writeFile(filename, result, 'utf8', function (err: any) {
			  if (err) return console.log(err);
			});
		  }));

		// run tests
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs
		});
	} catch (error) {
		console.log(error);
		console.error('Tests Failed');
		process.exit(1);
	}
}

main();

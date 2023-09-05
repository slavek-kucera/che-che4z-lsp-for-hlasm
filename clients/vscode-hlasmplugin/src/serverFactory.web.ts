/*
 * Copyright (c) 2023 Broadcom.
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

import * as vscode from 'vscode';
import * as vscodelc from 'vscode-languageclient/browser';
import { EXTENSION_ID } from './extension';
import { getConfig } from './eventsHandler';

export type ServerVariant = "tcp" | "native" | "wasm";

function worker_main(extensionUri: string, hlasm_arguments: string[]) {

    // add temporary message listener
    const tmpQueue: any[] = [];
    self.onmessage = (data: any) => {
        tmpQueue.push(data);
    }

    if (!extensionUri.endsWith('/'))
        extensionUri += '/';

    const server_uri = extensionUri + 'bin/wasm/language_server.mjs';
    const wasm_uri = extensionUri + 'bin/wasm/language_server.wasm';
    const worker_uri = extensionUri + 'bin/wasm/language_server.worker.js';

    const asDataUri = (x) => new Promise<string>((resolve, reject) => {
        const filereader = new FileReader();
        filereader.onload = (e) => typeof e.target?.result === 'string' ? resolve(e.target.result) : reject(Error('fail'));
        filereader.readAsDataURL(x);
    });

    Promise.all([fetch(server_uri).then(x => x.blob()).then(x => asDataUri(x)), fetch(wasm_uri).then(x => x.blob()), fetch(worker_uri).then(x => x.blob())]).then(([main_text, wasm_blob, worker_blob]) => {
        import(main_text).then(m => m.default({
            tmpQueue,
            worker: self,
            mainScriptUrlOrBlob: main_text,
            arguments: hlasm_arguments,
            locateFile(path: any) {
                if (typeof path !== 'string') return path;
                if (path.endsWith(".wasm")) {
                    return URL.createObjectURL(wasm_blob);
                }
                else if (path.endsWith("language_server.worker.js")) {
                    return URL.createObjectURL(worker_blob);
                }
                return path;
            },
        }))
    });
}

export async function createLanguageServer(_serverVariant: ServerVariant, clientOptions: vscodelc.LanguageClientOptions, extUri: vscode.Uri): Promise<vscodelc.BaseLanguageClient> {
    const worker_script = `(${worker_main.toString()})('${extUri.toString()}',${JSON.stringify(decorateArgs(getConfig<string[]>('arguments', [])))});`;

    const worker = new Worker(URL.createObjectURL(new Blob([worker_script], { type: 'application/javascript' })));

    return new vscodelc.LanguageClient(EXTENSION_ID, 'HLASM extension Language Server', clientOptions, worker);
}

function decorateArgs(args: Array<string>): Array<string> {
    return [
        '--hlasm-start',
        '--vscode-extensions',
        ...args,
        '--hlasm-end'
    ];
}

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

import * as vscode from "vscode";
import * as vscodelc from "vscode-languageclient";

// This is a temporary demo implementation

enum ExternalRequestType {
    read_file = 'read_file',
    read_directory = 'read_directory',
}

interface ExternalRequest {
    id: number,
    op: ExternalRequestType,
    url: string,
}

interface ExternalReadFileResponse {
    id: number,
    data: string,
}
interface ExternalReadDirectoryResponse {
    id: number,
    data: {
        members: string[],
        suggested_extension: string | undefined,
    },
}
interface ExternalErrorResponse {
    id: number,
    error: {
        code: number,
        msg: string,
    },
}

export interface ExternalFilesClient {
    listMembers(dataset: string): Promise<string[] | null | Error>;
    readMember(dataset: string, member: string): Promise<string | null | Error>;
}

const magicScheme = 'hlasm-external';

function extractUriDetails(uri: string | vscode.Uri) {
    if (typeof uri === 'string')
        uri = vscode.Uri.parse(uri, true);

    if (uri.scheme !== magicScheme) return null;

    const [dataset, member] = uri.path.split('/').slice(1).map(x => x.toUpperCase());

    if (!dataset || !/^(?:[A-Z$#@][A-Z$#@0-9]{1,7})(?:\.(?:[A-Z$#@][A-Z$#@0-9]{1,7}))*$/.test(dataset)) return null;
    if (member && !/^[A-Z$#@][A-Z$#@0-9]{1,7}(?:\..*)?$/.test(member)) return null; // ignore extension

    return {
        dataset: dataset,
        member: member ? member.split('.')[0] : null,

        uniqueName() {
            if (member)
                return `${this.dataset}/${this.member}`;
            else
                return this.dataset;
        }
    }
}

function invalidResponse(msg: ExternalRequest) {
    return Promise.resolve({ id: msg.id, error: { code: -5, msg: 'Invalid request' } });
}

export class HLASMExternalFiles {
    private toDispose: vscode.Disposable[] = [];

    private memberLists = new Map<string, string[] | null>();
    private memberContent = new Map<string, string | null>();

    private pendingRequests = new Set();

    private client: ExternalFilesClient = null;

    setClient(client: ExternalFilesClient) { this.client = client; }

    constructor(client: vscodelc.BaseLanguageClient) {
        this.toDispose.push(client.onNotification('external_file_request', params => this.handleRawMessage(params).then(
            msg => { if (msg) client.sendNotification('external_file_response', msg); }
        )));

        client.onDidChangeState(e => {
            if (e.newState === vscodelc.State.Starting)
                this.reset();
        }, this, this.toDispose);

        const me = this;
        this.toDispose.push(vscode.workspace.registerTextDocumentContentProvider(magicScheme, {
            provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
                if (uri.scheme !== magicScheme)
                    return null;
                const details = extractUriDetails(uri);
                if (!details || !details.member) return null;
                const content = me.memberContent.get(details.uniqueName());
                return content || null;
            }
        }));
    }

    reset() {
        this.pendingRequests.clear();
    }

    dispose() {
        this.toDispose.forEach(x => x.dispose());
    }

    private async handleFileMessage(msg: ExternalRequest): Promise<ExternalReadFileResponse | ExternalReadDirectoryResponse | ExternalErrorResponse | null> {
        const details = extractUriDetails(msg.url);
        if (!details || !details.member)
            return invalidResponse(msg);

        const content = this.memberContent.get(details.uniqueName());
        if (content)
            return Promise.resolve({
                id: msg.id,
                data: content
            });
        else if (content === null)
            return Promise.resolve({
                id: msg.id,
                error: { code: 0, msg: 'Not found' }
            });
        if (!this.client)
            return Promise.resolve({
                id: msg.id,
                error: { code: 0, msg: 'Not found' }
            });

        const token = {};
        this.pendingRequests.add(token);

        const result = await this.client.readMember(details.dataset, details.member);

        if (!this.pendingRequests.delete(token)) return Promise.resolve(null);

        if (!result) {
            this.memberContent.set(details.uniqueName(), null);

            return Promise.resolve({
                id: msg.id,
                error: { code: 0, msg: 'Not found' }
            });
        }
        else if (result instanceof Error) {
            vscode.window.showErrorMessage(result.message);

            return Promise.resolve({
                id: msg.id,
                error: { code: -1000, msg: result.message }
            });
        }
        else {
            this.memberContent.set(details.uniqueName(), result);

            return Promise.resolve({
                id: msg.id,
                data: result
            });
        }
    }
    private async handleDirMessage(msg: ExternalRequest): Promise<ExternalReadFileResponse | ExternalReadDirectoryResponse | ExternalErrorResponse | null> {
        const details = extractUriDetails(msg.url);
        if (!details || details.member)
            return invalidResponse(msg);

        const content = this.memberLists.get(details.uniqueName());
        if (content)
            return Promise.resolve({
                id: msg.id,
                data: {
                    members: content,
                    suggested_extension: '.hlasm',
                }
            });
        else if (content === null)
            return Promise.resolve({
                id: msg.id,
                error: { code: 0, msg: 'Not found' }
            });

        if (!this.client)
            return Promise.resolve({
                id: msg.id,
                error: { code: 0, msg: 'Not found' }
            });

        const token = {};
        this.pendingRequests.add(token);

        const result = await this.client.listMembers(details.dataset);

        if (!this.pendingRequests.delete(token)) return Promise.resolve(null);

        if (!result) {
            this.memberLists.set(details.uniqueName(), null);

            return Promise.resolve({
                id: msg.id,
                error: { code: 0, msg: 'Not found' }
            });
        }
        else if (result instanceof Error) {
            vscode.window.showErrorMessage(result.message);

            return Promise.resolve({
                id: msg.id,
                error: { code: -1000, msg: result.message }
            });
        }
        else {
            this.memberLists.set(details.uniqueName(), result);

            return Promise.resolve({
                id: msg.id,
                data: {
                    members: result,
                    suggested_extension: '.hlasm',
                }
            });
        }
    }

    public handleRawMessage(msg: any): Promise<ExternalReadFileResponse | ExternalReadDirectoryResponse | ExternalErrorResponse | null> {
        if (!msg || typeof msg.id !== 'number' || typeof msg.op !== 'string')
            return Promise.resolve(null);

        if (msg.op === ExternalRequestType.read_file && typeof msg.url === 'string')
            return this.handleFileMessage(msg);
        if (msg.op === ExternalRequestType.read_directory && typeof msg.url === 'string')
            return this.handleDirMessage(msg);

        return invalidResponse(msg);
    }

}


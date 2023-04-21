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

import { TextDecoder, TextEncoder } from "util";
import * as vscode from "vscode";
import * as vscodelc from "vscode-languageclient";
import { isCancellationError } from "./helpers";

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

export interface ExternalFilesClient extends vscode.Disposable {
    listMembers(dataset: string): Promise<string[] | null>;
    readMember(dataset: string, member: string): Promise<string | null>;

    onStateChange: vscode.Event<boolean>;

    suspend(): void;
    resume(): void;

    suspended(): boolean;
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
        associatedWorkspace: uriFriendlyBase16Decode(uri.authority),
        dataset: dataset,
        member: member ? member.split('.')[0] : null,

        uniqueName() {
            if (member)
                return `${this.dataset}(${this.member})`;
            else
                return this.dataset;
        }
    }
}
type UriDetails = ReturnType<typeof extractUriDetails>;

function invalidResponse(msg: ExternalRequest) {
    return Promise.resolve({ id: msg.id, error: { code: -5, msg: 'Invalid request' } });
}

const uriFriendlyBase16Stirng = 'abcdefghihjkmnop';
const uriFriendlyBase16StirngUC = 'ABCDEFGHIHJKMNOP';
const uriFriendlyBase16StirngBoth = 'abcdefghihjkmnopABCDEFGHIHJKMNOP';

const uriFriendlyBase16Map = (() => {
    const result = [];
    for (const c0 of uriFriendlyBase16Stirng)
        for (const c1 of uriFriendlyBase16Stirng)
            result.push(c0 + c1);

    return result;
})();

function uriFriendlyBase16Encode(s: string) {
    return [...new TextEncoder().encode(s)].map(x => uriFriendlyBase16Map[x]).join('');
}

function uriFriendlyBase16Decode(s: string) {
    if (s.length & 1) return '';
    const array = [];
    for (let i = 0; i < s.length; i += 2) {
        const c0 = uriFriendlyBase16StirngBoth.indexOf(s[i]);
        const c1 = uriFriendlyBase16StirngBoth.indexOf(s[i + 1]);
        if (c0 < 0 || c1 < 0) return '';
        array.push((c0 & 15) << 4 | (c1 & 15));
    }
    try {
        return new TextDecoder(undefined, { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(array));
    } catch (e) {
        return '';
    }
}

function take<T>(it: IterableIterator<T>, n: number): T[] {
    const result: T[] = [];
    while (n) {
        const val = it.next();
        if (val.done)
            break;
        result.push(val.value);
        --n;
    }
    return result;
}

const not_exists = {};
const no_client = {};
interface in_error { message: string };

export class HLASMExternalFiles {
    private toDispose: vscode.Disposable[] = [];

    private memberLists = new Map<string, string[] | in_error | typeof not_exists | typeof no_client>();
    private memberContent = new Map<string, string | in_error | typeof not_exists | typeof no_client>();

    private pendingRequests = new Set<{ topic: string }>();

    private client: ExternalFilesClient = null;
    private clientDisposables: vscode.Disposable[] = [];

    setClient(client: ExternalFilesClient) {
        this.clientDisposables.forEach(x => x.dispose());
        this.clientDisposables = [];
        if (this.client)
            this.client.dispose();

        this.client = client;
        this.clientDisposables.push(client.onStateChange((suspended) => {
            if (suspended) {
                if (this.activeProgress) {
                    clearTimeout(this.pendingActiveProgressCancellation);
                    this.activeProgress.done();
                    this.activeProgress = null;
                }
                vscode.window.showInformationMessage("Retrieval of remote files has been suspended.");
            }
            else
                this.notifyAllWorkspaces()
        }));
        if (!client.suspended())
            this.notifyAllWorkspaces();
    }

    private prepareFileChangeNotification() {
        const reissue = [...this.memberContent].filter(v => typeof v[1] === 'object' && (v[1] === no_client || 'message' in v[1]));

        const changes = reissue.map(([d]) => d.replace(')', '').replace('(', '/'));

        reissue.forEach(x => this.memberContent.delete(x[0]));

        // NxM...
        return (vscode.workspace.workspaceFolders || []).map(w => {
            const base = `${magicScheme}://${uriFriendlyBase16Encode(w.uri.toString())}`;
            return changes.map(x => {
                return {
                    uri: `${base}/${x}.hlasm`,
                    type: vscodelc.FileChangeType.Changed
                }
            })
        }).flat();
    }

    private prepareDirChangeNotification() {
        const reissue = [...this.memberLists].filter(v => typeof v[1] === 'object' && (v[1] === no_client || 'message' in v[1]));

        const changes = reissue.map(([d]) => d.replace(')', '').replace('(', '/'));

        reissue.forEach(x => this.memberLists.delete(x[0]));

        // NxM...
        return (vscode.workspace.workspaceFolders || []).map(w => {
            const base = `${magicScheme}://${uriFriendlyBase16Encode(w.uri.toString())}`;
            return changes.map(x => {
                return {
                    uri: `${base}/${x}`,
                    type: vscodelc.FileChangeType.Changed
                }
            })
        }).flat();
    }

    private notifyAllWorkspaces() {
        this.lspClient.sendNotification(vscodelc.DidChangeWatchedFilesNotification.type, {
            changes: (vscode.workspace.workspaceFolders || []).map(w => {
                return {
                    uri: `${magicScheme}://${uriFriendlyBase16Encode(w.uri.toString())}`,
                    type: vscodelc.FileChangeType.Changed
                };
            })
                .concat(this.prepareFileChangeNotification())
                .concat(this.prepareDirChangeNotification())
        });
    }

    activeProgress: { progressUpdater: vscode.Progress<{ message?: string; increment?: number }>, done: () => void } = null;
    pendingActiveProgressCancellation: ReturnType<typeof setTimeout> = null;
    addWIP(topic: string) {
        clearTimeout(this.pendingActiveProgressCancellation);
        if (!this.activeProgress) {
            vscode.window.withProgress({ title: 'Retrieving remote files', location: vscode.ProgressLocation.Notification }, (progress, c) => {
                return new Promise<void>((resolve) => {
                    this.activeProgress = { progressUpdater: progress, done: resolve };
                });
            });
        }
        const wip = { topic: topic };
        this.pendingRequests.add(wip);

        this.activeProgress.progressUpdater.report({
            message: take(this.pendingRequests.values(), 3)
                .map((v, n) => { return n < 2 ? v.topic : '...' })
                .join(', ')
        });

        return () => {
            const result = this.pendingRequests.delete(wip);

            if (this.pendingRequests.size === 0) {
                this.pendingActiveProgressCancellation = setTimeout(() => {
                    this.activeProgress.done();
                    this.activeProgress = null;
                }, 5000);
            }

            return result;
        };
    }

    public suspend() {
        if (this.client)
            this.client.suspend();
    }

    public resume() {
        if (this.client)
            this.client.resume();
    }

    constructor(private lspClient: vscodelc.BaseLanguageClient) {
        this.toDispose.push(lspClient.onNotification('external_file_request', params => this.handleRawMessage(params).then(
            msg => { if (msg) lspClient.sendNotification('external_file_response', msg); }
        )));

        lspClient.onDidChangeState(e => {
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
                if (typeof content === 'string')
                    return content;
                else
                    return null;
            }
        }));
    }

    reset() {
        this.pendingRequests.clear();
    }

    dispose() {
        this.toDispose.forEach(x => x.dispose());
        this.setClient(null);
    }

    private async getFile(details: UriDetails): Promise<string | in_error | typeof not_exists | typeof no_client | null> {
        if (!this.client)
            return no_client;

        const interest = this.addWIP(details.uniqueName());

        try {
            const result = await this.client.readMember(details.dataset, details.member);

            if (!interest()) return null;

            if (!result)
                return not_exists;

            return result;

        } catch (e) {
            if (!isCancellationError(e)) {
                this.suspend();
                vscode.window.showErrorMessage(e.message);
            }

            if (!interest()) return null;

            return { message: e.message };
        }
    }

    private async handleFileMessage(msg: ExternalRequest): Promise<ExternalReadFileResponse | ExternalReadDirectoryResponse | ExternalErrorResponse | null> {
        const details = extractUriDetails(msg.url);
        if (!details || !details.member)
            return invalidResponse(msg);

        let content = this.memberContent.get(details.uniqueName());
        if (content === undefined) {
            content = await this.getFile(details);
            if (content !== null)
                this.memberContent.set(details.uniqueName(), content);
        }

        if (content === null)
            return Promise.resolve(null);
        else if (content === not_exists)
            return Promise.resolve({
                id: msg.id,
                error: { code: 0, msg: 'Not found' }
            });
        else if (content === no_client)
            return Promise.resolve({
                id: msg.id,
                error: { code: -1000, msg: 'No client' }
            });
        else if (typeof content === 'object' && 'message' in content)
            return Promise.resolve({
                id: msg.id,
                error: { code: -1000, msg: content.message }
            });
        else if (typeof content === 'string')
            return Promise.resolve({
                id: msg.id,
                data: content
            });
        else // should never happen
            return Promise.resolve(null);
    }

    private async getDir(details: UriDetails): Promise<string[] | in_error | typeof not_exists | typeof no_client | null> {
        if (!this.client)
            return no_client;

        const interest = this.addWIP(details.uniqueName());

        try {
            const result = await this.client.listMembers(details.dataset);

            if (!interest()) return null;

            if (!result)
                return not_exists;

            return result;
        }
        catch (e) {
            if (!isCancellationError(e)) {
                this.suspend();
                vscode.window.showErrorMessage(e.message);
            }

            if (!interest()) return null;

            return { message: e.message };
        }
    }

    private async handleDirMessage(msg: ExternalRequest): Promise<ExternalReadFileResponse | ExternalReadDirectoryResponse | ExternalErrorResponse | null> {
        const details = extractUriDetails(msg.url);
        if (!details || details.member)
            return invalidResponse(msg);

        let content = this.memberLists.get(details.uniqueName());

        if (content === undefined) {
            content = await this.getDir(details);
            if (content !== null)
                this.memberLists.set(details.uniqueName(), content);
        }

        if (content === null)
            return Promise.resolve(null);
        else if (content === not_exists)
            return Promise.resolve({
                id: msg.id,
                error: { code: 0, msg: 'Not found' }
            });
        else if (content === no_client)
            return Promise.resolve({
                id: msg.id,
                error: { code: 0, msg: 'No client' }
            });
        else if ('message' in content)
            return Promise.resolve({
                id: msg.id,
                error: { code: -1000, msg: content.message }
            });
        else if (Array.isArray(content))
            return Promise.resolve({
                id: msg.id,
                data: {
                    members: content,
                    suggested_extension: '.hlasm',
                }
            });
        else // should never happen
            return Promise.resolve(null);
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


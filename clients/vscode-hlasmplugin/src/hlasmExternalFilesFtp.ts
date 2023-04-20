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
import * as ftp from 'basic-ftp';
import { ExternalFilesClient } from './hlasmExternalFiles';
import { ConnectionInfo, connectionSecurityLevel, gatherConnectionInfo, getLastRunConfig, updateLastRunConfig } from './ftpCreds';
import { AsyncMutex } from './asyncMutex';
import { FBWritable } from './FBWritable';

const checkResponse = (resp: ftp.FTPResponse) => {
    if (resp.code < 200 || resp.code > 299)
        throw Error("FTP Error: " + resp.message);
}
const checkedCommand = async (client: ftp.Client, command: string): Promise<string> => {
    const resp = await client.send(command);
    checkResponse(resp);
    return resp.message
}

export class HLASMExternalFilesFtp implements ExternalFilesClient {
    private connInfo_: ConnectionInfo = null;
    private suspended = false;

    private pooledClient: ftp.Client = null;
    private pooledClientTimeout: ReturnType<typeof setTimeout> = null;

    private mutex = new AsyncMutex();

    private static pooledClientReleaseTimeout = 30000;

    private stateChanged = new vscode.EventEmitter<boolean>();

    get onStateChange() {
        return this.stateChanged.event;
    }

    suspend() {
        if (this.suspended) return;

        this.suspended = true;
        this.stateChanged.fire(true);
    }
    resume() {
        if (!this.suspended) return;

        this.suspended = false;
        this.stateChanged.fire(false);
    }

    dispose(): void {
        clearTimeout(this.pooledClientTimeout);
        if (this.pooledClient) {
            this.pooledClient.close();
            this.pooledClient = null;
        }
    }

    constructor(private context: vscode.ExtensionContext) { }

    private getConnInfo() {
        return this.mutex.locked(async () => {
            try {
                if (this.suspended)
                    throw new vscode.CancellationError();

                if (this.connInfo_)
                    return this.connInfo_;

                const last = getLastRunConfig(this.context);
                this.connInfo_ = await gatherConnectionInfo(last);
                await updateLastRunConfig(this.context, { host: this.connInfo_.host, user: this.connInfo_.user, jobcard: last.jobcard });

                return this.connInfo_;
            }
            catch (e) {
                if (e instanceof vscode.CancellationError || e instanceof Error && e.message == new vscode.CancellationError().message) {
                    this.suspend();
                    throw new vscode.CancellationError();
                }
                throw e;
            }
        });
    }

    private requestEndHandle(client: ftp.Client) {
        if (this.pooledClient) {
            client.close();
            return;
        }

        this.pooledClientTimeout = setTimeout(() => {
            this.pooledClient.close();
            this.pooledClient = null;
        }, HLASMExternalFilesFtp.pooledClientReleaseTimeout);

        this.pooledClient = client;
    }

    private async getConnectedClient() {
        if (this.pooledClient) {
            clearTimeout(this.pooledClientTimeout);
            const client = this.pooledClient;
            this.pooledClient = null;
            return client;
        }

        while (true) {
            const client = new ftp.Client();
            try {
                const connection = await this.getConnInfo();

                await client.access({
                    host: connection.host,
                    user: connection.user,
                    password: connection.password,
                    port: connection.port,
                    secure: connection.securityLevel !== connectionSecurityLevel.unsecure,
                    secureOptions: connection.securityLevel === connectionSecurityLevel.unsecure ? undefined : { rejectUnauthorized: connection.securityLevel !== connectionSecurityLevel.rejectUnauthorized }
                });

                client.parseList = (rawList: string): ftp.FileInfo[] => {
                    return rawList.split(/\r?\n/).slice(1).filter(x => !/^\s*$/.test(x)).map(value => new ftp.FileInfo(value.trim()));
                };

                return client;
            }
            catch (e) {
                this.connInfo_ = null;
                client.close();

                throw e;
            }
        }
    }

    async listMembersImpl(client: ftp.Client, dataset: string): Promise<string[] | null> {
        try {
            checkResponse(await client.cd(`'${dataset}'`));
            await checkedCommand(client, 'TYPE A');
            const list = await client.list();
            return list.map(x => x.name);
        }
        catch (e) {
            if (e instanceof ftp.FTPError && e.code == 550)
                return null;
            throw e;
        }
    }

    async listMembers(dataset: string): Promise<string[] | null> {
        const client = await this.getConnectedClient();
        return this.listMembersImpl(client, dataset).finally(() => { this.requestEndHandle(client) });
    }

    async readMemberImpl(client: ftp.Client, dataset: string, member: string): Promise<string | null> {
        try {
            const buffer = new FBWritable();
            buffer.on('error', err => { throw err });

            await checkedCommand(client, 'TYPE I');
            checkResponse(await client.downloadTo(buffer, `'${dataset}(${member})'`));

            return buffer.getResult();
        }
        catch (e) {
            if (e instanceof ftp.FTPError && e.code == 550)
                return null;
            throw e;
        }
    }
    async readMember(dataset: string, member: string): Promise<string | null> {
        const client = await this.getConnectedClient();
        return this.readMemberImpl(client, dataset, member).finally(() => { this.requestEndHandle(client); });
    }
}

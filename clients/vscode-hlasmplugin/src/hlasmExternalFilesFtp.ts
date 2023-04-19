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
import { Writable } from 'stream';
import { convertBuffer } from './conversions';
import { TextDecoder } from 'util';
import { cancelMessage } from './uiUtils';

class StringWritable extends Writable {
    private chunks: Buffer[] = [];
    private result: string = null;

    _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.chunks.push(chunk);

        callback();
    }

    _final(callback: (error?: Error | null) => void) {
        const decoder = new TextDecoder();

        this.result = decoder.decode(convertBuffer(Buffer.concat(this.chunks), 80));

        callback();
    };

    getResult() { return this.result; }
}

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

    private client_: ftp.Client = null;
    private client_timeout: ReturnType<typeof setTimeout> = null;

    private async_lock: Promise<void> = null;

    private static unused_timeout = 30000;

    constructor(private context: vscode.ExtensionContext) { }

    private async getConnInfo() {
        while (this.async_lock)
            await this.async_lock;

        let resolve: () => void;
        this.async_lock = new Promise((r) => { resolve = r; })

        try {
            if (this.suspended)
                return null;

            if (this.connInfo_)
                return this.connInfo_;

            const last = getLastRunConfig(this.context);
            this.connInfo_ = await gatherConnectionInfo(last);
            await updateLastRunConfig(this.context, { host: this.connInfo_.host, user: this.connInfo_.user, jobcard: last.jobcard });

            return this.connInfo_;
        }
        catch (e) {
            if (e.message === cancelMessage)
                return null;
            throw e;
        }
        finally {
            resolve();
            this.async_lock = null;
        }
    }

    private cleanupSharedClient() {
        this.client_.close();
        this.client_ = null;
    }

    private async getConnectedClient() {
        if (this.client_) {
            clearTimeout(this.client_timeout);
            const client = this.client_;
            this.client_ = null;
            try {
                //await client.pwd(); // check if alive
                return client;
            }
            catch (e) {
                client.close();
            }
        }

        while (true) {
            const client = new ftp.Client();
            try {
                const connection = await this.getConnInfo();

                if (!connection) {
                    this.suspended = true;
                    return null;
                }

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

                vscode.window.showErrorMessage(e.message);
            }
        }
    }

    async listMembersImpl(client: ftp.Client, dataset: string): Promise<string[] | null | Error> {
        try {
            checkResponse(await client.cd(`'${dataset}'`));
            await checkedCommand(client, 'TYPE A');
            const list = await client.list();
            return list.map(x => x.name);
        }
        catch (e) {
            if (e instanceof ftp.FTPError && e.code == 550)
                return null;
            return e;
        }
    }

    async listMembers(dataset: string): Promise<string[] | null | Error> {
        const client = await this.getConnectedClient();
        if (!client) return null;
        return this.listMembersImpl(client, dataset).finally(() => { this.requestEndHandle(client) });
    }

    async readMemberImpl(client: ftp.Client, dataset: string, member: string): Promise<string | null | Error> {
        try {
            const buffer = new StringWritable();
            buffer.on('error', err => { throw err });

            await checkedCommand(client, 'TYPE I');
            checkResponse(await client.downloadTo(buffer, `'${dataset}(${member})'`));

            return buffer.getResult();
        }
        catch (e) {
            if (e instanceof ftp.FTPError && e.code == 550)
                return null;
            return e;
        }
    }
    async readMember(dataset: string, member: string): Promise<string | null | Error> {
        const client = await this.getConnectedClient();
        if (!client) return null;
        return this.readMemberImpl(client, dataset, member).finally(() => { this.requestEndHandle(client); });
    }

    private requestEndHandle(client: ftp.Client) {
        if (this.client_)
            client.close();
        else {
            this.client_timeout = setTimeout(() => this.cleanupSharedClient(), HLASMExternalFilesFtp.unused_timeout);
            this.client_ = client;
        }
    }

}

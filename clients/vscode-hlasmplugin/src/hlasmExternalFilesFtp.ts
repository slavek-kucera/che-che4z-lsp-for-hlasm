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

    constructor(private context: vscode.ExtensionContext) { }

    private async getConnInfo() {
        if (this.connInfo_)
            return this.connInfo_;

        const last = getLastRunConfig(this.context);
        this.connInfo_ = await gatherConnectionInfo(last);
        await updateLastRunConfig(this.context, { host: this.connInfo_.host, user: this.connInfo_.user, jobcard: last.jobcard });

        return this.connInfo_;
    }

    private async getConnectedClient() {
        const connection = await this.getConnInfo();
        const client = new ftp.Client();

        try {
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

    async listMembers(dataset: string): Promise<string[] | null | Error> {
        const client = await this.getConnectedClient();
        try {
            checkResponse(await client.cd(`'${dataset}'`));
            const list = await client.list();
            return list.map(x => x.name);
        }
        catch (e) {
            if (e instanceof ftp.FTPError && e.code == 550)
                return null;
            return e;
        }
        finally {
            client.close();
        }
    }
    async readMember(dataset: string, member: string): Promise<string | null | Error> {
        let client: ftp.Client = null;
        try {
            client = await this.getConnectedClient()
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
        finally {
            //    if (client)
            //        client.close();
        }
    }

}

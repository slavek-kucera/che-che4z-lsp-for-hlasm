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


import * as assert from 'assert';
import * as crypto from "crypto";
import { ClientInterface, ClientUriDetails, ExternalRequestType, HLASMExternalFiles } from '../../hlasmExternalFiles';
import { FileSystem, Uri } from 'vscode';
import { FileType } from 'vscode';
import { TextEncoder } from 'util';
import { deflateSync } from 'zlib';

suite('External files', () => {

    test('Invalid messages', async () => {
        const ext = new HLASMExternalFiles('test', {
            onNotification: (_, __) => { return { dispose: () => { } }; },
            sendNotification: (_: any, __: any) => Promise.resolve(),
        });

        assert.strictEqual(await ext.handleRawMessage(null), null);
        assert.strictEqual(await ext.handleRawMessage(undefined), null);
        assert.strictEqual(await ext.handleRawMessage({}), null);
        assert.strictEqual(await ext.handleRawMessage(5), null);
        assert.strictEqual(await ext.handleRawMessage({ id: 'id', op: '' }), null);
        assert.strictEqual(await ext.handleRawMessage({ id: 5, op: 5 }), null);

        assert.deepEqual(await ext.handleRawMessage({ id: 5, op: '' }), { id: 5, error: { code: -5, msg: 'Invalid request' } });
        assert.deepEqual(await ext.handleRawMessage({ id: 5, op: 'read_file', url: 5 }), { id: 5, error: { code: -5, msg: 'Invalid request' } });
        assert.deepEqual(await ext.handleRawMessage({ id: 5, op: 'read_file', url: {} }), { id: 5, error: { code: -5, msg: 'Invalid request' } });

        assert.deepEqual(await ext.handleRawMessage({ id: 5, op: 'read_file', url: 'unknown:scheme' }), { id: 5, error: { code: -5, msg: 'Invalid request' } });

        assert.deepEqual(await ext.handleRawMessage({ id: 5, op: 'read_file', url: 'test:/SERVICE' }), { id: 5, error: { code: -1000, msg: 'No client' } });
    });

    test('Clear cache', async () => {
        const cacheUri = Uri.parse('test:cache/');

        let readCounter = 0;
        let deleteCounter = 0;

        const ext = new HLASMExternalFiles('test', {
            onNotification: (_, __) => { return { dispose: () => { } }; },
            sendNotification: (_: any, __: any) => Promise.resolve(),
        }, {
            uri: cacheUri,
            fs: {
                readDirectory: async (uri: Uri) => {
                    ++readCounter;
                    assert.strictEqual(cacheUri.toString(), uri.toString());
                    return [['A', FileType.File]];
                },
                delete: async (uri: Uri, options?: { recursive?: boolean; useTrash?: boolean }) => {
                    ++deleteCounter;
                    assert.strictEqual(uri.toString(), Uri.joinPath(cacheUri, 'A').toString())
                },
            } as any as FileSystem
        });

        await ext.clearCache();

        assert.strictEqual(readCounter, 1);
        assert.strictEqual(deleteCounter, 1);

    });
    const nameGenerator = (components: string[]) => {
        return 'v1.' + crypto.createHash('sha256').update(JSON.stringify(components)).digest().toString('hex');
    };
    test('Access cached content', async () => {
        const cacheUri = Uri.parse('test:cache/');
        const dirResponse = deflateSync(new TextEncoder().encode(JSON.stringify("not_exists")));
        const dir2Content = ['FILE'];
        const dir2Response = deflateSync(new TextEncoder().encode(JSON.stringify({ data: dir2Content })));
        const fileContent = 'file content';
        const fileResponse = deflateSync(new TextEncoder().encode(JSON.stringify({ data: fileContent })));

        let dirWritten = false;
        let dir2Written = false;
        let fileWritten = false;

        const ext = new HLASMExternalFiles('test', {
            onNotification: (_, __) => { return { dispose: () => { } }; },
            sendNotification: (_: any, __: any) => Promise.resolve(),
        }, {
            uri: cacheUri,
            fs: {
                readFile: async (uri: Uri) => {
                    const filename = uri.path.split('/').pop();
                    if (filename === nameGenerator(['SERVER', 'TEST', '/DIR']))
                        return dirResponse;
                    if (filename === nameGenerator(['SERVER', 'TEST', '/DIR2']))
                        return dir2Response;
                    if (filename === nameGenerator(['SERVER', 'TEST', '/DIR2/FILE']))
                        return fileResponse;
                    assert.ok(false);
                },
                writeFile: async (uri: Uri, content: Uint8Array) => {
                    const filename = uri.path.split('/').pop();
                    if (filename === nameGenerator(['SERVER', 'TEST', '/DIR'])) {
                        dirWritten = true;
                        assert.deepStrictEqual(content, dirResponse);
                        return;
                    }
                    if (filename === nameGenerator(['SERVER', 'TEST', '/DIR2'])) {
                        dir2Written = true;
                        assert.deepStrictEqual(content, dir2Response);
                        return;
                    }
                    if (filename === nameGenerator(['SERVER', 'TEST', '/DIR2/FILE'])) {
                        fileWritten = true;
                        assert.deepStrictEqual(content, fileResponse);
                        return;
                    }
                    assert.ok(false);
                },
            } as any as FileSystem
        });

        ext.setClient('TEST', {
            getConnInfo: () => Promise.resolve({ info: '', uniqueId: 'SERVER' }),
            parseArgs: (path: string, purpose: ExternalRequestType): ClientUriDetails | null => {
                if (purpose === ExternalRequestType.read_file)
                    return {
                        normalizedPath: () => '/DIR2/FILE',
                    };
                else if (path.endsWith('DIR'))
                    return {
                        normalizedPath: () => '/DIR',
                    };
                else if (path.endsWith('DIR2'))
                    return {
                        normalizedPath: () => '/DIR2',
                    };
                return null;
            },
            createClient: () => {
                return {
                    dispose: () => { },

                    connect: (_: string) => Promise.resolve(),

                    listMembers: (_: ClientUriDetails) => Promise.resolve(null),
                    readMember: (_: ClientUriDetails) => Promise.resolve(null),

                    reusable: () => false,
                };
            }
        } as any as ClientInterface<string, ClientUriDetails, ClientUriDetails>);

        const dir = await ext.handleRawMessage({ id: 4, op: 'read_directory', url: 'test:/TEST/DIR' });
        assert.ok(dir);
        assert.strictEqual(dir.id, 4);
        assert.ok('error' in dir);
        assert.strictEqual(dir?.error?.code, 0);

        const dir2 = await ext.handleRawMessage({ id: 5, op: 'read_directory', url: 'test:/TEST/DIR2' });
        assert.ok(dir2);
        assert.strictEqual(dir2.id, 5);
        assert.ok('data' in dir2);
        assert.ok(dir2.data instanceof Object);
        assert.deepStrictEqual(dir2.data.members, dir2Content);

        const file = await ext.handleRawMessage({ id: 6, op: 'read_file', url: 'test:/TEST/DIR2/FILE' });
        assert.ok(file);
        assert.strictEqual(file.id, 6);
        assert.ok('data' in file);
        assert.strictEqual(file.data, fileContent);

        ext.dispose();

        assert.strictEqual(dirWritten, true);
        assert.strictEqual(dir2Written, true);
        assert.strictEqual(fileWritten, true);
    });

    test('Access invalid cache content', async () => {
        const ext = new HLASMExternalFiles('test', {
            onNotification: (_, __) => { return { dispose: () => { } }; },
            sendNotification: (_: any, __: any) => Promise.resolve(),
        }, {
            uri: Uri.parse('test:cache/'),
            fs: {
                readFile: async (_: Uri) => Uint8Array.from([0]),
                writeFile: async (_uri: Uri, _content: Uint8Array) => { },
            } as any as FileSystem
        });

        ext.setClient('TEST', {
            getConnInfo: () => Promise.resolve({ info: '', uniqueId: 'SERVER' }),
            parseArgs: (_path: string, _purpose: ExternalRequestType): ClientUriDetails | null => {
                return {
                    normalizedPath: () => '/DIR',
                };
            },
            createClient: () => {
                return {
                    dispose: () => { },

                    connect: (_: string) => Promise.resolve(),

                    listMembers: (_: ClientUriDetails) => Promise.resolve(null),
                    readMember: (_: ClientUriDetails) => Promise.resolve(null),

                    reusable: () => false,
                };
            }
        } as any as ClientInterface<string, ClientUriDetails, ClientUriDetails>);

        const dir = await ext.handleRawMessage({ id: 4, op: 'read_directory', url: 'test:/TEST/DIR' });
        assert.ok(dir);
        assert.strictEqual(dir.id, 4);
        assert.ok('error' in dir);
        assert.strictEqual(dir?.error?.code, 0);
    });
});
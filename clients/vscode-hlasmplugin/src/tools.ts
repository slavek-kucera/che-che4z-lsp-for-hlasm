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
import * as zlib from 'zlib';
import * as os from 'os';
import * as crypto from "crypto";
import * as path from 'path';

export async function deflate(data: Uint8Array): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
        zlib.deflate(data, (e, r) => { e && reject(e) || resolve(r) });
    });
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
        zlib.inflate(data, (e, r) => { e && reject(e) || resolve(r) });
    });
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function textDecode(input: Uint8Array): string {
    return decoder.decode(input);
}

export function textEncode(input: string): Uint8Array {
    return encoder.encode(input);
}

export const EOL = os.EOL;

export function sha256(s: string): string {
    return crypto.createHash('sha256').update(s).digest().toString('hex')
}

export function relative(base: vscode.Uri, target: vscode.Uri) {
    return path.relative(base.path, target.path);
}

export function decodeBase64(s: string): string {
    return Buffer.from(s, "base64").toString().trim();
}

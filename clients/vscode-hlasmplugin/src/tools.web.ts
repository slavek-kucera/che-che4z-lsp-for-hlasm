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

export async function deflate(data: Uint8Array): Promise<Uint8Array> {
    const input = new ReadableStream({
        start(controller) {
            controller.enqueue(data);
            controller.close();
        },
    });
    return new Uint8Array(await new Response(input.pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
    const input = new ReadableStream({
        start(controller) {
            controller.enqueue(data);
            controller.close();
        },
    });
    return new Uint8Array(await new Response(input.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
}

const decoder = new TextDecoder();
const decoderStrict = new TextDecoder(undefined, { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

export function textDecode(input: Uint8Array): string {
    return decoder.decode(input);
}

export function textDecodeStrict(input: Uint8Array): string {
    return decoderStrict.decode(input);
}

export function textEncode(input: string): Uint8Array {
    return encoder.encode(input);
}

export const EOL = '\n';

export async function sha256(s: string): Promise<string> {
    // This will fail outside of secure contexts because of W3C.

    const hash = await crypto.subtle.digest("SHA-256", textEncode(s));

    let result = '';
    for (const b of new Uint8Array(hash)) {
        result += '0123456789abcdef'[b >> 4];
        result += '0123456789abcdef'[b & 15];
    }

    return result;
}

export function decodeBase64(s: string): string {
    return self.atob(s);
}

function fromHexNibble(s: string): number {
    const r = '0123456789abcdef0123456789ABCDEF'.indexOf(s);
    if (r < 0)
        return -1;
    return r & 15;
}

export function textFromHex(s: string): string {
    return decoder.decode(arrayFromHex(s));
}

export function arrayFromHex(s: string): Uint8Array {
    const result = new Uint8Array(s.length / 2);
    for (let i = 0; i < s.length / 2; ++i) {
        const u = fromHexNibble(s[2 * i]);
        const l = fromHexNibble(s[2 * i + 1]);
        if (u < 0 || l < 0)
            return result.slice(0, i);

        result[i] = u * 16 + l;
    }
    return result;
}

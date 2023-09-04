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

// simple approximations of the real implementation
export function ok(e: any, msg: string | undefined) {
    if (!e)
        throw Error(msg);
}

export function strictEqual(l: any, r: any, msg: string | undefined) {
    if (!Object.is(l, r))
        throw Error(msg);
}

export function deepStrictEqual(l: any, r: any, msg: string | undefined) {
    if (Object.is(l, r))
        return;

    if (typeof l !== 'object' || typeof r !== 'object')
        throw Error(msg);

    const larray = Array.isArray(l);
    const rarray = Array.isArray(r);

    if (larray !== rarray)
        throw Error(msg);
    else if (larray) {
        if (l.length != r.length)
            throw Error(msg);

        for (let i = 0; i < l.length; ++i)
            deepStrictEqual(l[i], r[i], msg);
    }
    else {
        const lkey = Object.keys(l);
        const rkey = Object.keys(r);

        if (lkey.length != rkey.length)
            throw Error(msg);

        for (const key of lkey) {
            if (!(key in r))
                throw Error(msg);

            deepStrictEqual(l[key], r[key], msg);
        }
    }
}

export function match(s: string, r: RegExp, msg: string | undefined) {
    if (!r.test(s))
        throw Error(msg);
}

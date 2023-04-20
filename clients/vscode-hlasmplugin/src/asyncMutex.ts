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

export class AsyncSemaphore {
    private queue = new Set<Promise<void>>();

    constructor(private limit: number) { }

    public async locked<T>(action: () => T | PromiseLike<T>): Promise<T> {
        let resolve: () => void;
        while (this.queue.size >= this.limit) {
            await this.queue.values().next().value;
        }
        const p = new Promise<void>((r) => resolve = r);
        try {
            this.queue.add(p);

            return await Promise.resolve(action());
        }
        finally {
            this.queue.delete(p);
            resolve();
        }
    }
}

export class AsyncMutex extends AsyncSemaphore {
    constructor() { super(1); }
}

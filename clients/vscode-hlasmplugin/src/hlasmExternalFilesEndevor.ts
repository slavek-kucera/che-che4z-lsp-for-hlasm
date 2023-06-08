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
import { ExternalRequestType, HlasmExtension } from './extension.interface';

function performRegistration(ext: HlasmExtension, e4e: unknown) {
    const invalidationEventEmmiter = new vscode.EventEmitter<void>();

    ext.registerExternalFileClient('ENDEVOR', {
        getConnInfo: () => Promise.resolve({ info: '', uniqueId: '' }),
        parseArgs(p: string, purpose: ExternalRequestType, query?: string) {
            const args = p.split('/').slice(1);
            if (args.length !== 8 + +(purpose === ExternalRequestType.read_file)) return null;

            const [profile, use_map, instance, environment, stage, system, subsystem, type, element_hlasm] = args;
            if (purpose === ExternalRequestType.list_directory) {
                return {
                    profile,
                    use_map,
                    instance,
                    environment,
                    stage,
                    system,
                    subsystem,
                    type,
                    normalizedPath() { return `/${profile}/${use_map}/${instance}/${environment}/${stage}/${system}/${subsystem}/${type}`; },
                };
            } else {
                const [element] = element_hlasm.split('.');
                const fingerprint = query?.match(/^fingerprint=([a-zA-Z0-9]+)$/)?.[1];
                const q = fingerprint ? '?' + query : '';
                return {
                    profile,
                    use_map,
                    instance,
                    environment,
                    stage,
                    system,
                    subsystem,
                    type,
                    element,
                    fingerprint,
                    normalizedPath() { return `/${profile}/${use_map}/${instance}/${environment}/${stage}/${system}/${subsystem}/${type}/${element}.hlasm${q}`; },
                };

            }
        },
        createClient: () => {
            return {
                connect: (_: string) => Promise.resolve(),
                listMembers: (type_spec) => {
                    return Promise.resolve(['MACA', 'MACB', 'MACC'].map((x, i) => `${type_spec.normalizedPath()}/${x}.hlasm?fingerprint=${i.toString()}`));
                },
                readMember: (file_spec) => {
                    return `.*
        MACRO
        ${file_spec.element!}
 MNOTE 4,'${file_spec.normalizedPath()}'
 MNOTE 4,'${file_spec.fingerprint ?? ' '}'
        MEND
`;
                },

                dispose: () => { },

                reusable: () => true,
            };
        },
        invalidate: invalidationEventEmmiter.event,
    });
}

function findE4EAndRegister(ext: HlasmExtension) {
    return !!vscode.extensions.getExtension('broadcommfd.explorer-for-endevor')?.activate().then(e4e => performRegistration(ext, e4e));
}

export function handleE4EIntegration(ext: HlasmExtension) {
    if (findE4EAndRegister(ext)) return;
    const listener = vscode.extensions.onDidChange(() => {
        if (!findE4EAndRegister(ext)) return;
        listener.dispose();
    });
}

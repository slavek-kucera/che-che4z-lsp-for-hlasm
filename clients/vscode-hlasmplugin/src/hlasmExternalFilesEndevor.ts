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
import { ExternalRequestType, HlasmExtension, ExternalFilesInvalidationdata } from './extension.interface';

function performRegistration(ext: HlasmExtension, e4e: unknown) {
    const invalidationEventEmmiter = new vscode.EventEmitter<ExternalFilesInvalidationdata | undefined>();

    ext.registerExternalFileClient('ENDEVOR', {
        getConnInfo: () => Promise.resolve({ info: '', uniqueId: '' }),
        parseArgs(p: string, purpose: ExternalRequestType, query?: string) {
            const args = p.split('/').slice(1).map(decodeURIComponent);
            if (purpose === ExternalRequestType.list_directory && args.length === 7) {
                const [profile, use_map, environment, stage, system, subsystem, type] = args;
                return {
                    profile,
                    use_map,
                    environment,
                    stage,
                    system,
                    subsystem,
                    type,
                    normalizedPath() { return `/${encodeURIComponent(profile)}/${encodeURIComponent(use_map)}/${encodeURIComponent(environment)}/${encodeURIComponent(stage)}/${encodeURIComponent(system)}/${encodeURIComponent(subsystem)}/${encodeURIComponent(type)}`; },
                };
            }
            if (purpose === ExternalRequestType.list_directory && args.length === 2) {
                const [profile, dataset] = args;
                return {
                    profile,
                    dataset,
                    normalizedPath() { return `/${encodeURIComponent(profile)}/${encodeURIComponent(dataset)}`; },
                };
            }
            if (purpose === ExternalRequestType.read_file && args.length === 8) {
                const [profile, use_map, environment, stage, system, subsystem, type, element_hlasm] = args;

                const [element] = element_hlasm.split('.');
                const fingerprint = query?.match(/^fingerprint=([a-zA-Z0-9]+)$/)?.[1];
                const q = fingerprint ? '?' + query : '';
                return {
                    profile,
                    use_map,
                    environment,
                    stage,
                    system,
                    subsystem,
                    type,
                    element,
                    fingerprint,
                    normalizedPath() { return `/${encodeURIComponent(profile)}/${encodeURIComponent(use_map)}/${encodeURIComponent(environment)}/${encodeURIComponent(stage)}/${encodeURIComponent(system)}/${encodeURIComponent(subsystem)}/${encodeURIComponent(type)}/${encodeURIComponent(element)}.hlasm${encodeURIComponent(q)}`; },
                };
            }
            if (purpose === ExternalRequestType.read_file && args.length === 3) {
                const [profile, dataset, memeber_hlasm] = args;

                const [member] = memeber_hlasm.split('.');
                return {
                    profile,
                    dataset,
                    member,
                    normalizedPath() { return `/${encodeURIComponent(profile)}/${encodeURIComponent(dataset)}/${encodeURIComponent(member)}.hlasm`; },
                };
            }

            return null;
        },
        createClient: () => {
            return {
                connect: (_: string) => Promise.resolve(),
                listMembers: (type_spec) => {
                    if ('use_map' in type_spec)
                        return Promise.resolve(['MACA', 'MACB', 'MACC'].map((x, i) => `${type_spec.normalizedPath()}/${encodeURIComponent(x)}.hlasm?fingerprint=${i.toString()}`));
                    else
                        return Promise.resolve(['MACDA', 'MACDB', 'MACDC'].map((x) => `${type_spec.normalizedPath()}/${encodeURIComponent(x)}.hlasm`));
                },
                readMember: async (file_spec) => {
                    if ('use_map' in file_spec)
                        return `.*
        MACRO
        ${file_spec.element!}
 MNOTE 4,'${file_spec.normalizedPath()}'
 MNOTE 4,'${file_spec.fingerprint ?? ' '}'
        MEND
`;
                    else
                        return `.*
        MACRO
        ${file_spec.member!}
 MNOTE 4,'${file_spec.normalizedPath()}'
        MEND
`;
                },

                dispose: () => { },

                reusable: () => true,
            };
        },
        invalidate: invalidationEventEmmiter.event,
    });

    const cp = ext.registerExternalConfigurationProvider(async (uri: vscode.Uri) => {
        if (!uri.path.includes('/test.hlasm'))
            return null;
        else
            return {
                configuration: {
                    "name": "GRP1",
                    "libs": [
                        {
                            "dataset": "SYS1.MACLIB"
                        },
                        {
                            "dataset": "SYS1.MODGEN"
                        },
                        {
                            "environment": "DEV",
                            "stage": "1",
                            "system": "SYSTEM",
                            "subsystem": "SUBSYS",
                            "type": "ASMMAC"
                        },
                        {
                            "dataset": "AAAA.BBBB",
                            "profile": ""
                        }
                    ]
                }
            };
    });

    // e4e(cp);

    return { dispose: cp.dispose };
}

function findE4EAndRegister(ext: HlasmExtension, subscriptions: vscode.Disposable[]) {
    return !!vscode.extensions.getExtension('broadcommfd.explorer-for-endevor')?.activate()
        .then(e4e => subscriptions.push(performRegistration(ext, e4e)))
        .then(undefined, e => vscode.window.showErrorMessage("Explorer for Endevor integration failed", e));
}

export function handleE4EIntegration(ext: HlasmExtension, subscriptions: vscode.Disposable[]) {
    if (findE4EAndRegister(ext, subscriptions)) return;
    let listener: vscode.Disposable | null = vscode.extensions.onDidChange(() => {
        if (!findE4EAndRegister(ext, subscriptions)) return;
        listener?.dispose();
        listener = null;
    });
    subscriptions.push({ dispose: () => { listener?.dispose(); listener = null; } });
}

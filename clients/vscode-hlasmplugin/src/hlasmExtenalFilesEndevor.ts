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
    ext.registerExternalFileClient('ENDEVOR', {
        getConnInfo: () => Promise.resolve({ info: '', uniqueId: undefined }),
        parseArgs(p: string, purpose: ExternalRequestType) {
            const args = p.split('/').slice(1);
            if (args.length !== 7 + +(purpose === ExternalRequestType.read_file)) return null;


            if (purpose === ExternalRequestType.read_directory) {
                const [profile, use_map, environment, stage, system, subsystem, type] = args;
                return {
                    profile,
                    use_map,
                    environment,
                    stage,
                    system,
                    subsystem,
                    type,
                    normalizedPath() { return `/${profile}/${use_map}/${environment}/${stage}/${system}/${subsystem}/${type}`; },
                };
            } else {
                const [profile, use_map, environment, stage, system, subsystem, type, element_hlasm] = args;
                const [element] = element_hlasm.split('.');
                return {
                    profile,
                    use_map,
                    environment,
                    stage,
                    system,
                    subsystem,
                    type,
                    element,
                    normalizedPath() { return `/${profile}/${use_map}/${environment}/${stage}/${system}/${subsystem}/${type}/${element}`; },
                };

            }
        },
        createClient: () => {
            return {
                connect: (_: string) => Promise.resolve(),
                listMembers: (type_spec) => {
                    return Promise.resolve(['MACA', 'MACB', 'MACC']);
                },
                readMember: (file_spec) => {
                    return `.*
        MACRO
        ${file_spec.element!}
        MNOTE 4,'${file_spec.normalizedPath()}'
        MEND
`;
                },

                dispose: () => { },

                reusable: () => true,
            };
        },
    });
}

function findE4EAndRegister(ext: HlasmExtension) {
    const e4eExt = vscode.extensions.getExtension('broadcommfd.explorer-for-endevor');
    if (!e4eExt) return false;
    e4eExt.activate().then(e4e => performRegistration(ext, e4e));
    return true;
}

export function handleE4EIntegration(ext: HlasmExtension) {
    if (findE4EAndRegister(ext))
        return;
    const listener = vscode.extensions.onDidChange(() => {
        if (!findE4EAndRegister(ext))
            return;
        listener.dispose();
    });
}

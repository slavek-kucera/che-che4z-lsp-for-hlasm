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

interface EndevorType {
    use_map: string,
    environment: string,
    stage: string,
    system: string,
    subsystem: string,
    type: string,
    normalizedPath: () => string,
    toDisplayString: () => string,
    serverId?: () => string | undefined,
};
interface EndevorElement {
    use_map: string,
    environment: string,
    stage: string,
    system: string,
    subsystem: string,
    type: string,
    element: string,
    fingerprint: string,
    normalizedPath: () => string,
    toDisplayString: () => string,
    serverId?: () => string | undefined,
};
interface EndevorDataset {
    dataset: string,
    normalizedPath: () => string,
    toDisplayString: () => string,
    serverId?: () => string | undefined,
};

interface EndevorMember {
    dataset: string,
    member: string,
    normalizedPath: () => string,
    toDisplayString: () => string,
    serverId?: () => string | undefined,
};

type Filename = string;
type Fingerprint = string;
type Content = string;
interface E4E {
    listElements: (sourceUri: string, type: {
        use_map: boolean,
        environment: string,
        stage: string,
        system: string,
        subsystem: string,
        type: string
    }) => Promise<[Filename, Fingerprint][] | null>;
    getElement: (sourceUri: string, type: {
        use_map: boolean,
        environment: string,
        stage: string,
        system: string,
        subsystem: string,
        type: string,
        element: string,
        fingerprint: string
    }) => Promise<Content | null>;
    isEndevorElement: (uri: string) => boolean,
};
const nameof = <T>(name: keyof T) => name;

function validateE4E(e4e: any): e4e is E4E {
    const valid = e4e instanceof Object && nameof<E4E>('listElements') in e4e && nameof<E4E>('getElement') in e4e && nameof<E4E>('isEndevorElement') in e4e;
    if (!valid)
        vscode.window.showErrorMessage('Bad E4E interface!!!');
    return valid;
}

function performRegistration(ext: HlasmExtension, e4e: E4E) {
    const invalidationEventEmmiter = new vscode.EventEmitter<ExternalFilesInvalidationdata | undefined>();
    const defaultProfile = 'defaultEndevorProfile';
    const getProfile = (profile: string) => profile ? profile : defaultProfile;

    const translateError = (e: string | Readonly<{ messages: ReadonlyArray<string>; }>) => typeof e === 'string' ? Error(e) : Error(['Error occured during E4E request:', ...e.messages].join('\n'));

    const extFiles = ext.registerExternalFileClient<string, EndevorElement | EndevorMember, EndevorType | EndevorDataset>('ENDEVOR', {
        parseArgs: async (p: string, purpose: ExternalRequestType, query?: string) => {
            const args = p.split('/').slice(1).map(decodeURIComponent);
            if (purpose === ExternalRequestType.list_directory && args.length === 7) {
                const [profile, use_map, environment, stage, system, subsystem, type] = args;
                return {
                    details: {
                        use_map,
                        environment,
                        stage,
                        system,
                        subsystem,
                        type,
                        normalizedPath: () => `/${encodeURIComponent(use_map)}/${encodeURIComponent(environment)}/${encodeURIComponent(stage)}/${encodeURIComponent(system)}/${encodeURIComponent(subsystem)}/${encodeURIComponent(type)}`,
                        toDisplayString: () => `${use_map}/${environment}/${stage}/${system}/${subsystem}/${type}`,
                        // serverId: () => getProfile(profile),
                    },
                    server: getProfile(profile),
                };
            }
            if (purpose === ExternalRequestType.list_directory && args.length === 2) {
                const [profile, dataset] = args;
                return {
                    details: {
                        dataset,
                        normalizedPath: () => `/${encodeURIComponent(dataset)}`,
                        toDisplayString: () => `${dataset}`,
                        // serverId: () => getProfile(profile),
                    },
                    server: getProfile(profile),
                };
            }
            if (purpose === ExternalRequestType.read_file && args.length === 8) {
                const [profile, use_map, environment, stage, system, subsystem, type, element_hlasm] = args;

                const [element] = element_hlasm.split('.');
                if (element.length === 0) return null;
                const fingerprint = query?.match(/^([a-zA-Z0-9]+)$/)?.[1];
                const q = fingerprint ? '?' + query : '';
                return {
                    details: {
                        use_map,
                        environment,
                        stage,
                        system,
                        subsystem,
                        type,
                        element,
                        fingerprint,
                        normalizedPath: () => `/${encodeURIComponent(use_map)}/${encodeURIComponent(environment)}/${encodeURIComponent(stage)}/${encodeURIComponent(system)}/${encodeURIComponent(subsystem)}/${encodeURIComponent(type)}/${encodeURIComponent(element)}.hlasm${q}`,
                        toDisplayString: () => `${use_map}/${environment}/${stage}/${system}/${subsystem}/${type}/${element}`,
                        // serverId: () => getProfile(profile),
                    },
                    server: getProfile(profile),
                };
            }
            if (purpose === ExternalRequestType.read_file && args.length === 3) {
                const [profile, dataset, memeber_hlasm] = args;

                const [member] = memeber_hlasm.split('.');
                if (member.length === 0) return null;
                return {
                    details: {
                        dataset,
                        member,
                        normalizedPath: () => `/${encodeURIComponent(dataset)}/${encodeURIComponent(member)}.hlasm`,
                        toDisplayString: () => `${dataset}(${member})`,
                        // serverId: () => getProfile(profile),
                    },
                    server: getProfile(profile),
                };
            }

            return null;
        },

        listMembers: (type_spec, profile: string) => {
            if ('use_map' in type_spec) {
                return e4e.listElements(Buffer.from(profile, 'hex').toString(), {
                    use_map: type_spec.use_map === "map",
                    environment: type_spec.environment,
                    stage: type_spec.stage,
                    system: type_spec.system,
                    subsystem: type_spec.subsystem,
                    type: type_spec.type
                }).then(
                    r => r?.map(([file, fingerprint]) => `/${profile}${type_spec.normalizedPath()}/${encodeURIComponent(file)}.hlasm?${fingerprint.toString()}`) ?? null,
                    e => Promise.reject(translateError(e))
                );
            }
            else
                return Promise.resolve(['MACDA', 'MACDB', 'MACDC'].map((x) => `/${profile}${type_spec.normalizedPath()}/${encodeURIComponent(x)}.hlasm`));
        },

        readMember: async (file_spec, profile: string) => {
            if ('use_map' in file_spec)
                return e4e.getElement(Buffer.from(profile, 'hex').toString(), {
                    use_map: file_spec.use_map === "map",
                    environment: file_spec.environment,
                    stage: file_spec.stage,
                    system: file_spec.system,
                    subsystem: file_spec.subsystem,
                    type: file_spec.type,
                    element: file_spec.element,
                    fingerprint: file_spec.fingerprint,
                }).catch(e => Promise.reject(translateError(e)));
            else
                return `.*
        MACRO
.* ${profile}
        ${file_spec.member!}
 MNOTE 4,'${file_spec.normalizedPath()}'
        MEND
`;
        },

        invalidate: invalidationEventEmmiter.event,
    });

    const cp = ext.registerExternalConfigurationProvider(async (uri: vscode.Uri) => {
        if (!e4e.isEndevorElement(uri.toString()))
            return null;

        const {
            element: {
                environment,
                stageNumber,
                system,
                subSystem,
                type,
            },
            fingerprint,
        } = JSON.parse(decodeURIComponent(uri.query));
        return {
            configuration: {
                name: "GRP1",
                libs: [
                    {
                        environment,
                        stage: stageNumber,
                        system,
                        subsystem: subSystem,
                        type: type.replace(/PGM$/i, 'MAC'),
                        use_map: true,
                        profile: Buffer.from(uri.toString()).toString('hex'),
                    }
                ]
            }
        };
    });

    return { dispose: () => { extFiles.dispose(); cp.dispose(); } };
}

function findE4EAndRegister(ext: HlasmExtension, subscriptions: vscode.Disposable[]) {
    return !!vscode.extensions.getExtension('broadcommfd.explorer-for-endevor')?.activate()
        .then(e4e => validateE4E(e4e) && subscriptions.push(performRegistration(ext, e4e)))
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

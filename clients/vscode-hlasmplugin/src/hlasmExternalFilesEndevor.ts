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
import { AsmOptions, Preprocessor } from './hlasmExternalConfigurationProvider';

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

type TypeOrArray<T> = T | T[];
function asArray<T>(o: TypeOrArray<T>) {
    if (Array.isArray(o)) return o;
    return [o];
}

type E4EExternalConfigurationResponse = {
    pgms: ReadonlyArray<{
        program: string;
        pgroup: string;
        options?: {
            [key: string]: string;
        },
    }>;
    pgroups: ReadonlyArray<{
        name: string;
        libs: (
            {
                dataset: string;
                optional?: boolean;
                profile?: string;
            } | {
                environment: string;
                stage: string;
                system: string;
                subsystem: string;
                type: string;
                use_map?: boolean;
                optional?: boolean;
                profile?: string;
            })[];
        options?: {
            [key: string]: string;
        },
        preprocessor?: TypeOrArray<{
            name: string,
            options?: {
                [key: string]: string
            }
        }>;
    }>;
};

type Filename = string;
type Fingerprint = string;
type MemberName = string;
type Content = string;
type Instance = string;
type ElementInfo = {
    sourceUri?: string;
    environment: string;
    stage: string;
    system: string;
    subsystem: string;
    type: string;
    processorGroup?: string;
    fingerprint?: string;
    element: string;
};

interface E4E {
    listElements: (
        sourceUri: string,
        type: {
            use_map: boolean;
            environment: string;
            stage: string;
            system: string;
            subsystem: string;
            type: string;
        }
    ) => Promise<[Filename, Fingerprint][] | Error>;
    getElement: (
        sourceUri: string,
        type: {
            use_map: boolean;
            environment: string;
            stage: string;
            system: string;
            subsystem: string;
            type: string;
            element: string;
            fingerprint: string;
        }
    ) => Promise<[Content, Fingerprint] | Error>;
    listMembers: (
        sourceUri: string,
        type: {
            dataset: string;
        }
    ) => Promise<MemberName[] | Error>;
    getMember: (
        sourceUri: string,
        type: {
            dataset: string;
            member: string;
        }
    ) => Promise<Content | Error>;
    isEndevorElement: (uri: string) => boolean;
    getEndevorElementInfo: (
        uri: string
    ) => Promise<[ElementInfo, Instance] | Error>;
    getConfiguration: (
        sourceUri: string
    ) => Promise<E4EExternalConfigurationResponse | Error>;
    getElementInvalidateEmitter: () => vscode.EventEmitter<ElementInfo[]>;
}

const nameof = <T>(name: keyof T) => name;

function validateE4E(e4e: any): e4e is E4E {
    const valid = e4e instanceof Object &&
        nameof<E4E>('listElements') in e4e &&
        nameof<E4E>('getElement') in e4e &&
        nameof<E4E>('listMembers') in e4e &&
        nameof<E4E>('getMember') in e4e &&
        nameof<E4E>('isEndevorElement') in e4e &&
        nameof<E4E>('getEndevorElementInfo') in e4e &&
        nameof<E4E>('getConfiguration') in e4e &&
        nameof<E4E>('getElementInvalidateEmitter') in e4e;
    if (!valid)
        vscode.window.showErrorMessage('Bad E4E interface!!!');
    return valid;
}

function addStringOptions(o: any, kv: Map<string, [string, string]>, list: string[]) {
    let added = false;
    for (const k of list) {
        if (kv.has(k)) {
            o[k] = kv.get(k)?.[1];
            added = true;
        }
    }
    return added;
}
function addBooleanOptions(o: any, kv: Map<string, [string, string]>, list: string[]) {
    let added = false;
    for (const k of list) {
        if (kv.has(k)) {
            o[k] = true;
            added = true;
        }
        else if (kv.has('NO' + k)) {
            o[k] = false;
            added = true;
        }
    }
    return added;
}
function generateOptionMap(obj: { [key: string]: string }) {
    return new Map(Object.keys(obj).map(o => [o.toUpperCase(), [o, obj[o]] as [string, string]]));
}

function translateAsmOptions(opts?: { [key: string]: string }): AsmOptions | undefined {
    if (!opts) return undefined;

    let added = false;

    const kv = generateOptionMap(opts);

    const result: any = {};

    added ||= addStringOptions(result, kv, ['SYSPARM', 'PROFILE', 'SYSTEM_ID', 'MACHINE', 'OPTABLE']);
    added ||= addBooleanOptions(result, kv, ['GOFF', 'XOBJECT']);

    return added ? result : undefined;
}

const translatePreprocessor: { [key: string]: 'DB2' | 'ENDEVOR' | 'CICS' | undefined } = Object.freeze({
    'DSNHPC': 'DB2',
    'PBLHPC': 'DB2',
    'CONWRITE': 'ENDEVOR',
    'DFHEAP1$': 'CICS',
});

function translatePreprocessors(input: undefined | TypeOrArray<{
    name: string,
    options?: {
        [key: string]: string
    }
}>): Preprocessor[] | undefined {
    if (!input) return undefined;
    const prep = asArray(input);

    const result: Preprocessor[] = [];

    for (const p of prep) {
        const type = translatePreprocessor[p.name.toUpperCase()];
        if (!type) continue; // just skip?

        if (type === 'DB2') {
            const prep: Preprocessor = {
                name: 'DB2',
                options: {
                    conditional: true, // TODO: no detection available yet
                }
            };
            if (p.options)
                addStringOptions(prep.options, generateOptionMap(p.options), ['VERSION']);
            result.push(prep);
        }
        else if (type === 'CICS') {
            const prep: Preprocessor = {
                name: 'CICS',
                options: [],
            };
            if (p.options)
                addBooleanOptions(prep, generateOptionMap(p.options), ["PROLOG", "EPILOG", "LEASM"]);

            result.push(prep);
        }
        else if (type === 'ENDEVOR') {
            result.push({ name: 'ENDEVOR' });
        }
    }

    if (result.length === 0)
        return undefined;

    return result;
}

function performRegistration(ext: HlasmExtension, e4e: E4E) {
    const invalidationEventEmmiter = new vscode.EventEmitter<ExternalFilesInvalidationdata | undefined>();
    const getProfile = async (profile: string) => {
        if (!profile) return undefined;
        const p = await e4e.getEndevorElementInfo(profile);
        if (p instanceof Error) throw p;
        return p[1];
    }

    const invalidationHints = new Map<string, { serverId: string | undefined, paths: string[] }[]>();
    const addInvalidationHint = (server: string | undefined, path: string, type: string, element: string | undefined = undefined) => {
        const key = element ? `${type}/${element}` : type;
        let ar = invalidationHints.get(key);
        if (!ar) {
            ar = [];
            invalidationHints.set(key, ar);
        }
        for (const { serverId: s, paths: p } of ar) {
            if (s !== server) continue;
            if (p.indexOf(path) === -1)
                p.push(path);
            return;
        }
        ar.push({ serverId: server, paths: [path] });
    };

    const extFiles = ext.registerExternalFileClient<string, EndevorElement | EndevorMember, EndevorType | EndevorDataset>('ENDEVOR', {
        parseArgs: async (p: string, purpose: ExternalRequestType, query?: string) => {
            const args = p.split('/').slice(1).map(decodeURIComponent);
            if (purpose === ExternalRequestType.list_directory && args.length === 7) {
                const [profile_, use_map, environment, stage, system, subsystem, type] = args;
                const profile = await getProfile(profile_);
                const path = `/${encodeURIComponent(use_map)}/${encodeURIComponent(environment)}/${encodeURIComponent(stage)}/${encodeURIComponent(system)}/${encodeURIComponent(subsystem)}/${encodeURIComponent(type)}`;
                addInvalidationHint(profile, path, type);
                return {
                    details: {
                        use_map,
                        environment,
                        stage,
                        system,
                        subsystem,
                        type,
                        normalizedPath: () => path,
                        toDisplayString: () => `${use_map}/${environment}/${stage}/${system}/${subsystem}/${type}`,
                        serverId: () => profile,
                    },
                    server: profile ?? '',
                };
            }
            if (purpose === ExternalRequestType.list_directory && args.length === 2) {
                const [profile_, dataset] = args;
                const profile = await getProfile(profile_);
                return {
                    details: {
                        dataset,
                        normalizedPath: () => `/${encodeURIComponent(dataset)}`,
                        toDisplayString: () => `${dataset}`,
                        serverId: () => profile,
                    },
                    server: profile ?? '',
                };
            }
            if (purpose === ExternalRequestType.read_file && args.length === 8) {
                const [profile_, use_map, environment, stage, system, subsystem, type, element_hlasm] = args;
                const profile = await getProfile(profile_);

                const [element] = element_hlasm.split('.');
                if (element.length === 0) return null;
                const fingerprint = query?.match(/^([a-zA-Z0-9]+)$/)?.[1];
                const q = fingerprint ? '?' + query : '';
                const path = `/${encodeURIComponent(use_map)}/${encodeURIComponent(environment)}/${encodeURIComponent(stage)}/${encodeURIComponent(system)}/${encodeURIComponent(subsystem)}/${encodeURIComponent(type)}/${encodeURIComponent(element)}.hlasm${q}`;
                addInvalidationHint(profile, path, type, element);
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
                        normalizedPath: () => path,
                        toDisplayString: () => `${use_map}/${environment}/${stage}/${system}/${subsystem}/${type}/${element}`,
                        serverId: () => profile,
                    },
                    server: profile ?? '',
                };
            }
            if (purpose === ExternalRequestType.read_file && args.length === 3) {
                const [profile_, dataset, memeber_hlasm] = args;
                const profile = await getProfile(profile_);

                const [member] = memeber_hlasm.split('.');
                if (member.length === 0) return null;
                return {
                    details: {
                        dataset,
                        member,
                        normalizedPath: () => `/${encodeURIComponent(dataset)}/${encodeURIComponent(member)}.hlasm`,
                        toDisplayString: () => `${dataset}(${member})`,
                        serverId: () => profile,
                    },
                    server: profile ?? '',
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
                    r => r instanceof Error ? Promise.reject(r) : r?.map(([file, fingerprint]) => `/${profile}${type_spec.normalizedPath()}/${encodeURIComponent(file)}.hlasm ? ${fingerprint.toString()}`) ?? null
                );
            }
            else
                return e4e.listMembers(Buffer.from(profile, 'hex').toString(), {
                    dataset: type_spec.dataset
                }).then(
                    r => r instanceof Error ? Promise.reject(r) : r?.map((member) => `/${profile}${type_spec.normalizedPath()}/${encodeURIComponent(member)}.hlasm`) ?? null
                );
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
                }).then(r => r instanceof Error ? Promise.reject(r) : r[0]);
            else
                return e4e.getMember(Buffer.from(profile, 'hex').toString(), {
                    dataset: file_spec.dataset,
                    member: file_spec.member,
                }).then(r => r instanceof Error ? Promise.reject(r) : r);
        },

        invalidate: invalidationEventEmmiter.event,
    });

    const cp = ext.registerExternalConfigurationProvider(async (uri: vscode.Uri) => {
        const uriString = uri.toString();
        if (!e4e.isEndevorElement(uriString)) return null;
        const info = await e4e.getEndevorElementInfo(uriString);
        if (info instanceof Error) throw info;

        const result = await e4e.getConfiguration(uriString);
        if (result instanceof Error) throw result;
        const candidate = result.pgroups.find(x => x.name === result.pgms[0].pgroup);
        if (!candidate) throw Error('Invalid configuration');
        return {
            configuration: {
                name: candidate.name,
                libs: candidate.libs,
                asm_options: {
                    ...translateAsmOptions(candidate.options),
                    ...translateAsmOptions(result.pgms[0].options),
                },
                preprocessor: translatePreprocessors(candidate.preprocessor),
            }
        };
    });

    e4e.getElementInvalidateEmitter().event((elements) => {
        for (const e of elements) {
            if (e.sourceUri)
                cp.invalidate(vscode.Uri.parse(e.sourceUri));
            // This has issues, but for now it is good enough
            if (e.type)
                invalidationHints.get(e.type)?.forEach(e => invalidationEventEmmiter.fire(e));
            if (e.type && e.element)
                invalidationHints.get(`${e.type}/${e.element}`)?.forEach(e => invalidationEventEmmiter.fire(e));
        }
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

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
import { askUser, pickUser } from './uiUtils';

export enum connectionSecurityLevel {
    "rejectUnauthorized",
    "acceptUnauthorized",
    "unsecure",
}

export interface ConnectionInfo {
    host: string;
    port: number | undefined;
    user: string;
    password: string;
    hostInput: string;
    securityLevel: connectionSecurityLevel;

    zowe: boolean;
}

function gatherSecurityLevelFromZowe(profile: any) {
    if (profile.secureFtp !== false) {
        if (profile.rejectUnauthorized !== false)
            return connectionSecurityLevel.rejectUnauthorized;
        else
            return connectionSecurityLevel.acceptUnauthorized;
    }
    else
        return connectionSecurityLevel.unsecure;
}

async function gatherConnectionInfoFromZowe(zowe: vscode.Extension<any>, profileName: string): Promise<ConnectionInfo> {
    if (!zowe.isActive)
        await zowe.activate();
    if (!zowe.isActive)
        throw Error("Unable to activate ZOWE Explorer extension");
    const zoweExplorerApi = zowe?.exports;
    await zoweExplorerApi
        .getExplorerExtenderApi()
        .getProfilesCache()
        .refresh(zoweExplorerApi);
    const loadedProfile = zoweExplorerApi
        .getExplorerExtenderApi()
        .getProfilesCache()
        .loadNamedProfile(profileName);

    return {
        host: loadedProfile.profile.host,
        port: loadedProfile.profile.port,
        user: loadedProfile.profile.user,
        password: loadedProfile.profile.password,
        hostInput: '@' + profileName,
        securityLevel: gatherSecurityLevelFromZowe(loadedProfile.profile),
        zowe: true,
    };
}

export async function gatherConnectionInfo(lastInput: {
    host: string;
    user: string;
    jobcard: string;
}): Promise<ConnectionInfo> {
    const zowe = vscode.extensions.getExtension("Zowe.vscode-extension-for-zowe");

    const hostInput = await askUser(zowe ? "host[:port] or @zowe-profile-name" : "host[:port]", false, !zowe && lastInput.host.startsWith('@') ? '' : lastInput.host);
    const hostPort = hostInput.split(':');
    if (hostPort.length < 1 || hostPort.length > 2)
        throw Error("Invalid hostname or port");

    const host = hostPort[0];
    const port = hostPort.length > 1 ? +hostPort[1] : undefined;
    if (zowe && port === undefined && host.startsWith('@'))
        return gatherConnectionInfoFromZowe(zowe, host.slice(1));

    const user = await askUser("user name", false, lastInput.user);
    const password = await askUser("password", true);
    const securityLevel = await pickUser("Select security option", [
        { label: "Use TLS, reject unauthorized certificated", value: connectionSecurityLevel.rejectUnauthorized },
        { label: "Use TLS, accept unauthorized certificated", value: connectionSecurityLevel.acceptUnauthorized },
        { label: "Unsecured connection", value: connectionSecurityLevel.unsecure },
    ]);
    return { host, port, user, password, hostInput, securityLevel, zowe: false };
}

const mementoKey = "hlasm.downloadDependencies";

export function getLastRunConfig(context: vscode.ExtensionContext) {
    let lastRun = context.globalState.get(mementoKey, { host: '', user: '', jobcard: '' });
    return {
        host: '' + (lastRun.host || ''),
        user: '' + (lastRun.user || ''),
        jobcard: '' + (lastRun.jobcard || ''),
    };
}

export async function updateLastRunConfig(context: vscode.ExtensionContext, lastInput: {
    host: string;
    user: string;
    jobcard: string;
}) {
    await context.globalState.update(mementoKey, lastInput);
}

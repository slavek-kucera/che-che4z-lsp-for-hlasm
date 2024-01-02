/*
 * Copyright (c) 2019 Broadcom.
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
import * as vscodelc from 'vscode-languageclient';


import { HLASMConfigurationProvider, getCurrentProgramName, getProgramName } from './debugProvider';
import { insertContinuation, removeContinuation, rearrangeSequenceNumbers } from './continuationHandler';
import { CustomEditorCommands } from './customEditorCommands';
import { EventsHandler, getConfig } from './eventsHandler';
import { ServerVariant } from './serverFactory.common';
import { createLanguageServer } from './serverFactory';
import { HLASMDebugAdapterFactory } from './hlasmDebugAdapterFactory';
import { Telemetry, createTelemetry } from './telemetry';
import { LanguageClientErrorHandler } from './languageClientErrorHandler';
import { HLASMVirtualFileContentProvider } from './hlasmVirtualFileContentProvider';
import { downloadDependencies } from './hlasmDownloadCommands';
import { blockCommentCommand, CommentOption, lineCommentCommand } from './commentEditorCommands';
import { HLASMCodeActionsProvider } from './hlasmCodeActionsProvider';
import { hlasmplugin_folder, hlasmplugin_folder_filter, bridge_json_filter } from './constants';
import { ConfigurationsHandler } from './configurationsHandler';
import { getLanguageClientMiddleware } from './languageClientMiddleware';
import { HLASMExternalFiles } from './hlasmExternalFiles';
import { HLASMExternalFilesFtp } from './hlasmExternalFilesFtp';
import { HLASMExternalConfigurationProvider, HLASMExternalConfigurationProviderHandler } from './hlasmExternalConfigurationProvider';
import { HlasmExtension } from './extension.interface';
import { toggleAdvisoryConfigurationDiagnostics } from './hlasmConfigurationDiagnosticsProvider'
import { handleE4EIntegration } from './hlasmExternalFilesEndevor';
import { pickUser } from './uiUtils';
import { activateBranchDecorator } from './branchDecorator';
import { asError } from './helpers';

export const EXTENSION_ID = "broadcommfd.hlasm-language-support";

const continuationColumn = 71;
const initialBlanks = 15;
const externalFilesScheme = 'hlasm-external';

const sleep = (ms: number) => {
    return new Promise((resolve) => { setTimeout(resolve, ms) });
};

function objectToString(o: any) {
    if (o === null)
        return null;

    Object.keys(o).forEach(k => {
        o[k] = '' + o[k];
    });

    return o;
}

const getCacheInfo = async (uri: vscode.Uri, fs: vscode.FileSystem) => {
    try {
        await fs.createDirectory(uri);
        return { uri, fs };
    }
    catch (e) {
        vscode.window.showErrorMessage('Unable to create cache directory for external resources', ...(e instanceof Error ? [e.message] : []));
        return undefined;
    }
}

/**
 * ACTIVATION
 * activates the extension
 */
export async function activate(context: vscode.ExtensionContext): Promise<HlasmExtension> {
    const serverVariant = getConfig<ServerVariant>('serverVariant', 'native');

    const telemetry = createTelemetry();
    context.subscriptions.push(telemetry);

    telemetry.reportEvent("hlasm.activated", {
        server_variant: serverVariant.toString(),
        showBranchInformation: getConfig<boolean>('showBranchInformation', true).toString(),
    });

    await registerEditHelpers(context);

    // patterns for files and configs
    const filePattern: string = '**/*';

    const clientErrorHandler = new LanguageClientErrorHandler(telemetry);
    const middleware = getLanguageClientMiddleware();
    // create client options
    const syncFileEvents = getConfig<boolean>('syncFileEvents', true);
    const clientOptions: vscodelc.LanguageClientOptions = {
        documentSelector: [{ language: 'hlasm' }],
        synchronize: !syncFileEvents ? undefined : {
            fileEvents: [
                vscode.workspace.createFileSystemWatcher(filePattern),
                vscode.workspace.createFileSystemWatcher(hlasmplugin_folder + '/*.json'),
            ]
        },
        errorHandler: clientErrorHandler,
        middleware: middleware,
    };

    //client init
    const hlasmpluginClient = await createLanguageServer(serverVariant, clientOptions, context.extensionUri);

    context.subscriptions.push(hlasmpluginClient);
    context.subscriptions.push(hlasmpluginClient.onDidChangeState(e => e.newState === vscodelc.State.Starting && middleware.resetFirstOpen()));

    clientErrorHandler.defaultHandler = hlasmpluginClient.createDefaultErrorHandler();

    const extConfProvider = new HLASMExternalConfigurationProvider(hlasmpluginClient);
    context.subscriptions.push(extConfProvider);

    // The objectToString is necessary, because telemetry reporter only takes objects with
    // string properties and there are some boolean that we receive from the language server
    hlasmpluginClient.onTelemetry((object) => { telemetry.reportEvent(object.method_name, objectToString(object.properties), object.measurements) });

    const extFiles = new HLASMExternalFiles(
        externalFilesScheme,
        hlasmpluginClient,
        vscode.workspace.fs,
        await getCacheInfo(vscode.Uri.joinPath(context.globalStorageUri, 'external.files.cache'), vscode.workspace.fs)
    );
    context.subscriptions.push(extFiles);

    //give the server some time to start listening when using TCP
    if (serverVariant === 'tcp')
        await sleep(2000);

    try {
        await hlasmpluginClient.start();
    }
    catch (e) {
        if (serverVariant === 'native')
            offerSwitchToWasmClient();

        telemetry.reportException(asError(e));
        throw e;
    }

    // register all commands and objects to context
    await registerDebugSupport(context, hlasmpluginClient);
    await registerExternalFileSupport(context, hlasmpluginClient, extFiles);
    await registerToContextWithClient(context, hlasmpluginClient, telemetry);

    let api: HlasmExtension = {
        registerExternalFileClient(service, client) {
            return extFiles.setClient(service, client);
        },
        registerExternalConfigurationProvider(h: HLASMExternalConfigurationProviderHandler) {
            return extConfProvider.addHandler(h);
        },
    };

    handleE4EIntegration(api, context.subscriptions, hlasmpluginClient.outputChannel);

    return api;
}

function offerSwitchToWasmClient() {
    const use_wasm = 'Switch to WASM version';
    vscode.window.showWarningMessage('The language server did not start.', ...[use_wasm, 'Ignore']).then((value) => {
        if (value === use_wasm) {
            vscode.workspace.getConfiguration('hlasm').update('serverVariant', 'wasm', vscode.ConfigurationTarget.Global).then(
                () => {
                    const reload = 'Reload window';
                    vscode.window.showInformationMessage('User settings updated.', ...[reload]).then((value) => {
                        if (value === reload)
                            vscode.commands.executeCommand('workbench.action.reloadWindow');
                    })
                },
                (error) => {
                    vscode.window.showErrorMessage(error);
                });
        }
    });
}

async function registerEditHelpers(context: vscode.ExtensionContext) {
    const completeCommand = "editor.action.triggerSuggest";

    // initialize helpers
    const handler = new EventsHandler(completeCommand);
    const commands = new CustomEditorCommands();

    // register them
    context.subscriptions.push(commands);
    context.subscriptions.push(handler);

    // overrides should happen only if the user wishes
    if (getConfig<boolean>('continuationHandling', false)) {
        try {
            context.subscriptions.push(vscode.commands.registerTextEditorCommand("type",
                (editor, edit, args) => commands.insertChars(editor, edit, args, continuationColumn)));
            context.subscriptions.push(vscode.commands.registerTextEditorCommand("paste",
                (editor, edit, args) => commands.insertChars(editor, edit, args, continuationColumn)));
            context.subscriptions.push(vscode.commands.registerTextEditorCommand("cut",
                (editor, edit) => commands.cut(editor, edit, continuationColumn)));
            context.subscriptions.push(vscode.commands.registerTextEditorCommand("deleteLeft",
                (editor, edit) => commands.deleteLeft(editor, edit, continuationColumn)));
            context.subscriptions.push(vscode.commands.registerTextEditorCommand("deleteRight",
                (editor, edit) => commands.deleteRight(editor, edit, continuationColumn)));
        } catch (e) { /* just ignore */ }
    }
    // register event handlers
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => handler.onDidChangeTextDocument(e, continuationColumn)));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(e => handler.onDidOpenTextDocument(e)));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => handler.onDidChangeConfiguration(e)));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(e => handler.onDidSaveTextDocument(e)));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => handler.onDidChangeActiveTextEditor(e)));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(e => handler.onDidChangeWorkspaceFolders(e)));

    context.subscriptions.push(vscode.commands.registerCommand('extension.hlasm-plugin.createCompleteConfig', ConfigurationsHandler.createCompleteConfig));

    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'hlasm' }, { provideCodeLenses: ConfigurationsHandler.provideCodeLenses }));

    // register continuation handlers
    if (!((await vscode.commands.getCommands()).find(command => command == "extension.hlasm-plugin.insertContinuation" || command == "extension.hlasm-plugin.removeContinuation"))) {
        context.subscriptions.push(vscode.commands.registerTextEditorCommand("extension.hlasm-plugin.insertContinuation",
            (editor, edit) => insertContinuation(editor, edit, continuationColumn, initialBlanks)));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand("extension.hlasm-plugin.removeContinuation",
            (editor, edit) => removeContinuation(editor, edit, continuationColumn)));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand("extension.hlasm-plugin.rearrangeSequenceNumbers",
            (editor, edit) => rearrangeSequenceNumbers(editor, edit, continuationColumn)));

        context.subscriptions.push(vscode.commands.registerTextEditorCommand("extension.hlasm-plugin.toggleCommentEditorCommands",
            (editor, edit) => lineCommentCommand(editor, edit, CommentOption.toggle)));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand("extension.hlasm-plugin.addCommentEditorCommands",
            (editor, edit) => lineCommentCommand(editor, edit, CommentOption.add)));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand("extension.hlasm-plugin.removeCommentEditorCommands",
            (editor, edit) => lineCommentCommand(editor, edit, CommentOption.remove)));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand("extension.hlasm-plugin.blockCommentEditorCommands",
            (editor, edit) => blockCommentCommand(editor, edit)));
    }
}
async function registerDebugSupport(context: vscode.ExtensionContext, client: vscodelc.BaseLanguageClient) {
    // register filename retrieve functions for debug sessions
    context.subscriptions.push(vscode.commands.registerCommand('extension.hlasm-plugin.getProgramName', () => getProgramName()));
    context.subscriptions.push(vscode.commands.registerCommand('extension.hlasm-plugin.getCurrentProgramName', () => getCurrentProgramName()));

    // register provider for all hlasm debug configurations
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('hlasm', new HLASMConfigurationProvider()));
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('hlasm', new HLASMDebugAdapterFactory(client)));
}

async function registerExternalFileSupport(context: vscode.ExtensionContext, client: vscodelc.BaseLanguageClient, extFiles: HLASMExternalFiles) {
    context.subscriptions.push(client.onDidChangeState(e => e.newState === vscodelc.State.Starting && extFiles.reset()));
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(externalFilesScheme, extFiles.getTextDocumentContentProvider()));
    const datasetClient = HLASMExternalFilesFtp(context);
    if (datasetClient)
        extFiles.setClient('DATASET', datasetClient);

    context.subscriptions.push(vscode.commands.registerCommand('extension.hlasm-plugin.resumeRemoteActivity', () => extFiles.resumeAll()));
    context.subscriptions.push(vscode.commands.registerCommand('extension.hlasm-plugin.suspendRemoteActivity', () => extFiles.suspendAll()));
    context.subscriptions.push(vscode.commands.registerCommand('extension.hlasm-plugin.clearRemoteActivityCache', () => extFiles.clearCache()));
    context.subscriptions.push(vscode.commands.registerCommand('extension.hlasm-plugin.clearRemoteActivityCacheForService', () =>
        pickUser('Select service', extFiles.currentlyAvailableServices().map(x => { return { label: x, value: x }; })).then(x => extFiles.clearCache(x), () => { })
    ));
}

async function registerToContextWithClient(context: vscode.ExtensionContext, client: vscodelc.BaseLanguageClient, telemetry: Telemetry) {
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(['hlasm', hlasmplugin_folder_filter, bridge_json_filter], new HLASMCodeActionsProvider(client)));

    context.subscriptions.push(vscode.commands.registerCommand('extension.hlasm-plugin.toggleAdvisoryConfigurationDiagnostics', () => toggleAdvisoryConfigurationDiagnostics(client)));

    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("hlasm", new HLASMVirtualFileContentProvider(client)));

    context.subscriptions.push(vscode.commands.registerCommand("extension.hlasm-plugin.downloadDependencies", (...args: any[]) => downloadDependencies(context, telemetry, client.outputChannel, ...args)));

    activateBranchDecorator(context, client);
}

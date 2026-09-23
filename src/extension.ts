// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ConfigurationService } from './treecipe/src/ConfigurationService/ConfigurationService';
import { ExtensionCommandService } from './treecipe/src/ExtensionCommandService/ExtensionCommandService';
import { VSCodeWorkspaceService } from './treecipe/src/VSCodeWorkspace/VSCodeWorkspaceService';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	/*
		The "useSnowfakeryAsDefault" value is used until an implementation is built fully for faker-js.

		It is written at workspace scope, so a window with no folder open has nowhere to put it --
		VS Code rejects that write, and attempting it on every activation is how a user who opened a
		single file got a warning about a setting they never chose. Nothing reads this value in that
		state either, because every command it feeds needs a workspace of its own.
	*/
	if ( vscode.workspace.workspaceFolders?.length ) {
		void ConfigurationService.setExtensionConfigValue('useSnowfakeryAsDefault', false);
	}

	// LETS LAZILY CREATED OUTPUT CHANNELS BE DISPOSED BY VS CODE WITHOUT CREATING THEM AT ACTIVATION
	VSCodeWorkspaceService.registerExtensionSubscriptions(context.subscriptions);

	const initiateConfiguration = vscode.commands.registerCommand('treecipe.initiateConfiguration', () => {
		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.initiateTreecipeConfigurationSetup();
		
	});

	const generateTreecipe = vscode.commands.registerCommand('treecipe.generateTreecipe', () => {
		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.generateRecipeFromConfigurationDetail();

	});

	const runFakerByRecipe = vscode.commands.registerCommand('treecipe.runFakerByRecipe', () => {

		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.runFakerGenerationByRecipeFile();

	});

	const insertDataSetBySelectedDirectory = vscode.commands.registerCommand('treecipe.insertDataSetBySelectedDirectory', () => {

		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.insertDataSetBySelectedDirectory();

	});


	const changeFakerImplementationService = vscode.commands.registerCommand("treecipe.changeFakerImplementationService", () => {
		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.changeFakerImplementationService();

	});

	const generatePicklistDependencyTests = vscode.commands.registerCommand("treecipe.generatePicklistDependencyTests", () => {

		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.generatePicklistDependencyTests(context.extensionPath);

	});

	const runPicklistDependencyCheck = vscode.commands.registerCommand("treecipe.runPicklistDependencyCheck", () => {

		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.runPicklistDependencyCheck();

	});

	const openPicklistDependencyExplorer = vscode.commands.registerCommand("treecipe.openPicklistDependencyExplorer", () => {

		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.openPicklistDependencyExplorer();

	});

	const openRecipeCockpit = vscode.commands.registerCommand("treecipe.openRecipeCockpit", () => {

		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.openRecipeCockpit();

	});

	const updatePicklistDependencyMetadata = vscode.commands.registerCommand("treecipe.updatePicklistDependencyMetadata", () => {

		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.updatePicklistDependencyMetadata();

	});

	context.subscriptions.push(
		generateTreecipe,
		initiateConfiguration,
		runFakerByRecipe,
		insertDataSetBySelectedDirectory,
		changeFakerImplementationService,
		generatePicklistDependencyTests,
		runPicklistDependencyCheck,
		openPicklistDependencyExplorer,
		updatePicklistDependencyMetadata,
		openRecipeCockpit
	);
	
}

// This method is called when your extension is deactivated
export function deactivate() {}

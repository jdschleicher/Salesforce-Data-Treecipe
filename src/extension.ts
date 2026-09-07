// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ConfigurationService } from './treecipe/src/ConfigurationService/ConfigurationService';
import { ExtensionCommandService } from './treecipe/src/ExtensionCommandService/ExtensionCommandService';
import { VSCodeWorkspaceService } from './treecipe/src/VSCodeWorkspace/VSCodeWorkspaceService';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// below set config value of "useSnowfakeryAsDefault" will be used until an implementation is built fully for faker-js
	ConfigurationService.setExtensionConfigValue('useSnowfakeryAsDefault', false);

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

	/*
		Reached from a right click on a field metadata file rather than from the palette, so it takes
		the uri VS Code hands a menu command. The palette entry is gated on the same file type, and
		falls back to the active editor when it is invoked without one.
	*/
	const showFieldInPicklistDependencyExplorer = vscode.commands.registerCommand("treecipe.showFieldInPicklistDependencyExplorer", (fieldMetadataUri?: vscode.Uri) => {

		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.showFieldInPicklistDependencyExplorer(fieldMetadataUri);

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
		showFieldInPicklistDependencyExplorer,
		updatePicklistDependencyMetadata
	);
	
}

// This method is called when your extension is deactivated
export function deactivate() {}

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ConfigurationService } from './treecipe/src/ConfigurationService/ConfigurationService';
import { ExtensionCommandService } from './treecipe/src/ExtensionCommandService/ExtensionCommandService';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// below set config value of "useSnowfakeryAsDefault" will be used until an implementation is built fully for faker-js
	ConfigurationService.setExtensionConfigValue('useSnowfakeryAsDefault', false);

	const initiateConfiguration = vscode.commands.registerCommand('treecipe.initiateConfiguration', async () => {
		const extensionCommandService = new ExtensionCommandService();
		await extensionCommandService.initiateTreecipeConfigurationSetup();
		
	});

	const generateTreecipe = vscode.commands.registerCommand('treecipe.generateTreecipe', async () => {
		const extensionCommandService = new ExtensionCommandService();
		await extensionCommandService.generateRecipeFromConfigurationDetail();

	});

	const runFakerByRecipe = vscode.commands.registerCommand('treecipe.runFakerByRecipe', async () => {

		const extensionCommandService = new ExtensionCommandService();
		await extensionCommandService.runFakerGenerationByRecipeFile();

	});

	const insertDataSetBySelectedDirectory = vscode.commands.registerCommand('treecipe.insertDataSetBySelectedDirectory', async () => {

		const extensionCommandService = new ExtensionCommandService();
		await extensionCommandService.insertDataSetBySelectedDirectory();

	});


	const changeFakerImplementationService = vscode.commands.registerCommand("treecipe.changeFakerImplementationService", async() => {
		const extensionCommandService = new ExtensionCommandService();
		await extensionCommandService.changeFakerImplementationService();

	});

	context.subscriptions.push(
		generateTreecipe,
		initiateConfiguration,
		runFakerByRecipe,
		insertDataSetBySelectedDirectory,
		changeFakerImplementationService
	);
	
}

// This method is called when your extension is deactivated
export function deactivate() {}

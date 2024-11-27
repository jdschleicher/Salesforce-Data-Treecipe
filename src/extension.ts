// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ConfigurationService } from './treecipe/src/ConfigurationService/ConfigurationService';
import { IFakerService } from './treecipe/src/FakerService/IFakerService';
import { ExtensionCommandService } from './treecipe/src/ExtensionCommandService/ExtensionCommandService';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	const initiateConfiguration = vscode.commands.registerCommand('treecipe.initiateConfiguration', () => {
		ConfigurationService.createConfigurationFile();
	});


	const generateTreecipe = vscode.commands.registerCommand('treecipe.generateTreecipe', () => {
		
		const extensionCommandService = new ExtensionCommandService();
		extensionCommandService.generateRecipeFromConfigurationDetail();

	});

	context.subscriptions.push(
		generateTreecipe,
		initiateConfiguration
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}

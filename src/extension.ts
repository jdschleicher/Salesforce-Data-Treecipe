// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { main } from './treecipe/src/presentation';
import { ConfigurationService } from './treecipe/src/ConfigurationService/ConfigurationService';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "hrg" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('hrg.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from helloRecipeGenerator!');
	});

	const initiateConfiguration = vscode.commands.registerCommand('hrg.initiateConfiguration', () => {
		ConfigurationService.createConfigurationFile();
	});

	const generateTreecipe = vscode.commands.registerCommand('hrg.generateTreecipe', () => {
		
		main();
		
	});

	context.subscriptions.push(
		disposable, 
		generateTreecipe,
		initiateConfiguration
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}

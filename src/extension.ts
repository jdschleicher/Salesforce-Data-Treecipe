// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ConfigurationService } from './treecipe/src/ConfigurationService/ConfigurationService';
import { RecipeService } from './treecipe/src/RecipeService/RecipeService';
import { IFakerService } from './treecipe/src/FakerService/IFakerService';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	const initiateConfiguration = vscode.commands.registerCommand('treecipe.initiateConfiguration', () => {
		ConfigurationService.createConfigurationFile();
	});


	const generateTreecipe = vscode.commands.registerCommand('treecipe.generateTreecipe', () => {
		
		const configurationDetail = ConfigurationService.getConfigurationDetail();
		let fakerServiceImplementation:IFakerService = ConfigurationService.getFakerImplementationByConfigurationSelelction(configurationDetail.dataFakerService);
		let recipeService = new RecipeService(fakerServiceImplementation);
		recipeService.generateRecipeFromConfigurationDetail();
		
	});

	context.subscriptions.push(
		generateTreecipe,
		initiateConfiguration
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}

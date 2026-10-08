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

	// RETURNED SO executeCommand SETTLES WHEN GENERATION DOES -- THE RECIPE COCKPIT RELOADS THE RUN IT WROTE
	const generateTreecipe = vscode.commands.registerCommand('treecipe.generateTreecipe', (generateTreecipeOptions?: unknown) => {
		const extensionCommandService = new ExtensionCommandService();
		return extensionCommandService.generateRecipeFromConfigurationDetail(generateTreecipeOptions);

	});

	/*
		The Recipe Cockpit's Run Faker passes the recipe file of its tree; the palette passes nothing
		and gets the recipe picker. Returned so executeCommand settles when the data set is written,
		which is when the cockpit reloads the tree's history.
	*/
	const runFakerByRecipe = vscode.commands.registerCommand('treecipe.runFakerByRecipe', (recipeFilePath?: unknown) => {

		const extensionCommandService = new ExtensionCommandService();
		return extensionCommandService.runFakerGenerationByRecipeFile(
			typeof recipeFilePath === 'string' ? recipeFilePath : undefined
		);

	});

	/*
		The Recipe Cockpit's Insert… passes the data set folder to pre-select; the palette passes nothing
		and gets the folder picker. Returned so executeCommand settles when the insert does.
	*/
	const insertDataSetBySelectedDirectory = vscode.commands.registerCommand('treecipe.insertDataSetBySelectedDirectory', (preselectedDataSetDirectoryPath?: unknown) => {

		const extensionCommandService = new ExtensionCommandService();
		return extensionCommandService.insertDataSetBySelectedDirectory(
			typeof preselectedDataSetDirectoryPath === 'string' ? preselectedDataSetDirectoryPath : undefined
		);

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
		// WHERE DATA-BY-ORG REMEMBERS THE ORG IT LAST COUNTED IN, PER WORKSPACE
		extensionCommandService.openRecipeCockpit(context.workspaceState);

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

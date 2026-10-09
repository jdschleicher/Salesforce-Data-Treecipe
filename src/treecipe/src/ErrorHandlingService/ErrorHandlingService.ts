import * as vscode from 'vscode';
import * as fs from 'fs';
import { ConfigurationService, MissingTreecipeConfigurationError } from '../ConfigurationService/ConfigurationService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';

export class ErrorHandlingService {

    static reportIssueButton = 'Report Issue to GitHub with Stack Trace';
    static expectedMissingConfigError = 'Missing treecipe configuration setup at expected path of:';

    static handleCapturedError(error:Error, executedCommand:string) {
        
        // A THROWN STRING, null OR undefined HAS NO MESSAGE, AND READING ONE MUST NOT THROW FROM INSIDE THE ERROR HANDLER
        if ( typeof error?.message === 'string' && error.message.startsWith(this.expectedMissingConfigError)) {
            this.handleMissingTreecipeConfigSetup(error, executedCommand);
        } else {
            
            this.handleGenericError(error, executedCommand);
        }
        
    }
    
    /*
        Every handleCapturedError caller lands here, and an error message can quote workspace text --
        a js-yaml parse error quotes the recipe line it failed on. VS Code renders "[label](command:...)"
        in a notification as a link that RUNS the command, so the message is escaped here, once, for
        every caller. The Report Issue url keeps the raw text: it is url-encoded into an issue body and
        never rendered as a notification.
    */
    static handleGenericError(error: Error, executedCommand: string) {

        const errorMessage = error instanceof Error ? executedCommand + ': ' + error.message : `Unknown error during command: ${ executedCommand }`;
        const notificationErrorMessage = error instanceof Error ? executedCommand + ': ' + RecipeYamlScalar.escapeForNotification(error.message) : errorMessage;
        const stackTrace = error instanceof Error ? error.stack : 'No stack trace available';
        const goToTroubleshootingREADMESection = "Review Troubleshooting From README";

        vscode.window.showErrorMessage(

            `Error occurred during:  ${executedCommand} *** ${notificationErrorMessage} *** Please select an option below:
            `, 
            this.reportIssueButton,
            goToTroubleshootingREADMESection

        ).then(selection => {

            if (selection === this.reportIssueButton) {

                const githubIssueBuiltTemplateUrl = this.buildGitHubIssueTemplateUrl(errorMessage, stackTrace);
                vscode.env.openExternal(vscode.Uri.parse(githubIssueBuiltTemplateUrl));

            } else if ( selection === goToTroubleshootingREADMESection ) {

                const directLinkToTroubleshootingSectionInREADME = "https://github.com/jdschleicher/Salesforce-Data-Treecipe?tab=readme-ov-file#troubleshooting";
                vscode.env.openExternal(vscode.Uri.parse(directLinkToTroubleshootingSectionInREADME));

            }

        });    
    
    }

    static buildGitHubIssueTemplateUrl(errorMessage: string, stackTrace: string):string {
        
        const issueBody = `


- [Steps to Reproduce](#steps-to-reproduce)
- [Additional Context](#additional-context)
- [Error Details](#error-details)
- [Stack Trace](#stack-trace)

 Steps to Reproduce:
 ===

1. 
2. 
3. 

 Additional Context:
 ===

- VS Code Version: 
- Extension Version: 
- Operating System: 

 Error Details: 
 ===

\`\`\`

${errorMessage}

\`\`\`

 Stack Trace:
 ===

\`\`\`

${stackTrace}

\`\`\`

`;

        const urlSearchParams = new URLSearchParams(
            {
                title: `BUG: Extension Commamd - ${errorMessage}`,
                body: issueBody
            }
        );         

        const githubIssueBaseUrl = 'https://github.com/jdschleicher/salesforce-data-treecipe/issues/new';
        const githubIssueUrl = `${githubIssueBaseUrl}?` + urlSearchParams.toString();

        return githubIssueUrl;

    }

    static handleMissingTreecipeConfigSetup(error, executedCommand) {

        const runInitiateTreecipeConfiguration = "Run Treecipe Initiation Setup";
        const missingConfigurationMessage = "Expected treecipe and config file missing";
        // ConfigurationService ALREADY ESCAPED THE NOTICE; escapeForNotification IS IDEMPOTENT ON ITS OWN OUTPUT, SO A SECOND PASS ONLY GUARDS A NOTICE BUILT ANOTHER WAY
        const staleSettingNotice = error instanceof MissingTreecipeConfigurationError && error.staleSettingNotice
            ? RecipeYamlScalar.escapeForNotification(error.staleSettingNotice)
            : undefined;
        vscode.window.showErrorMessage(
            staleSettingNotice ? `${missingConfigurationMessage}. ${staleSettingNotice}` : missingConfigurationMessage,
            runInitiateTreecipeConfiguration,
            this.reportIssueButton

        ).then(selection => {

            if (selection === this.reportIssueButton) {

                const errorMessage = error instanceof Error ? executedCommand + ':' + error.message : `Unknown error during command: ${ executedCommand }`;
                const stackTrace = error instanceof Error ? error.stack : 'No stack trace available';
                const githubIssueBuiltTemplateUrl = this.buildGitHubIssueTemplateUrl(errorMessage, stackTrace);
                vscode.env.openExternal(vscode.Uri.parse(githubIssueBuiltTemplateUrl));

            } else if ( selection === runInitiateTreecipeConfiguration ) {

                vscode.commands.executeCommand('treecipe.initiateConfiguration');

            }

        });
    }

    /**
     * Resolves the folder an error capture file belongs in, or undefined when there is no workspace.
     *
     * getWorkspaceRoot is declared to return a string but returns undefined when no workspace folder
     * is open, and interpolating that yields the literal string "undefined" -- silently creating an
     * "undefined/treecipe/..." tree wherever the process happened to be running. That artefact
     * reached this repository once already. Skipping the capture is better than writing it somewhere
     * nobody will look for it.
     */
    static resolveErrorCaptureFolderPath(errorsGenerationFolderName: string): string | undefined {

        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
        if (!workspaceRoot) {
            return undefined;
        }

        const generatedRecipesFolderName = ConfigurationService.getGeneratedRecipesDefaultFolderName();
        return `${workspaceRoot}/treecipe/${generatedRecipesFolderName}/${errorsGenerationFolderName}`;
    }

    static createGenerateRecipeErrorCaptureFile(customGenerateRecipeError: Error, executedCommand: string) {
        
        const expectedErrorsFolderPath = this.resolveErrorCaptureFolderPath(this.getRecipeGenerationErrorsFolderName());
        if (!expectedErrorsFolderPath) {
            VSCodeWorkspaceService.showWarningMessage('No workspace folder found, so the recipe generation error could not be captured to a file.');
            return;
        }

        if (!fs.existsSync(expectedErrorsFolderPath)) {
            fs.mkdirSync(expectedErrorsFolderPath, { recursive: true });
        }
        
        const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();
        
        let recipeErrorGenerationFileName = 'generateRecipeError_' + isoDateTimestamp + '.json';

        const outputFilePath = `${expectedErrorsFolderPath}/${recipeErrorGenerationFileName}`;
        
        const jsonErrorDetail = JSON.stringify(customGenerateRecipeError, null, 2);
        
        fs.writeFile(outputFilePath, jsonErrorDetail, (error) => {
            if (error) {
                throw new Error(`an error occurred when creating file to capture xml parsing error for ${customGenerateRecipeError.message}.`);
            } 
        });

        VSCodeWorkspaceService.showWarningMessage('XMLFileProcessor error captured in file: ' + recipeErrorGenerationFileName, );
        VSCodeWorkspaceService.openFileInEditor(outputFilePath);
    
    }

    static createGetRecipeFakerErrorCaptureFile(customGenerateFakerJSValueError: Error, executedCommand: string) {
    
        const expectedErrorsFolderPath = this.resolveErrorCaptureFolderPath(this.getRecipeGenerationErrorsFolderName());
        if (!expectedErrorsFolderPath) {
            VSCodeWorkspaceService.showWarningMessage('No workspace folder found, so the faker value error could not be captured to a file.');
            return;
        }

        if (!fs.existsSync(expectedErrorsFolderPath)) {
            fs.mkdirSync(expectedErrorsFolderPath, { recursive: true });
        }
    
        const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();
        
        let recipeErrorGenerationFileName = 'getFakerJSValueError' + isoDateTimestamp + '.json';

        const outputFilePath = `${expectedErrorsFolderPath}/${recipeErrorGenerationFileName}`;
        
        const jsonErrorDetail = JSON.stringify(customGenerateFakerJSValueError, null, 2);
        
        fs.writeFile(outputFilePath, jsonErrorDetail, (error) => {
            if (error) {
                throw new Error(`an error occurred when creating file to capture xml parsing error for ${customGenerateFakerJSValueError.message}.`);
            } 
        });

        VSCodeWorkspaceService.showWarningMessage('XMLFileProcessor error captured in file: ' + recipeErrorGenerationFileName, );
        VSCodeWorkspaceService.openFileInEditor(outputFilePath);

    }

    static getRecipeGenerationErrorsFolderName() {
        return 'RecipeGenerationErrors';
    }

    static createFakerExpressionEvaluationErrorCaptureFile(customFakerExpressionEvaluationValueError: Error, executedCommand: string) {
    
        const expectedErrorsFolderPath = this.resolveErrorCaptureFolderPath(this.getFakerJSExpressionErrorsFolderName());
        if (!expectedErrorsFolderPath) {
            VSCodeWorkspaceService.showWarningMessage('No workspace folder found, so the faker-js expression error could not be captured to a file.');
            return;
        }

        if (!fs.existsSync(expectedErrorsFolderPath)) {
            fs.mkdirSync(expectedErrorsFolderPath, { recursive: true });
        }
    
        const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();
        
        let recipeErrorGenerationFileName = 'fakerJSExpressionError' + isoDateTimestamp + '.json';

        const outputFilePath = `${expectedErrorsFolderPath}/${recipeErrorGenerationFileName}`;
        
        const jsonErrorDetail = JSON.stringify(customFakerExpressionEvaluationValueError, null, 2);
        
        fs.writeFile(outputFilePath, jsonErrorDetail, (error) => {
            if (error) {
                throw new Error(`an error occurred when creating file to capture faker-js evaluation for ${customFakerExpressionEvaluationValueError.message}.`);
            } 
        });

        VSCodeWorkspaceService.showWarningMessage('faker-js expression error captured in: ' + executedCommand );
        VSCodeWorkspaceService.openFileInEditor(outputFilePath);

    }

    static getFakerJSExpressionErrorsFolderName() {
        return 'FakerJSExpressionErrors';
    }

}
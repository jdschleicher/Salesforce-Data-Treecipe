import * as vscode from 'vscode';

export class ErrorHandlingService {

    static reportIssueButton = 'Report Issue to GitHub with Stack Trace';
    static expectedMissingConfigError = 'Missing treecipe configuration setup at expected path of:';

    static handleCapturedError(error:Error, executedCommand:string) {
        
        if ( error.message.startsWith(this.expectedMissingConfigError)) {
            this.handleMissingTreecipeConfigSetup(error, executedCommand);
        } else {
            
            this.handleGenericError(error, executedCommand);
        }
        
    }
    
    static handleGenericError(error: Error, executedCommand: string) {

        const errorMessage = error instanceof Error ? executedCommand + ': ' + error.message : `Unknown error during command: ${ executedCommand }`;
        const stackTrace = error instanceof Error ? error.stack : 'No stack trace available';
        const goToTroubleshootingREADMESection = "Review Troubleshooting From README";

        vscode.window.showErrorMessage(

            `Error occurred during:  ${executedCommand} *** ${errorMessage} *** Please select an option below:
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
        vscode.window.showErrorMessage(
            "Expected treecipe and config file missing",
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

}
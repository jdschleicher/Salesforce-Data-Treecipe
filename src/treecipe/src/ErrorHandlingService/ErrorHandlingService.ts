import * as vscode from 'vscode';

export class ErrorHandlingService {

    static handleCapturedError(error:Error, executedCommand:string) {

        const errorMessage = error instanceof Error ? executedCommand + ':' + error.message : `Unknown error during command: ${ executedCommand }`;
        const stackTrace = error instanceof Error ? error.stack : 'No stack trace available';
        const reportIssueButton = 'Report Issue to GitHub with stack trace';
        const goToTroubleshootingREADMESection = "Review Troubleshooting From README";

        vscode.window.showErrorMessage(

            `An unexpected error occurred: \n ${errorMessage}`, 
            reportIssueButton,
            goToTroubleshootingREADMESection

        ).then(selection => {

            if (selection === reportIssueButton) {

                const githubIssueBuiltTemplateUrl = this.buildGitHubIssueTemplateUrl(errorMessage, stackTrace);
                vscode.env.openExternal(vscode.Uri.parse(githubIssueBuiltTemplateUrl));

            } else if ( selection === goToTroubleshootingREADMESection ) {

                const directLinkToTroubleshootingSectionInREADME = "https://github.com/jdschleicher/Salesforce-Data-Treecipe#:~:text=object%2Dmeta.xml%0A%E2%94%82%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%E2%94%94%E2%94%80%E2%94%80%20...-,Troubleshooting,-%22Generate%20Treecipe%22%20not";
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


}
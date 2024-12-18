import * as vscode from 'vscode';

export class ErrorHandlingService {

    static handleCapturedError(error:Error, executedCommand:string) {

        const githubIssueBaseUrl = 'https://github.com/jdschleicher/salesforce-data-treecipe/issues/new';
        const errorMessage = error instanceof Error ? executedCommand + ':' + error.message : `Unknown error during command: ${ executedCommand }`;
        const stackTrace = error instanceof Error ? error.stack : 'No stack trace available';

        const urlSearchParams = new URLSearchParams({
            title: `Unexpected Error: ${errorMessage}`,
            body: `**Error Details:**
                \`\`\`
                ${errorMessage}
                
                Stack Trace:
                ${stackTrace}
                \`\`\`
            
                **Additional Context:**
                - VS Code Version: 
                - Extension Version: 
                - Operating System: 
            
                **Steps to Reproduce:**
                1. 
                2. 
                3. 
        `
        });

        const githubIssueUrl = `${githubIssueBaseUrl}?` + urlSearchParams.toString();

        vscode.window.showErrorMessage(

            `An unexpected error occurred: \n ${errorMessage}`, 
            'Report Issue to GitHub with execution stack trace'

        ).then(selection => {

            if (selection === 'Report Issue to GitHub with execution stack trace') {
                vscode.env.openExternal(vscode.Uri.parse(githubIssueUrl));
            }

        });
        
    }

    static getCommandToTroubleshootingOptionsMap():Record<string, string> {

        const salesforceFieldToSnowfakeryMap: Record<string, string> = {
            'generateRecipeFromConfigurationDetail' : `
                confirm directory path is expected 
            `,
            'initiateTreecipeConfigurationSetup' : ``
        };
    
        return salesforceFieldToSnowfakeryMap;

    }
    

}
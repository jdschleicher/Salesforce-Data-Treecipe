import { exec } from 'child_process';

export class SnowfakeryIntegrationService {

    static async isSnowfakeryInstalled(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            exec('ddd --version', (error, stdout) => {

// `snowfakery version 4.0.0
// You have the latest version of SnowfakeryProgram: /Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/snowfakery/cli.pyPython: 3.12.7 (v3.12.7:0b05ead877f, Sep 30 2024, 23:18:00) [Clang 13.0.0 (clang-1300.0.29.30)]
// Executable: /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12Installation: Properly installed`
                
                if (error) {

                    reject(new Error(`An error occurred: ${error.message}`));


                } else {

                    /*
                     IF NO ERROR THEN stdout CONTAINS THE VERSION INFORMATION 
                     AND WE CAN RETURN TRUE FOR SNOWFAKERY BEING INSTALLED
                     */
                    resolve(true);

                }
                
            });

        });

    }

    static async runSnowfakeryGenerationByRecipeFile() {
       
        const snowfakeryCliExists = await this.isSnowfakeryInstalled();

        if (snowfakeryCliExists) {
            console.log('Snowfakery is installed');
        }



    }
    
}
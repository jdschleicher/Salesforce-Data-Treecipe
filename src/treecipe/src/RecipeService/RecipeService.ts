import { ConfigurationService } from "../ConfigurationService/ConfigurationService";
import { processDirectory } from "../DirectoryProcessingService/DirectoryProcessor";
import { IFakerService } from "../FakerService/IFakerService";
import { ObjectInfoWrapper } from "../ObjectInfoWrapper/ObjectInfoWrapper";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";
import { XMLFieldDetail } from "../XMLProcessingService/XMLFieldDetail";

import * as fs from 'fs';
import * as vscode from 'vscode';


export class RecipeService {


    private fakerService: IFakerService;

    constructor(private fakerServiceImplementation) {
        this.fakerService = fakerServiceImplementation;
    }

    openingRecipeSyntax:string = "${{";
    closingRecipeSyntax:string = "}}";
    
    generateTabs(tabCount: number):string {
        const spacesPerTab = 4;
        return ' '.repeat(spacesPerTab * tabCount);
    }

    static salesforceFieldToSnowfakeryMap: Record<string, string> = {
        'text': '${{fake.text(max_nb_chars=50)}}',
        'textarea': '${{fake.paragraph()}}',
        'longtextarea': '${{fake.text(max_nb_chars=1000)}}',
        'richtextarea': '${{fake.text(max_nb_chars=1000)}}',
        'email': '${{fake.email()}}',
        'phone': '${{fake.phone_number()}}',
        'url': '${{fake.url()}}',
        'number': '${{fake.random_int(min=0, max=999999)}}',
        'currency': '${{fake.pydecimal(left_digits=6, right_digits=2, positive=True)}}',
        'percent': '${{fake.pydecimal(left_digits=2, right_digits=2, positive=True)}}',
        'date': '${{date(fake.date_between(start_date="-1y", end_date="today"))}}',
        'datetime': '${{fake.date_time_between(start_date="-1y", end_date="now")}}',
        'time': '${{fake.time()}}',
        'picklist': 'GENERATED BY FIELD XML MARKUP',
        'multiselectpicklist': 'GENERATED BY FIELD XML MARKUP',
        'checkbox': '${{fake.boolean()}}',
        'lookup': '"TODO -- REFERENCE ID REQUIRED"',
        'masterdetail': '"TODO -- REFERENCE ID REQUIRED"',
        'formula': 'Formula fields are calculated, not generated',
        'location': '"SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445"'
    };

    getRecipeFakeValueByXMLFieldDetail(xmlFieldDetail: XMLFieldDetail): string {
        
        let fakeRecipeValue;
        const fieldType = xmlFieldDetail.fieldType.toLowerCase();
        switch (fieldType) {
            
            case 'picklist':
                
                if (xmlFieldDetail.controllingField) {
                    fakeRecipeValue = this.buildDependentPicklistRecipeFakerValue(xmlFieldDetail);
                } else {
                    fakeRecipeValue = this.buildPicklistRecipeValueByXMLFieldDetail(xmlFieldDetail);
                }

                return fakeRecipeValue;
                
            case 'multiselectpicklist':
                
                fakeRecipeValue = this.buildMultiSelectPicklistRecipeValueByXMLFieldDetail(xmlFieldDetail);
            
                return fakeRecipeValue;
                
            // case 'masterdetail':
                
            //     return {
            //         type: 'lookup'
            //     };

            // case 'lookiup':

            //     return 'test';
                
            default: 
                const fieldToRecipeValueMap = this.fakerService.getMapSalesforceFieldToFakerValue;
                // CHECK IF VALID FIELD TYPE OR EXISTS IN PROGRAMS SALESFORCE FIELD MAP
                if ( fieldType in fieldToRecipeValueMap ) {
                    fakeRecipeValue = fieldToRecipeValueMap[fieldType];
                } else {
                    // NOT THROWING EXCEPTION HERE, WE WANT THE REMAINING FIELDS TO BE PROCESSED
                    fakeRecipeValue = `"FieldType Not Handled -- ${fieldType} does not exist in this programs Salesforce field map."`;
                }

                return fakeRecipeValue;
            

        }

    }

    buildMultiSelectPicklistRecipeValueByXMLFieldDetail(xmlFieldDetail: XMLFieldDetail): string {

        if ( !(xmlFieldDetail.picklistValues) ) {
            return '';
        }
        const availablePicklistChoices = xmlFieldDetail.picklistValues.map(detail => detail.fullName);

        // const commaJoinedPicklistChoices = availablePicklistChoices.join("','");
        // const fakeRecipeValue = `${this.openingRecipeSyntax} (';').join((fake.random_sample(elements=('${commaJoinedPicklistChoices}')))) ${this.closingRecipeSyntax}`;
        const fakeRecipeValue = this.fakerService.getFakeMultiSelectPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices);
        return fakeRecipeValue;

    }

    buildDependentPicklistRecipeFakerValue(xmlFieldDetail: XMLFieldDetail): string {
    
        const controllingField = xmlFieldDetail.controllingField;
        let fakeRecipeValue:string;
        let controllingValueToPicklistOptions:Record<string, string[]> = {};

        if ( !(xmlFieldDetail.picklistValues) ) {
            return '';
        }
        xmlFieldDetail.picklistValues.forEach(picklistOption => {
            
            if ( !(picklistOption.availableForControllingValues) ) {
                return '';
            }
            picklistOption.availableForControllingValues.forEach((controllingValue) => {

                if ( controllingValue in controllingValueToPicklistOptions ) {
                    controllingValueToPicklistOptions[controllingValue].push(picklistOption.fullName);
                } else {
                    controllingValueToPicklistOptions[controllingValue] = [ picklistOption.fullName ];
                }

            });

        });

        let allMultiSelectChoiceRecipe:string;
        for ( const controllingValueKey in controllingValueToPicklistOptions ) {
            
            let picklistValuesAvailableForChoice = controllingValueToPicklistOptions[controllingValueKey];
            
            let randomChoicesBreakdown:string;

            picklistValuesAvailableForChoice.forEach( value => {
                if (randomChoicesBreakdown) {
                    randomChoicesBreakdown += `\n${this.generateTabs(5)}- ${value}`;
                } else {
                    randomChoicesBreakdown = `- ${value}`;
                }
            });


            let multiSelectChoiceRecipe = 
`${this.generateTabs(2)}- choice:
${this.generateTabs(3)}when: ${this.openingRecipeSyntax} ${controllingField} == '${controllingValueKey}' }}
${this.generateTabs(3)}pick:
${this.generateTabs(4)}random_choice:
${this.generateTabs(5)}${randomChoicesBreakdown}`;


            if (!(allMultiSelectChoiceRecipe)) {
                allMultiSelectChoiceRecipe = multiSelectChoiceRecipe;
            } else {
                const lineBreakMultiSelectChoiceRecipe = `\n${multiSelectChoiceRecipe}`;
                allMultiSelectChoiceRecipe += lineBreakMultiSelectChoiceRecipe;
            }
        }

        if (fakeRecipeValue) {
            fakeRecipeValue += `\n${this.generateTabs(2)}${allMultiSelectChoiceRecipe}`;
        } else {
            fakeRecipeValue = `\n${this.generateTabs(1.5)}if:`;
            fakeRecipeValue += `\n${allMultiSelectChoiceRecipe}`;
        }

        return fakeRecipeValue;

    }

    buildPicklistRecipeValueByXMLFieldDetail(xmlFieldDetail: XMLFieldDetail): string {
    
        if ( !(xmlFieldDetail.picklistValues) ) {
            return '';
        }
        const availablePicklistChoices = xmlFieldDetail.picklistValues.map(detail => detail.fullName);
        const commaJoinedPicklistChoices = availablePicklistChoices.join("','");
        const fakeRecipeValue = `${this.openingRecipeSyntax} random_choice('${commaJoinedPicklistChoices}') ${this.closingRecipeSyntax}`;
        return fakeRecipeValue;

    }

    static initiateRecipeByObjectName(objectName: string): string {

        // ADD NEW LINE CHARACTER TO SEPARATE OBJECT RECIPES WHEN THEY ARE ADDED TOGETHER
        const objectRecipeMarkup = 
`\n- object: ${objectName}
  nickname: ${objectName}_NickName
  count: 1
  fields:`;

        return objectRecipeMarkup;
    }

    static appendFieldRecipeToObjectRecipe(objectRecipe:string, fieldRecipe: string, fieldApiName: string): string {
        const fieldPropertAndRecipeValue = `${fieldApiName}: ${fieldRecipe}`;
        const updatedObjectRecipe =
`${objectRecipe}
${this.generateTabs(1)}${fieldPropertAndRecipeValue}`;

        return updatedObjectRecipe;
    }

    async generateRecipeFromConfigurationDetail() {

        const workspaceRoot = await VSCodeWorkspaceService.getWorkspaceRoot();
        let objectsInfoWrapper = new ObjectInfoWrapper();
      
        if (workspaceRoot) {
          const relativePathToObjectsDirectory = ConfigurationService.getObjectsPathFromConfiguration();
          const pathWithoutRelativeSyntax = relativePathToObjectsDirectory.split("./")[1];
          const fullPathToObjectsDirectory = `${workspaceRoot}/${pathWithoutRelativeSyntax}`;
          const objectsTargetUri = vscode.Uri.file(fullPathToObjectsDirectory);
          objectsInfoWrapper = await processDirectory(objectsTargetUri, objectsInfoWrapper);
          vscode.window.showInformationMessage('Directory processing completed');
        }
      
        const isoDateTimestamp = new Date().toISOString().split(".")[0].replace(/:/g,"-"); // expecting '2024-11-25T16-24-15'
        const recipeFileName = `recipe-${isoDateTimestamp}.yaml`;
        const outputFilePath = `${workspaceRoot}/treecipe/${recipeFileName}`;
        fs.writeFile(outputFilePath, objectsInfoWrapper.combinedRecipes, (err) => {
            if (err) {
                console.error('Error writing file', err);
            } else {
                console.log('Data written to file successfully');
            }
        });
      
      }
    
}
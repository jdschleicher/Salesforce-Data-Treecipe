import { RecordTypeWrapper } from "../../RecordTypeService/RecordTypesWrapper";
import { IFakerService } from "../IFakerService";

export class NPMFakerService implements IFakerService {

    generateTabs(tabCount: number):string {
        const spacesPerTab = 4;
        return ' '.repeat(spacesPerTab * tabCount);
    }

    buildDependentPicklistRecipeFakerValue(controllingValueToPicklistOptions: Record<string, string[]>, 
                                            recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                                            controllingField: string,
                                            fieldApiName: string
                                        ): string {
    
        let fakeDependentPicklistRecipeValue = "";
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
${this.generateTabs(3)}when: "${controllingField} == '${controllingValueKey}'"
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

        if (fakeDependentPicklistRecipeValue) {
            fakeDependentPicklistRecipeValue += `\n${this.generateTabs(2)}${allMultiSelectChoiceRecipe}`;
        } else {
            fakeDependentPicklistRecipeValue = `\n${this.generateTabs(1.5)}if:`;
            fakeDependentPicklistRecipeValue += `\n${allMultiSelectChoiceRecipe}`;
        }

        return fakeDependentPicklistRecipeValue;

    }

    buildPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[], 
                                                recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                                                associatedFieldApiName): string {
         
        const joinedChoices = availablePicklistChoices.map(option => `'${option}'`).join(',');
        const fakeMultiSelectRecipeValue = `faker.helpers.arrayElement([${joinedChoices}])`;
        return fakeMultiSelectRecipeValue;

    }

    buildMultiSelectPicklistRecipeValueByXMLFieldDetail(availablePicklistChoices: string[],
                                                            recordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>,
                                                            associatedFieldApiName
                                                        ): string {
   
        const joinedChoices = availablePicklistChoices.map(option => `'${option}'`).join(',');
        const fakeMultiSelectRecipeValue = `faker.helpers.arrayElements([${joinedChoices}])`;
        return fakeMultiSelectRecipeValue;

    }

    getMapSalesforceFieldToFakerValue():Record<string, string> {

        const salesforceFieldToNPMFakerMap: Record<string, string> = {
            'text': '{{ faker.lorem.text(50) }}',
            'textarea': '{{ faker.lorem.paragraph() }}',
            'longtextarea': '{{ faker.lorem.text(1000) }}',
            'richtextarea': '{{ faker.lorem.text(1000) }}',
            'email': '{{ faker.internet.email() }}',
            'phone': '{{ faker.phone.number() }}',
            'url': '{{ faker.internet.url() }}',
            'number': '{{ faker.datatype.number({ min: 0, max: 999999 }) }}',
            'currency': '{{ faker.finance.amount(0, 999999, 2) }}',
            'percent': '{{ faker.finance.amount(0, 99, 2) }}',
            'date': '{{ faker.date.between("2023-01-01", "2024-01-01").toISOString().split("T")[0] }}',
            'datetime': '{{ faker.date.between("2023-01-01", "2024-01-01").toISOString() }}',
            'time': '{{ faker.date.recent().toISOString().split("T")[1] }}',
            'checkbox': '{{ faker.datatype.boolean() }}',
            'picklist': 'GENERATED BY FIELD XML MARKUP',
            'multiselectpicklist': 'GENERATED BY FIELD XML MARKUP',
            'lookup': '"### TODO -- REFERENCE ID REQUIRED"',
            'masterdetail': '"### TODO -- REFERENCE ID REQUIRED"',
            'formula': 'Formula fields are calculated, not generated',
            'location': '"### TODO -- SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445"',
        };

        return salesforceFieldToNPMFakerMap;
    }

}
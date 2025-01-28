import { RecipeService } from "../../RecipeService";

// NOTE ALL BACK SLASHES ARE UTILIZED TO IGNORE SPECIAL CHARACTERS IN STRING TEMPLATE e.g. " \${{ "
export class RecipeMockService {

    static getSnowfakeryExpectedEvertyingExampleFullObjectRecipeMarkup():string {

        const fakeObjectMarkupForEverythingExample = 
`\n- object: Example_Everything__c
  nickname: Example_Everything__c_NickName
  count: 1
  fields:
        Checkbox__c: \${{fake.boolean()}}
        Currency__c:\${{fake.pydecimal(left_digits=6, right_digits=2, positive=True)}}
        Date__c:\${{date(fake.date_between(start_date="-1y", end_date="today"))}}
        DateTime__c:\${{fake.date_time_between(start_date="-1y", end_date="now")}}
        DependentPicklist__c: 
            if:
                - choice:
                    when:\${{ Picklist__c == 'cle' }}
                    pick:
                        random_choice:
                            - tree
                            - weed
                            - mulch
                            - rocks
                - choice:
                    when:\${{ Picklist__c == 'eastlake' }}
                    pick:
                        random_choice:
                            - tree
                            - weed
                            - mulch
                - choice:
                    when:\${{ Picklist__c == 'madison' }}
                    pick:
                        random_choice:
                            - tree
                            - plant
                            - weed
                - choice:
                    when:\${{ Picklist__c == 'willoughby' }}
                    pick:
                        random_choice:
                            - tree
                            - weed
                            - mulch
                - choice:
                    when:\${{ Picklist__c == 'mentor' }}
                    pick:
                        random_choice:
                            - plant
                            - weed
                - choice:
                    when:\${{ Picklist__c == 'wickliffe' }}
                    pick:
                        random_choice:
                            - weed
                            - rocks
        Email__c:\${{fake.email()}}
        Example_Everything_Lookup__c:
        Formula__c: Formula fields are calculated, not generated
        Geolocation__c:\${{{"latitude": fake.latitude(), "longitude": fake.longitude()}}}
        MultiPicklist__c:\${{ (';').join((fake.random_sample(elements=('chicken','chorizo','egg','fish','pork','steak','tofu')))) }}
        Number__c:\${{fake.random_int(min=0, max=999999)}}
        Percent__c:\${{fake.pydecimal(left_digits=2, right_digits=2, positive=True)}}
        Phone__c:\${{fake.phone_number()}}
        Picklist__c: --------------
        Text__c:\${{fake.text(max_nb_chars=50)}}
        Text_Area_Long__c:\${{fake.text(max_nb_chars=1000)}}
        TextAreaRich__c:\${{fake.text(max_nb_chars=1000)}}
        Time__c:\${{fake.time()}}
        Url__c:\${{fake.url()}}
`;

        return fakeObjectMarkupForEverythingExample;

    }

    static getFakeInitialObjectRecipeMarkup():string {
        const initialRecipeMarkup = 
`- object: FakeObject__c
  nickname: FakeObject__c_NickName
  count: 1
  fields:`;

        return initialRecipeMarkup;

    }

    static getMockSnowfakeryDependentPicklistRecipeValueWithoutRecordTypeDetail():string {
        const controllingField = "Picklist__c";
            
        const expectedDependentPicklistRecipeValue =`
      if:
        - choice:
            when: \${{ ${controllingField} == 'cle' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
                    - rocks
        - choice:
            when: \${{ ${controllingField} == 'eastlake' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
        - choice:
            when: \${{ ${controllingField} == 'madison' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - plant
        - choice:
            when: \${{ ${controllingField} == 'willoughby' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
        - choice:
            when: \${{ ${controllingField} == 'mentor' }}
            pick:
                random_choice:
                    - weed
                    - plant
        - choice:
            when: \${{ ${controllingField} == 'wickliffe' }}
            pick:
                random_choice:
                    - weed
                    - rocks`;

        return expectedDependentPicklistRecipeValue;

    }

    static getMockRecordTypeDrivenDependentPicklistRecipeValue():string {

        const controllingFieldApiName = "Picklist__c";
        const expectedDependentPicklistRecipeValue =`
      if:
        - choice:
            when: \${{ ${controllingFieldApiName} == 'cle' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
                    - rocks
                    ### TODO: -- RecordType Options -- OneRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- OneRecType
                    - mulch
                    - plant
                    ### TODO: -- RecordType Options -- TwoRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- TwoRecType
                    - mulch
                    - plant
                    - rocks
                    - tree
        - choice:
            when: \${{ ${controllingFieldApiName} == 'eastlake' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
                    ### TODO: -- RecordType Options -- OneRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- OneRecType
                    - mulch
                    - plant
                    ### TODO: -- RecordType Options -- TwoRecType -- "eastlake" is not an available value for Picklist__c for record type TwoRecType
        - choice:
            when: \${{ ${controllingFieldApiName} == 'madison' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - plant
                    ### TODO: -- RecordType Options -- OneRecType -- "madison" is not an available value for Picklist__c for record type OneRecType
                    ### TODO: -- RecordType Options -- TwoRecType -- "madison" is not an available value for Picklist__c for record type TwoRecType
        - choice:
            when: \${{ ${controllingFieldApiName} == 'willoughby' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
                    ### TODO: -- RecordType Options -- OneRecType -- "willoughby" is not an available value for ${controllingFieldApiName} for record type OneRecType
                    ### TODO: -- RecordType Options -- TwoRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- TwoRecType
                    - mulch
                    - plant
                    - rocks
                    - tree
        - choice:
            when: \${{ ${controllingFieldApiName} == 'mentor' }}
            pick:
                random_choice:
                    - weed
                    - plant
                    ### TODO: -- RecordType Options -- OneRecType -- "mentor" is not an available value for ${controllingFieldApiName} for record type OneRecType
                    ### TODO: -- RecordType Options -- TwoRecType -- "mentor" is not an available value for ${controllingFieldApiName} for record type TwoRecType
        - choice:
            when: \${{ ${controllingFieldApiName} == 'wickliffe' }}
            pick:
                random_choice:
                    - weed
                    - rocks
                    ### TODO: -- RecordType Options -- OneRecType -- "wickliffe" is not an available value for ${controllingFieldApiName} for record type OneRecType
                    ### TODO: -- RecordType Options -- TwoRecType -- "wickliffe" is not an available value for ${controllingFieldApiName} for record type TwoRecType`;

        return expectedDependentPicklistRecipeValue;

    }

    static getMockPicklistRecipeCobminedWithRecordTypes():string {

        const fakeRecordTypeRecipe = `\${{ random_choice('cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby') }}
                    ### TODO: -- RecordType Options -- OneRecType -- Below is the faker recipe for the record type OneRecType for the field Picklist__c
                    \${{ random_choice('cle', 'eastlake') }}
                    ### TODO: -- RecordType Options -- TwoRecType -- Below is the faker recipe for the record type TwoRecType for the field Picklist__c
                    \${{ random_choice('cle', 'willoughby') }}`;

        return fakeRecordTypeRecipe;

    }

    static getMockPicklistRecordTypesRecipe():string {

        const fakeRecordTypeRecipe = `                    ### TODO: -- RecordType Options -- OneRecType -- Below is the faker recipe for the record type OneRecType for the field Picklist__c
                    \${{ random_choice('cle', 'eastlake') }}
                    ### TODO: -- RecordType Options -- TwoRecType -- Below is the faker recipe for the record type TwoRecType for the field Picklist__c
                    \${{ random_choice('cle', 'willoughby') }}`;

        return fakeRecordTypeRecipe;

    }





}
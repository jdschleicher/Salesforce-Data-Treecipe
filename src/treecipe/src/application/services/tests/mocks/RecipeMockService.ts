import { RecipeService } from "../../RecipeService";

export class RecipeMockService {

    static getExpectedEvertyingExampleFullObjectRecipeMarkup():string {

        const fakeObjectMarkupForEverythingExample = 
`\n- object: Example_Everything__c
  nickname: Example_Everything__c_NickName
  count: 1
  fields:
        Checkbox__c: ${RecipeService.openingRecipeSyntax}fake.boolean()}}
        Currency__c: ${RecipeService.openingRecipeSyntax}fake.pydecimal(left_digits=6, right_digits=2, positive=True)}}
        Date__c: ${RecipeService.openingRecipeSyntax}date(fake.date_between(start_date="-1y", end_date="today"))}}
        DateTime__c: ${RecipeService.openingRecipeSyntax}fake.date_time_between(start_date="-1y", end_date="now")}}
        DependentPicklist__c: 
            if:
                - choice:
                    when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'cle' }}
                    pick:
                        random_choice:
                            - tree
                            - weed
                            - mulch
                            - rocks
                - choice:
                    when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'eastlake' }}
                    pick:
                        random_choice:
                            - tree
                            - weed
                            - mulch
                - choice:
                    when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'madison' }}
                    pick:
                        random_choice:
                            - tree
                            - plant
                            - weed
                - choice:
                    when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'willoughby' }}
                    pick:
                        random_choice:
                            - tree
                            - weed
                            - mulch
                - choice:
                    when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'mentor' }}
                    pick:
                        random_choice:
                            - plant
                            - weed
                - choice:
                    when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'wickliffe' }}
                    pick:
                        random_choice:
                            - weed
                            - rocks
        Email__c: ${RecipeService.openingRecipeSyntax}fake.email()}}
        Example_Everything_Lookup__c:
        Formula__c: Formula fields are calculated, not generated
        Geolocation__c: ${RecipeService.openingRecipeSyntax}{"latitude": fake.latitude(), "longitude": fake.longitude()}}}
        MultiPicklist__c: ${RecipeService.openingRecipeSyntax} (';').join((fake.random_sample(elements=('chicken','chorizo','egg','fish','pork','steak','tofu')))) }}
        Number__c: ${RecipeService.openingRecipeSyntax}fake.random_int(min=0, max=999999)}}
        Percent__c: ${RecipeService.openingRecipeSyntax}fake.pydecimal(left_digits=2, right_digits=2, positive=True)}}
        Phone__c: ${RecipeService.openingRecipeSyntax}fake.phone_number()}}
        Picklist__c: --------------
        Text__c: ${RecipeService.openingRecipeSyntax}fake.text(max_nb_chars=50)}}
        Text_Area_Long__c: ${RecipeService.openingRecipeSyntax}fake.text(max_nb_chars=1000)}}
        TextAreaRich__c: ${RecipeService.openingRecipeSyntax}fake.text(max_nb_chars=1000)}}
        Time__c: ${RecipeService.openingRecipeSyntax}fake.time()}}
        Url__c: ${RecipeService.openingRecipeSyntax}fake.url()}}
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

}
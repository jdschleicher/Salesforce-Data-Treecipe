# Change Log

## [Unreleased]

---

## [1.3.0] - Feature: Salesforce OOTB boilerplate faker recipes for several OOTB objects like Account, Contact [PR#15](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/15))

- main feature - OOTB boilerplate recipe markup for several Salesforce CRM objects
- others 
  - added "TODO" verbiage for Picklist fields without xml valueSet markup. The verbiage indicates that the picklist field may need options from a standard value set or global value set
  - refactored RecordTypeService
  - added new unit tests to manage for several different scenarios of picklist xml markup
  - adding changelog :) 

---

## [1.2.1] - Bug: always expected a record types directory to exist [PR#13](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/13))

- bug fix stemming from record type logic always expecting a record types directory to exists and record type configurations to build picklists and multiselect picklists from

---

## [1.2.0] - Feature: Insert Created Datasets with Collections API Service ([PR#12](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/12))

- Takes expected artifacts already in Collections API format, generates "proof" artifacts, attempts insert of pre-structured files, and adds insert success/failure results in same timestamped directory as "proof" artifacts. 
- significant refactoring needed to properly setup proof files and introduce new "RecordTypeWrapper" object that incorporates a map of "RecordType.DeveloperName" to unique Record Type Id based on the targeted Salesforce org we are attempting to insert data against
- brief description of each file change below

---

## [1.1.0] - Feature: Source Record Type parsing for Record Type based Picklists and Multiselect Picklists  ([PR#10](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/10))

- Introduce logic to parse the "recordTypes" directory within an objects directory and generate a key-value map of record type to associated xml markup details 
- updated unit tests to ensure scenarios where record types are included in the source directory, the generated recipes include the expected record type associated picklist options

---

## [1.0.0] - Feature: new command pallette option that prompts the User to select a previously created recipe file and executes the snowfakery cli command to generate fake data  ([PR#9](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/9))

- New Extension command -> Run Snowfakery by Recipe File
  - Executing command will prompt to choose a recipe file to generate fake data from.  These files are found in the path "treecipe/GeneratedRecipes" 
  - Upon recipe file selection, snowfakery cli is executed against the recipe yaml file and results are outputted to json.
  - json is then formatted for for collections api a new timestamped "dataset" directory is created under the folder path "treecipe/FakeDataSets" and within this two files will be created under this directory:
    - The collectionsApi formatted file that has the recipe that generated it
    -  the originating recipe file that lead to the generated fake data
  - If snowfakery cli is not installed on your machine, an exception will be thrown 

---

## [0.2.1] - Bug: object variable being populated with full objects path instead of intended parsing of the path to get the object name ([PR#8](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/8))

- new features - organization - dedicated directory called "GeneratedRecipes" where all new recipes will be placed instead of alongside the root of treecipe folder
- fix windows bug where instead of last segment of path is returned to "object" yaml property, returns whole path:
![image](https://github.com/user-attachments/assets/8eb082af-83d7-40ac-a985-8ec75684bdc9)
- development tooling - new custom vscode task to open jest coverage results in browser and adjusting other jest custom task to create coverage files in coverage directory locally
- significant refactoring of DirectoryProcessor as unit tests were built to support validation of functionality and abstract away logic that could be in isolated methods ( DirectoryProcessor.ts also includes bug fix
- testing support - new methods in MockDirectoryService to mimic vscode.workspace.fs.readDirectory mocking and mocking vscode workspace
- new test suite for ErrorHandlingService

---

## [0.2.0] - Bug: Graceful error handling when recipes do not generate and associated Support Functionality ([PR#5](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/5))

- Introduces a error handling service around all available Treecipe VSCode extension commands
  - error handling includes VSCode Alerts that can:
     - auto-generate GitHub Issue in this repository with templated details needed to reproduce and triage
     - auto-rerun of extension command ( if the Generate Treecipe command is ran without being an initiated treecipe config file, a button is available to auto start the initiate command
  - standardize forward-slashes for objects path on creation of the treecipe.config.json file
  - gracefully handle OOTB Salesforce fields that do not have expected XML tags like "type".  
    - In the event of these scenarios, the recipe field is still generated for awareness and given a value of "REMOVE ME AS I MAY NOT BE ABLE TO GENERATE BECAUSE I AM OOTB FIELD LIKE Id or AccountNumber  

## [0.1.1] - Bug: Snowfakery configuration value casing issue ([PR#3](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/3))

- updates the bug fix along with associated jidoka ( countermeasure) tests to validate this scenario occurring again or not
- fix  casing issues with selected faker service type for snowfakery

---

- Initial release

## [0.1.0] - Configiuration service for faker service selection ([PR#1](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/1))

 - initial setup for factory pattern "choose your faker service" and associated VSCodeWorkplace and Extension Configuration Management based on faker service choice ( setting, getting configuration values )
 - faker service introduced refactoring needs for separating out expected recipe values in RecipeService into two dedicated recipe providers ( NPMFakerService, SnowfakeryFakerService) - NPMFakerService is not used at the moment and this entire setup was excessive from an actual usage stand point. I did learn some fun stuff and got to apply the factory pattern. In the future, the faker service could be chosen as part of configuration setup. For now it defaults to "Snowfakery"
 - Associated unit tests and supported mock service
 - GitHub Actions for automated jest tests validation and publishing jobs


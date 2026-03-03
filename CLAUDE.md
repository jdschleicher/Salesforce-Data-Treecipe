# Claude Code Assistant Instructions - Salesforce Data Treecipe

## AI Context & Project Overview

You are assisting with **Salesforce Data Treecipe**, a **VS Code extension** (TypeScript) that auto-generates fake-data recipe YAML files from Salesforce object metadata (source format). It supports two faker backends: **faker-js** (built-in, no setup) and **snowfakery** (external Python CLI). The extension bridges Salesforce source-format XML metadata → YAML recipe files → Salesforce Collections API datasets.

### Key Project Files

- `src/extension.ts` - VS Code extension entry point; registers all commands
- `src/treecipe/src/` - All core service logic (one folder per service)
- `src/treecipe/src/RecipeFakerService.ts/` - **Directory** (not a file) containing `FakerJSRecipeFakerService/` and `SnowfakeryRecipeFakerService/` implementations
- `src/treecipe/src/FakerRecipeProcessor/` - Interface + FakerJS and Snowfakery recipe processor implementations
- `src/treecipe/src/DirectoryProcessingService/` - Parses Salesforce object metadata XML directories
- `src/treecipe/src/RelationshipService/` - Groups objects into Treecipe files by relationship hierarchy
- `src/treecipe/src/RecipeService/` - Orchestrates recipe YAML file creation
- `package.json` - Extension manifest; all five commands declared under `contributes.commands`
- `jest.config.js` - Jest configuration (`ts-jest`, `jest-extended`)
- `CHANGELOG.md` - Feature history; read before starting work to understand recent changes

## Primary Objectives

1. **Follow existing service patterns** - Each service is a class in its own folder; tests live in a `tests/` subfolder alongside the service file
2. **Field-type-driven generation** - Recipe output is determined by Salesforce XML `<type>` tag; use `<precision>` and `<scale>` to constrain numeric/currency values
3. **Support both faker backends** - Every field-type handler must have equivalent implementations in both `FakerJSRecipeFakerService` and `SnowfakeryRecipeFakerService`
4. **Write tests first** - Every service has a `tests/` folder with Jest specs; add or update tests with every change

## Quick Command Reference

```bash
# Compile TypeScript
npm run compile

# Watch mode (auto-recompile on save)
npm run watch

# Run all tests with coverage
npm run jest-test

# Run tests with JSON + summary output (for CI)
npm run jest-test-summary

# Lint
npm run lint

# Run a single test file
npx jest path/to/SomeService.test.ts

# Package the extension
npx vsce package
```

## CRITICAL RULES - NO EXCEPTIONS

### After Every Code Change

1. **Run tests** - `npm run jest-test` — ALL must pass
2. **Check coverage** - Coverage must not regress
3. **Compile** - `npm run compile` — zero TypeScript errors
4. **Lint** - `npm run lint` — zero ESLint errors
5. Check that existing functionality is not broken
6. Follow the established code patterns in the project

### Testing Requirements

- **Tests are mandatory** - Run `npm run jest-test` after EVERY code change
- **Update tests each change** - When modifying any service, add or update the corresponding test file in its `tests/` folder
- **Tests must pass before committing** - Never commit code with failing tests
- **Test coverage grows with features** - Every new feature, bug fix, or refactor must include relevant test updates
- **Mock fixtures** - Place sample Salesforce XML metadata in `tests/mocks/` inside the relevant service folder
- Use Jest `describe`/`it` or `describe`/`test` blocks; use `jest-extended` matchers where appropriate
- `restoreMocks: true` is set globally — do not manually restore mocks between tests

### Code Style Mandates

- **TypeScript strict** - No implicit `any`; always define types/interfaces
- **Class-based services** - Each service is a `class` with `static` methods; no standalone functions scattered outside a class
- **Interface-first for faker services** - Both faker backends implement `IRecipeFakerService` and `IFakerRecipeProcessor`
- **No hard-coded Salesforce field values** - All field type mappings must be driven by the XML `<type>` value
- **Naming conventions** - PascalCase for classes/interfaces, camelCase for methods/variables; service files match their class name
- **No comments for self-evident code** - Only add comments where the logic is non-obvious

## Project Structure

```
src/
├── extension.ts                             # Extension entry point, command registration
└── treecipe/src/
    ├── CollectionsApiService/
    │   ├── CollectionsApiService.ts         # Formats fake data for Salesforce Collections API
    │   ├── ICollectionsApiJsonStructure.ts  # Interface for Collections API payload shape
    │   └── tests/
    ├── ConfigurationService/
    │   ├── ConfigurationService.ts          # Reads/writes treecipe.config.json
    │   └── tests/
    ├── DirectoryProcessingService/
    │   ├── DirectoryProcessor.ts            # Walks Salesforce objects/ directory, parses XML
    │   └── tests/
    │       └── mocks/                       # Sample Salesforce metadata XML fixtures
    ├── ErrorHandlingService/
    │   ├── ErrorHandlingService.ts          # try-catch wrappers, GitHub Issue template generation
    │   └── tests/
    ├── ExtensionCommandService/
    │   └── ExtensionCommandService.ts       # VS Code command handler implementations
    ├── FakerRecipeProcessor/
    │   ├── IFakerRecipeProcessor.ts         # Interface both processors implement
    │   ├── FakerJSRecipeProcessor/
    │   │   └── FakerJSRecipeProcessor.ts
    │   └── SnowfakeryRecipeProcessor/
    │       └── SnowfakeryRecipeProcessor.ts
    ├── GlobalValueSetSingleton/
    │   ├── GlobalValueSetSingleton.ts       # Shared picklist global value set state
    │   └── tests/
    ├── ObjectInfoWrapper/
    │   ├── ObjectInfo.ts                    # Typed wrapper for parsed Salesforce object metadata
    │   ├── ObjectInfoWrapper.ts
    │   ├── FieldInfo.ts
    │   └── tests/
    ├── RecipeFakerService.ts/               # DIRECTORY (not a file)
    │   ├── IRecipeFakerService.ts           # Interface both faker services implement
    │   ├── FakerJSRecipeFakerService/
    │   │   ├── FakerJSRecipeFakerService.ts # faker-js YAML recipe generation per field type
    │   │   ├── ProcessedYamlWrapper.ts
    │   │   └── tests/
    │   └── SnowfakeryRecipeFakerService/
    │       ├── SnowfakeryRecipeFakerService.ts # Snowfakery YAML recipe generation per field type
    │       └── tests/
    ├── RecipeService/
    │   ├── RecipeService.ts                 # Orchestrates recipe YAML file creation end-to-end
    │   └── tests/
    │       └── mocks/
    ├── RecordTypeService/
    │   ├── RecordTypeService.ts             # Detects record types and related picklist options
    │   ├── RecordTypesWrapper.ts
    │   └── tests/
    ├── RelationshipService/
    │   ├── RelationshipService.ts           # Builds object relationship hierarchy for Treecipe grouping
    │   └── tests/
    │       └── mocks/
    ├── ValueSetService/
    │   └── ValueSetService.ts               # Parses picklist/global value set XML
    ├── VSCodeWorkspace/
    │   ├── VSCodeWorkspaceService.ts        # VS Code workspace/UI utilities (file picker, messages)
    │   └── tests/
    │       └── mocks/
    └── XMLProcessingService/
        ├── XmlFileProcessor.ts              # XML parsing utilities (xml2js wrapper)
        └── XMLFieldDetail.ts               # Typed field detail from parsed XML
```

## Architecture Patterns

### Extension Command Flow

```
User runs command (Cmd+Shift+P)
  → extension.ts registers command → ExtensionCommandService handler
    → ConfigurationService reads treecipe.config.json
      → DirectoryProcessingService walks salesforceObjectsPath
        → XmlFileProcessor parses each field's XML
          → ObjectInfoWrapper wraps parsed metadata
            → RecordTypeService / ValueSetService / RelationshipService enrich data
              → RecipeService orchestrates YAML generation
                → FakerJSRecipeFakerService OR SnowfakeryRecipeFakerService
                  → generates faker expression per field type
                → Writes YAML recipe file(s) to workspace
```

### Key Design Decisions

- **`RecipeFakerService.ts` is a directory** — it contains both faker implementations as subfolders; this naming is intentional and must not be changed
- **Both faker backends must stay in sync** — whenever a new field type handler is added to `FakerJSRecipeFakerService`, add the equivalent to `SnowfakeryRecipeFakerService`
- **Numeric/currency precision** — `<precision>` (total digits) and `<scale>` (decimal places) from XML drive `max` and `dec` parameters; `left_digits = precision - scale`
- **Picklist handling** — special characters (`&`, `'`, etc.) in picklist values must be escaped before embedding in faker expressions
- **Relationship grouping** — `RelationshipService` determines which objects belong in the same Treecipe file and in what insertion order

### VS Code Commands (package.json)

| Command ID | Title |
|---|---|
| `treecipe.initiateConfiguration` | Initiate Configuration File |
| `treecipe.generateTreecipe` | Generate Treecipe |
| `treecipe.runFakerByRecipe` | Run Faker by Recipe |
| `treecipe.insertDataSetBySelectedDirectory` | Insert Data Set by Directory |
| `treecipe.changeFakerImplementationService` | Select Faker Implementation |

---

## Implementation Checklist

When implementing a new feature or fixing a bug:

- [ ] Read the relevant service file(s) before making changes
- [ ] Add or update tests in the service's `tests/` folder
- [ ] If adding a new Salesforce field type handler, implement it in **both** `FakerJSRecipeFakerService` and `SnowfakeryRecipeFakerService`
- [ ] Add XML fixture files to `tests/mocks/` if the change depends on specific XML markup
- [ ] Run `npm run jest-test` — all tests pass, coverage does not regress
- [ ] Run `npm run compile` — zero TypeScript errors
- [ ] Run `npm run lint` — zero ESLint errors
- [ ] Update `CHANGELOG.md` with the change under an appropriate version heading

## Common Tasks

### Adding a New Salesforce Field Type Handler

1. Identify the Salesforce `<type>` value (e.g., `"Checkbox"`, `"Date"`)
2. Add a handler in `FakerJSRecipeFakerService.ts` that returns the appropriate faker-js expression
3. Add the equivalent handler in `SnowfakeryRecipeFakerService.ts`
4. Add tests for both in their respective `tests/` folders, with sample XML in `mocks/`

### Adding a New VS Code Command

1. Declare it in `package.json` under `contributes.commands`
2. Register it in `extension.ts`
3. Implement the handler in `ExtensionCommandService.ts`
4. Wrap in `ErrorHandlingService` for consistent error reporting

### Running Tests for a Specific Service

```bash
npx jest DirectoryProcessingService
npx jest FakerJSRecipeFakerService
npx jest --testPathPattern="RecipeFakerService"
```

### Checking What Changed Recently

```bash
# Read CHANGELOG.md top section, or:
git log --oneline -10
```

## Remember

- **Both faker backends** - New field type handlers must be implemented in both FakerJS and Snowfakery services
- **Tests first** - Add/update tests in the service's `tests/` folder before or alongside code changes
- **No comments for obvious code** - Only comment where logic is genuinely non-obvious
- **`RecipeFakerService.ts` is a directory** - Do not confuse it with the `.ts` file of the same name in the parent folder
- **Precision/scale math** - `left_digits = precision - scale`; `max = 10^left_digits - 1`; `dec = scale`
- **Special characters in picklists** - Always escape before embedding in faker expression strings

---

_This document is optimized for Claude Code. Refer to `README.md` for end-user documentation and `CHANGELOG.md` for version history._

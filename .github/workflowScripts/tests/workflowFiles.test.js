const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/*
    GitHub reports a workflow file it cannot parse as a run with NO JOBS, concluded `failure`
    before anything starts -- no log, no failing step, and a required check that sits at
    "Expected -- Waiting for status to be reported" on every pull request. A plain scalar holding
    ": " (pip's `--only-binary=:all: ...`) did exactly that to build.yaml in 3.29.2, on main and on
    every branch after it, and nothing local noticed. This loads every workflow the way a YAML
    parser must, and checks the shape GitHub needs, so the next one fails here instead.
*/
const WORKFLOWS_DIRECTORY_PATH = path.join(__dirname, '..', '..', 'workflows');

const workflowFileNames = fs.readdirSync(WORKFLOWS_DIRECTORY_PATH)
    .filter(fileName => fileName.endsWith('.yaml') || fileName.endsWith('.yml'));

describe('every GitHub Actions workflow file', () => {

    test('there are workflows to check, so this cannot pass by finding none', () => {
        expect(workflowFileNames).toEqual(expect.arrayContaining(['build.yaml', 'release.yaml']));
    });

    // #602: THE SCREENSHOT COMPARISON RUNS ONLY FOR A PR THAT TOUCHES THE COCKPIT, REQUIRES CHROMIUM THERE, AND KEEPS npm ci --ignore-scripts
    test('build.yaml compares the cockpit screenshots, path-filtered and required, and uploads the images on a failure', () => {

        const steps = yaml.load(fs.readFileSync(path.join(WORKFLOWS_DIRECTORY_PATH, 'build.yaml'), 'utf8')).jobs['Compile-and-Test-Salesforce-Data-Treecipe'].steps;
        const stepNamed = (stepName) => steps.find(step => step.name === stepName);

        expect(stepNamed('Install dependencies').run).toBe('npm ci --ignore-scripts');
        const pathFilter = stepNamed('Find whether this pull request touches the Recipe Cockpit');
        expect(pathFilter.run).toContain('src/treecipe/src/RecipeCockpitService/ src/treecipe/src/CockpitKit/ developmentSupportScripts/recipe-cockpit-screenshots/ package.json package-lock.json');
        expect(stepNamed('Install Chromium for the cockpit screenshots').run).toContain('playwright install --with-deps chromium');
        const comparison = stepNamed('Compare the Recipe Cockpit screenshots in Chromium');
        expect(comparison.env.REQUIRE_COCKPIT_SCREENSHOTS).toBe('1');
        expect(comparison.if).toBe("steps.cockpitChanges.outputs.touched == 'true'");
        const upload = stepNamed('Upload what Chromium drew and where it differs');
        expect(upload.if).toContain('failure()');
        expect(upload.with.path).toBe('node_modules/.cache/cockpit-screenshots/');

    });

    describe.each(workflowFileNames)('%s', (workflowFileName) => {

        const workflowText = fs.readFileSync(path.join(WORKFLOWS_DIRECTORY_PATH, workflowFileName), 'utf8');

        test('parses as YAML', () => {
            expect(() => yaml.load(workflowText)).not.toThrow();
        });

        test('declares triggers and jobs, and every step either runs a command or uses an action', () => {

            const workflow = yaml.load(workflowText);

            expect(workflow.on).toBeDefined();
            expect(Object.keys(workflow.jobs).length).toBeGreaterThan(0);
            Object.values(workflow.jobs).forEach(job => {
                expect(Array.isArray(job.steps)).toBe(true);
                job.steps.forEach(step => {
                    expect(typeof step.run === 'string' || typeof step.uses === 'string').toBe(true);
                });
            });

        });

    });

});
